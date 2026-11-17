<?php

namespace App\Http\Middleware;

use App\Models\AuditLog;
use App\Models\ParentProfile;
use App\Models\StudentProfile;
use App\Models\TeacherProfile;
use App\Models\User;
use App\Support\BuiltinAdmins;
use App\Support\HubIdentity;
use Closure;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Spatie\Permission\Exceptions\RoleDoesNotExist;
use Symfony\Component\HttpFoundation\Response;

/**
 * Signs in the person the bkesari hub vouches for (D-039, the contract is
 * docs/design/bkesari-id.md section 3). In the web group, after the session
 * starts and before `auth` and `guest` (bootstrap/app.php puts it ahead of
 * them in the priority list), so a page behind `auth` sees the hub's person.
 *
 * - The X-Bkesari-* identity headers count only as App\Support\HubIdentity
 *   verifies them (HUB_PROXY_SECRET set, signature, project `edu`, within
 *   60 seconds). Otherwise nothing happens here and Education's own sign-in
 *   works as before. Either way the headers are removed from the request.
 * - The local account: by users.hub_user_id, else by email only when that
 *   email is confirmed (the hub id is then stored on it), else a new one
 *   (confirmed, with a random password nobody knows). An account whose email
 *   nobody confirmed is never adopted (D-035): the request goes on as a guest
 *   and the log says why. The built-in administrators' reserved addresses
 *   lead to their own rows (App\Support\BuiltinAdmins, D-036).
 * - A session that belongs to someone else ends first. A session already
 *   signed in as this hub user is left as it is (no new sign-in, no new
 *   session id) apart from the role.
 * - The role: the one the bkesari admin approved for Education
 *   (HubIdentity::ROLES). users.hub_role remembers the role the hub gave, so
 *   that when the hub's role changes that role goes and the new one comes;
 *   roles given inside Education are never touched.
 * - Two-factor: the hub's sign-in (Google or an emailed code) is the first
 *   factor, and an account with two-factor turned on is signed in without
 *   the challenge. Education's two-factor is optional for every role (owner
 *   to confirm, DEPLOYMENT.md).
 */
class HubIdentitySignIn
{
    /** Sign-in state a half-finished two-factor sign-in left in the session (pages.auth.login). */
    private const TWO_FACTOR_KEYS = ['2fa_user_id', '2fa_remember', '2fa_password'];

    public function handle(Request $request, Closure $next): Response
    {
        $identity = HubIdentity::fromRequest(
            $request,
            (string) config('services.hub.proxy_secret', ''),
            now()->getTimestamp(),
        );

        // Believed or not, nothing after this reads them.
        foreach (HubIdentity::HEADERS as $header) {
            $request->headers->remove($header);
        }

        if ($identity !== null && $request->hasSession()) {
            $this->signIn($request, $identity);
        }

        return $next($request);
    }

    private function signIn(Request $request, HubIdentity $identity): void
    {
        $guard = Auth::guard('web');
        /** @var User|null $current */
        $current = $guard->user();

        if ($current !== null && $current->hub_user_id === $identity->hubUserId) {
            $this->applyRole($current, $identity);

            return;
        }

        $user = $this->localAccount($identity);

        // Someone else's session (another hub user's, or one this identity
        // cannot take over) ends before anything else happens on it.
        if ($current !== null && ($user === null || ! $current->is($user))) {
            $guard->logout();
            $request->session()->invalidate();
            $request->session()->regenerateToken();
            $current = null;
        }

        if ($user === null) {
            return;
        }

        if ($current === null) {
            $guard->login($user);
            $request->session()->regenerate();
            $request->session()->forget(self::TWO_FACTOR_KEYS);
        }

        $this->applyRole($user, $identity);
    }

    /** The account this identity signs in to, found, linked or made; null when it may not have one. */
    private function localAccount(HubIdentity $identity): ?User
    {
        if ($identity->role() === null) {
            $this->refuse($identity, 'the hub sent a role Education does not know: '.$identity->hubRole);

            return null;
        }

        if (BuiltinAdmins::isReservedEmail($identity->email)) {
            return $this->builtinAccount($identity);
        }

        $user = User::where('hub_user_id', $identity->hubUserId)->first();
        if ($user !== null) {
            return $user;
        }

        $user = User::where('email', $identity->email)->first();
        if ($user !== null) {
            if ($user->email_verified_at === null) {
                // Someone may have signed up with this person's address; the
                // account stays theirs until the inbox owner confirms it here
                // (an emailed code or a password reset), D-035.
                $this->refuse($identity, 'an Education account whose email nobody has confirmed holds this address', $user);

                return null;
            }

            return $this->link($user, $identity) ? $user : null;
        }

        try {
            return User::forceCreate([
                'name' => $identity->displayName(),
                'email' => $identity->email,
                'email_verified_at' => now(),
                'password' => Hash::make(Str::random(64)),
                'hub_user_id' => $identity->hubUserId,
            ]);
        } catch (UniqueConstraintViolationException) {
            // Two first visits at once: the other request made it.
            return User::where('hub_user_id', $identity->hubUserId)->first();
        }
    }

    /** smorankar or sonalimorankar: their own row, system_admin (D-036). */
    private function builtinAccount(HubIdentity $identity): ?User
    {
        $username = BuiltinAdmins::username(Str::before($identity->email, '@'));
        if ($username === null || $identity->role() !== BuiltinAdmins::ROLE) {
            $this->refuse($identity, 'a reserved address that is not a built-in administrator with the role admin');

            return null;
        }

        $user = BuiltinAdmins::account($username);

        return $this->link($user, $identity) ? $user : null;
    }

    /**
     * Stores the hub id on $user. Refused when the account already belongs to
     * another hub user. A hub_user_id that is not digits is from the retired
     * shared sign-in (a Neon Auth id) and is replaced.
     */
    private function link(User $user, HubIdentity $identity): bool
    {
        if ($user->hub_user_id === $identity->hubUserId) {
            return true;
        }

        if ($user->hub_user_id !== null && ctype_digit($user->hub_user_id)) {
            $this->refuse($identity, 'the Education account with this email belongs to another hub user', $user);

            return false;
        }

        try {
            $user->forceFill(['hub_user_id' => $identity->hubUserId])->save();
        } catch (UniqueConstraintViolationException) {
            $this->refuse($identity, 'this hub user is already linked to another Education account', $user);

            return false;
        }

        return true;
    }

    /**
     * The role the hub names, given if missing. The role the hub gave before
     * (users.hub_role) is taken away when the hub's role changes; any other
     * role was given inside Education and stays. A role the account already
     * held from Education is not recorded as the hub's, so it stays too.
     */
    private function applyRole(User $user, HubIdentity $identity): void
    {
        $role = $identity->role();
        if ($role === null) {
            $this->refuse($identity, 'the hub sent a role Education does not know: '.$identity->hubRole, $user);

            return;
        }

        // System admin by D-036 whatever the hub says, and never taken away.
        if (BuiltinAdmins::isBuiltin($user)) {
            return;
        }

        $held = $user->hasRole($role);
        if ($held && in_array($user->hub_role, [null, $role], true)) {
            return;
        }

        try {
            DB::transaction(function () use ($user, $role, $held) {
                $previous = $user->hub_role;
                if ($previous !== null && $previous !== $role && $user->hasRole($previous)) {
                    $user->removeRole($previous);
                }
                if (! $held) {
                    $user->assignRole($role);
                    match ($role) {
                        'parent' => ParentProfile::firstOrCreate(['user_id' => $user->id]),
                        'student' => StudentProfile::firstOrCreate(['user_id' => $user->id]),
                        'teacher' => TeacherProfile::firstOrCreate(['user_id' => $user->id]),
                        default => null,
                    };
                }
                $user->forceFill(['hub_role' => $held ? null : $role])->save();

                AuditLog::record('hub-role-applied', null, $user, [
                    'role' => $role,
                    'removed' => $previous !== $role ? $previous : null,
                    'hub_user_id' => $user->hub_user_id,
                ]);
            });
        } catch (RoleDoesNotExist) {
            $this->refuse($identity, 'the role '.$role.' does not exist in this database', $user);
        }
    }

    /**
     * Writes why a signed identity was not used, at most once an hour per hub
     * user and reason (every page and every Livewire update would otherwise
     * write it again). No email address goes in the log.
     */
    private function refuse(HubIdentity $identity, string $reason, ?User $user = null): void
    {
        try {
            if (! Cache::add('hub-identity:'.$identity->hubUserId.':'.md5($reason), true, now()->addHour())) {
                return;
            }
        } catch (\Throwable) {
            // No cache to keep the mark in: write it, rather than not at all.
        }

        Log::warning('Hub identity not used: '.$reason.' (D-039).', [
            'hub_user_id' => $identity->hubUserId,
            'user_id' => $user?->getKey(),
        ]);
    }
}
