<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * The built-in administrators, smorankar and sonalimorankar (D-036): owner
 * accounts in every bkesari project, each one an account of that project's
 * own. Here they are system_admin, and they sign in on the password tab with
 * their username (in the email field) and the one password whose bcrypt hash
 * is BUILTIN_ADMIN_PASSWORD_BCRYPT (config services.builtin_admins). The
 * hub's `node scripts/hash-builtin-admin-password.js` prints that line.
 *
 * - Unset, blank or not a $2y$ bcrypt hash: the built-in sign-in is off, and
 *   the username gets the answer any wrong password gets.
 * - Each username is one row, <username>@builtin.bkesari.com, made at the
 *   first sign-in and the same row every time after.
 * - Their domain is reserved: nobody signs up with it, asks for a code or a
 *   password reset for it, or puts it on an account. The password sign-in
 *   takes no address on it either, so the username is the only way in.
 * - The accounts have no password of their own (a random hash nobody knows)
 *   and cannot set one.
 */
final class BuiltinAdmins
{
    public const USERNAMES = ['smorankar', 'sonalimorankar'];

    public const EMAIL_DOMAIN = 'builtin.bkesari.com';

    public const ROLE = 'system_admin';

    /** A bcrypt hash as PHP writes it: $2y$, a two-digit cost, 53 characters of salt and digest. */
    private const BCRYPT = '/^\$2y\$(0[4-9]|[12]\d|3[01])\$[.\/A-Za-z0-9]{53}$/';

    /** The canonical username, or null when $value is not one of the two (case and spaces aside). */
    public static function username(?string $value): ?string
    {
        $name = Str::lower(trim((string) $value));

        return in_array($name, self::USERNAMES, true) ? $name : null;
    }

    /** True for an address on the reserved domain, however it is typed. */
    public static function isReservedEmail(?string $email): bool
    {
        return str_ends_with(Str::lower(trim((string) $email)), '@'.self::EMAIL_DOMAIN);
    }

    public static function isBuiltin(?User $user): bool
    {
        return $user !== null && self::isReservedEmail($user->email);
    }

    public static function emailFor(string $username): string
    {
        return $username.'@'.self::EMAIL_DOMAIN;
    }

    /** The configured hash, or null when the built-in sign-in is off. */
    public static function passwordHash(): ?string
    {
        $hash = trim((string) config('services.builtin_admins.password_bcrypt'));

        return preg_match(self::BCRYPT, $hash) === 1 ? $hash : null;
    }

    /** True when $password is the built-in administrators' password and the sign-in is on. */
    public static function passwordMatches(string $password): bool
    {
        $hash = self::passwordHash();

        return $hash !== null && Hash::check($password, $hash);
    }

    /**
     * The account $username (canonical) signs in to: found, or made at the
     * first sign-in, verified, and system_admin.
     */
    public static function account(string $username): User
    {
        return DB::transaction(function () use ($username) {
            $made = User::firstOrCreate(
                ['email' => self::emailFor($username)],
                ['name' => $username, 'password' => Hash::make(Str::random(64))],
            );
            // Held to the end of the transaction, so two first sign-ins at
            // once take turns and the second finds the role already given.
            $user = User::whereKey($made->getKey())->lockForUpdate()->firstOrFail();

            if ($user->hasRole(self::ROLE)) {
                if ($user->email_verified_at === null) {
                    $user->forceFill(['email_verified_at' => now()])->save();
                }

                return $user;
            }

            // The row becomes a built-in administrator now. If it was there
            // before (made with this address before the domain was reserved),
            // it changes hands as an account does at its first emailed code
            // (D-035): a password nobody knows, and every earlier session
            // ends, so whoever made it never holds system_admin.
            $user->forceFill([
                'name' => $username,
                'email_verified_at' => $user->email_verified_at ?? now(),
                'password' => $made->wasRecentlyCreated ? $user->password : Hash::make(Str::random(64)),
            ])->save();
            if (! $made->wasRecentlyCreated) {
                EndSessions::forUser($user);
            }
            $user->assignRole(self::ROLE);

            return $user;
        });
    }
}
