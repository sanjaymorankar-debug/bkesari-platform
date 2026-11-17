<?php

namespace App\Support;

use Illuminate\Http\Request;
use Illuminate\Support\Str;

/**
 * Who the bkesari hub says the visitor is (D-039, docs/design/bkesari-id.md
 * section 3, "Identity headers"). The hub removes every X-Bkesari-* header a
 * client sent and, for a person with an active grant for Education, adds:
 *
 *   X-Bkesari-User     the hub user's id (digits)
 *   X-Bkesari-Email    the confirmed email, lower-case
 *   X-Bkesari-Role     parent | student | teacher | school_admin | admin
 *   X-Bkesari-Name     the display name, base64url of UTF-8 (may be empty)
 *   X-Bkesari-Project  edu
 *   X-Bkesari-Ts       Unix time in seconds
 *   X-Bkesari-Sig      base64url HMAC-SHA256, key HUB_PROXY_SECRET, over
 *                      "bkesari-id-v1\n<project>\n<user>\n<email>\n<role>\n<name>\n<ts>"
 *                      (<name> as sent, still base64url)
 *
 * They are believed only when HUB_PROXY_SECRET is set here, the signature
 * matches (timing-safe), the project is `edu` and the time is less than 60
 * seconds from now either way. Anything else and the headers are ignored
 * completely: fromRequest() returns null and Education's own sign-in works
 * as before.
 */
final class HubIdentity
{
    public const PROJECT = 'edu';

    public const VERSION = 'bkesari-id-v1';

    /** |now - ts| must be below this, in seconds. */
    public const MAX_SKEW = 60;

    public const HEADERS = [
        'X-Bkesari-User', 'X-Bkesari-Email', 'X-Bkesari-Role', 'X-Bkesari-Name',
        'X-Bkesari-Project', 'X-Bkesari-Ts', 'X-Bkesari-Sig',
    ];

    /**
     * The hub's Education roles (hub_projects.roles for `edu`) and the
     * Education role each one is. `admin` is Education's system admin.
     */
    public const ROLES = [
        'parent' => 'parent',
        'student' => 'student',
        'teacher' => 'teacher',
        'school_admin' => 'school_admin',
        'admin' => 'system_admin',
    ];

    private function __construct(
        public readonly string $hubUserId,
        public readonly string $email,
        public readonly string $hubRole,
        public readonly string $name,
    ) {}

    /** The Education role the hub's role stands for, or null for a role Education does not know. */
    public function role(): ?string
    {
        return self::ROLES[$this->hubRole] ?? null;
    }

    /** The name to give a new account: the hub's, else the email's local part. */
    public function displayName(): string
    {
        return $this->name !== '' ? $this->name : Str::before($this->email, '@');
    }

    /**
     * The signed identity on $request, or null when there is none to believe.
     * The role is not checked here: a signed role Education does not know is
     * the hub's mistake, which the caller logs (role() is null).
     */
    public static function fromRequest(Request $request, string $secret, int $now): ?self
    {
        if ($secret === '') {
            return null;
        }

        $values = [];
        foreach (self::HEADERS as $header) {
            $all = $request->headers->all(strtolower($header));
            // Exactly one of each; a name may be left out (it may be empty).
            if (count($all) > 1 || (count($all) === 0 && $header !== 'X-Bkesari-Name')) {
                return null;
            }
            $values[$header] = (string) ($all[0] ?? '');
        }

        [$user, $email, $role, $name, $project, $ts, $sig] = array_values($values);

        if ($project !== self::PROJECT
            || preg_match('/^\d{1,20}$/', $user) !== 1
            || preg_match('/^\d{1,12}$/', $ts) !== 1
            || abs($now - (int) $ts) >= self::MAX_SKEW
            || preg_match('/^[A-Za-z0-9_-]*={0,2}$/', $name) !== 1
            || $role === '' || $email === '') {
            return null;
        }

        $expected = self::base64url(hash_hmac('sha256', self::payload($project, $user, $email, $role, $name, $ts), $secret, true));
        if (! hash_equals($expected, rtrim($sig, '='))) {
            return null;
        }

        // Signed by the hub from here on; still, only a plausible address is used.
        $email = Str::lower(trim($email));
        if (strlen($email) > 255 || filter_var($email, FILTER_VALIDATE_EMAIL, FILTER_FLAG_EMAIL_UNICODE) === false) {
            return null;
        }

        return new self($user, $email, $role, self::decodeName($name));
    }

    /** The signed string, exactly as the contract writes it. */
    public static function payload(string $project, string $user, string $email, string $role, string $name, string $ts): string
    {
        return implode("\n", [self::VERSION, $project, $user, $email, $role, $name, $ts]);
    }

    private static function base64url(string $bytes): string
    {
        return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
    }

    /** The display name: UTF-8, no control characters, at most 255 characters; '' when unreadable. */
    private static function decodeName(string $raw): string
    {
        $bytes = base64_decode(strtr(rtrim($raw, '='), '-_', '+/'), true);
        if ($bytes === false || ! mb_check_encoding($bytes, 'UTF-8')) {
            return '';
        }

        return mb_substr(trim((string) preg_replace('/\p{Cc}+/u', ' ', $bytes)), 0, 255);
    }
}
