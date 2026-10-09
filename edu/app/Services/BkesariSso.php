<?php

namespace App\Services;

use App\Models\TwoFactorAuthentication;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Spatie\Permission\Models\Role;

/**
 * The central bkesari.com login, seen from Education.
 *
 * Validates the central session cookie with the central service
 * (introspection, client credentials), and maps the central identity onto a
 * local user, linked by email and created on first visit with an unusable
 * password.
 *
 * Roles: a central ADMIN (or the owner) holds system_admin here. Every other
 * Education role (parent, teacher, school_admin, ...) is still granted inside
 * Education; this bridge removes only the roles it granted itself.
 */
class BkesariSso
{
    public function enabled(): bool
    {
        return (string) config('bkesari_sso.introspect_url') !== '';
    }

    /**
     * The central session token. Read from the raw Cookie header: the cookie
     * is set by the hub, not by Laravel, so it is not encrypted, and
     * EncryptCookies would otherwise discard it.
     */
    public function token(Request $request): ?string
    {
        $jar = [];
        foreach (explode(';', (string) $request->headers->get('cookie', '')) as $part) {
            $i = strpos($part, '=');
            if ($i === false) {
                continue;
            }
            $name = trim(substr($part, 0, $i));
            $jar[$name] ??= trim(substr($part, $i + 1));
        }
        foreach (config('bkesari_sso.cookies') as $name) {
            if (! empty($jar[$name])) {
                return urldecode($jar[$name]);
            }
        }

        return null;
    }

    /**
     * Who is behind the token, or null. Fails closed: if the central service
     * cannot be reached, nobody is signed in by it.
     */
    public function introspect(?string $token): ?array
    {
        if (! $token || strlen($token) > 200) {
            return null;
        }
        $key = 'bkesari-sso:'.hash('sha256', $token);
        $ttl = max((int) config('bkesari_sso.cache_seconds'), 0);

        $answer = $ttl > 0 ? Cache::get($key) : null;
        if ($answer === null) {
            $answer = ['active' => false];
            try {
                $response = Http::withBasicAuth((string) config('bkesari_sso.client_id'), (string) config('bkesari_sso.client_secret'))
                    ->acceptJson()->timeout(5)
                    ->post((string) config('bkesari_sso.introspect_url'), ['token' => $token]);
                if ($response->successful() && $response->json('active') === true && $response->json('user.id')) {
                    $answer = $response->json();
                } elseif (! $response->successful()) {
                    Log::warning('bkesari-sso: introspection answered '.$response->status());
                }
            } catch (\Throwable $e) {
                Log::warning('bkesari-sso: introspection failed: '.$e->getMessage());
            }
            if ($ttl > 0) {
                Cache::put($key, $answer, $ttl);
            }
        }

        return ($answer['active'] ?? false) === true ? $answer : null;
    }

    public function entitled(?array $identity): bool
    {
        return $identity !== null && in_array(config('bkesari_sso.feature'), $identity['features'] ?? [], true);
    }

    /** Local roles the central identity should hold through this bridge. */
    public function bridgedRoles(array $identity): array
    {
        $central = $identity['roles'] ?? [];

        return array_values(array_intersect(['ADMIN', 'SUPER_ADMIN'], $central)) ? ['system_admin'] : [];
    }

    /** Finds or creates the local user and syncs the bridged roles. */
    public function provision(array $identity): User
    {
        $email = Str::lower($identity['user']['email']);

        return DB::transaction(function () use ($identity, $email) {
            $user = User::where('email', $email)->first();
            if (! $user) {
                $user = new User;
                $user->name = $identity['user']['name'] ?: Str::before($email, '@');
                $user->email = $email;
                // Never usable: a random secret nobody is told.
                $user->password = Hash::make(Str::random(64));
                $user->save();
                if (Role::where('name', 'public')->where('guard_name', 'web')->exists()) {
                    $user->assignRole('public');
                }
            }
            if (($identity['user']['email_verified'] ?? false) && $user->email_verified_at === null) {
                $user->forceFill(['email_verified_at' => now()])->save();
            }

            $wanted = $this->bridgedRoles($identity);
            $granted = DB::table('sso_role_grants')->where('user_id', $user->id)->pluck('role_name')->all();
            foreach (array_diff($granted, $wanted) as $role) {
                if ($user->hasRole($role)) {
                    $user->removeRole($role);
                }
                DB::table('sso_role_grants')->where('user_id', $user->id)->where('role_name', $role)->delete();
            }
            foreach ($wanted as $role) {
                if (! $user->hasRole($role)) {
                    $user->assignRole($role);
                    DB::table('sso_role_grants')->insert(['user_id' => $user->id, 'role_name' => $role, 'created_at' => now(), 'updated_at' => now()]);
                }
            }

            return $user->fresh();
        });
    }

    /** True when this user's local roles call for two-step sign-in. */
    public function needsMfa(User $user): bool
    {
        if ($user->hasAnyRole(config('bkesari_sso.mfa_roles'))) {
            return true;
        }

        return TwoFactorAuthentication::where('user_id', $user->id)->whereNotNull('confirmed_at')->exists();
    }

    public function hubUrl(string $path): string
    {
        return config('bkesari_sso.hub_url').$path;
    }

    /** The current request's path as the browser sees it, prefix included. */
    public function publicPath(Request $request): string
    {
        $full = url()->full();
        $path = (string) parse_url($full, PHP_URL_PATH);
        $query = parse_url($full, PHP_URL_QUERY);

        return ($path === '' ? '/' : $path).($query ? '?'.$query : '');
    }
}
