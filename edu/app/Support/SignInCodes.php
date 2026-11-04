<?php

namespace App\Support;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;

/**
 * One-time sign-in codes, shared by App\Services\EmailSignIn and
 * App\Services\MobileSignIn, each under a key prefix of its own
 * ('email-sign-in', 'mobile-sign-in'). The subject is what the code was sent
 * to: an email address, or a mobile number.
 *
 * - A code is six random digits, kept only as a bcrypt hash in the cache,
 *   valid 10 minutes, used once, and thrown away after 5 wrong tries.
 * - Every guarantee holds for requests that arrive together: tries are an
 *   atomic counter per code, a code is spent by whichever request claims it
 *   first, and the limits on asking for codes are decided on each request's
 *   own count (App\Support\Attempts).
 * - A code may be handed back to be shown on the page only on APP_ENV local
 *   or dev, and only when nothing is set up to deliver it (each service
 *   decides the second part). On test, production and anything else it is
 *   never shown.
 */
final class SignInCodes
{
    public const LENGTH = 6;

    public const TTL_SECONDS = 600;

    public const MAX_TRIES = 5;

    /** The APP_ENV values on which a code may be shown on screen. */
    public const SCREEN_ENVIRONMENTS = ['local', 'dev'];

    public function __construct(private readonly string $prefix) {}

    /** Local development and the dev tier (devedu.bkesari.com); never test or production. */
    public static function mayShowOnScreen(): bool
    {
        return app()->environment(self::SCREEN_ENVIRONMENTS);
    }

    /**
     * Counts this request against the limit per subject and the limit per
     * address. Returns null when both allow it, or the seconds until the
     * limit that refused it frees up.
     */
    public function throttle(string $subject, int $perSubject, int $subjectWindow, string $ip, int $perAddress, int $addressWindow): ?int
    {
        $limits = [
            [$this->subjectKey($subject), $perSubject, $subjectWindow],
            [$this->addressKey($ip), $perAddress, $addressWindow],
        ];
        foreach ($limits as [$key, $max]) {
            if (RateLimiter::tooManyAttempts($key, $max)) {
                return RateLimiter::availableIn($key);
            }
        }
        // The limit is decided on each request's own count (Attempts::hit),
        // not only on the check above: requests that arrive together all
        // pass that check before any of them is counted.
        foreach ($limits as [$key, $max, $window]) {
            if (Attempts::hit($key, $window) > $max) {
                return RateLimiter::availableIn($key);
            }
        }

        return null;
    }

    /** Makes a new code for $subject, replacing any earlier one, and returns it. Only its hash is kept. */
    public function issue(string $subject, int $userId): string
    {
        $code = str_pad((string) random_int(0, 10 ** self::LENGTH - 1), self::LENGTH, '0', STR_PAD_LEFT);
        Cache::put($this->codeKey($subject), [
            'user_id' => $userId,
            'hash' => Hash::make($code),
            'expires_at' => now()->addSeconds(self::TTL_SECONDS)->getTimestamp(),
        ], self::TTL_SECONDS);

        return $code;
    }

    public function forget(string $subject): void
    {
        Cache::forget($this->codeKey($subject));
    }

    /**
     * Checks a code. On success the code is spent and the account's id
     * returned; the caller checks the account still has $subject.
     *
     * @return array{status: 'ok'|'wrong'|'expired'|'locked', userId?: int, triesLeft?: int}
     */
    public function verify(string $subject, string $code): array
    {
        $key = $this->codeKey($subject);
        $entry = Cache::get($key);

        if (! is_array($entry) || ($entry['expires_at'] ?? 0) <= now()->getTimestamp()) {
            Cache::forget($key);

            return ['status' => 'expired'];
        }

        // The try is counted before the code is checked, with an atomic
        // increment on a counter of this code's own (its hash is salted, so a
        // new code starts a new count): requests that arrive together each
        // get their own number, so no more than MAX_TRIES are ever checked.
        // Reading the entry, adding one and writing it back would let every
        // request that read it first through as the first try.
        $remaining = max(1, $entry['expires_at'] - now()->getTimestamp());
        $codeId = hash('sha256', (string) $entry['hash']);
        $triesKey = $key.':tries:'.$codeId;
        Cache::add($triesKey, 0, $remaining);
        $tries = Cache::increment($triesKey);

        if ($tries === false) {
            return ['status' => 'expired'];
        }
        if ($tries > self::MAX_TRIES) {
            Cache::forget($key);

            return ['status' => 'locked'];
        }

        $code = preg_replace('/\D+/', '', $code);
        if (strlen($code) === self::LENGTH && Hash::check($code, $entry['hash'])) {
            // Spent by whichever request claims it first (add() only writes a
            // key that is not there), so one code signs in once even when
            // several requests carry it at the same moment.
            if (! Cache::add($key.':spent:'.$codeId, true, $remaining)) {
                return ['status' => 'expired'];
            }
            Cache::forget($key);

            return ['status' => 'ok', 'userId' => (int) $entry['user_id']];
        }

        if ($tries >= self::MAX_TRIES) {
            Cache::forget($key);

            return ['status' => 'locked'];
        }

        return ['status' => 'wrong', 'triesLeft' => self::MAX_TRIES - $tries];
    }

    /** Where the code for $subject is kept (as a hash of $subject, never the address or number itself). */
    public function codeKey(string $subject): string
    {
        return $this->prefix.':code:'.hash('sha256', $subject);
    }

    private function subjectKey(string $subject): string
    {
        return $this->prefix.':send:'.hash('sha256', $subject);
    }

    private function addressKey(string $ip): string
    {
        return $this->prefix.':address:'.$ip;
    }
}
