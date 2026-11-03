<?php

namespace App\Support;

use Closure;
use Illuminate\Contracts\Cache\Lock;
use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\RateLimiter;

/**
 * Counting sign-in attempts exactly when requests arrive together (the
 * password step, the two-factor challenge, mobile codes asked for).
 *
 * RateLimiter::hit() is an add(), an increment(), and a put() when it thinks
 * the key expired in between. On a key's first hit of a window a request
 * that lost the add() but incremented first puts the count back to 1 after
 * others have counted: twelve processes hitting a fresh key at once on the
 * database cache store got back 1 2 2 3 3 4 4 5 5 6 7 8, so nine of them were
 * inside a limit of five. Counting while holding a short lock on the key
 * gives every request a count of its own.
 */
final class Attempts
{
    /** How long one count may hold its key's lock, and how long another waits for it. */
    public const LOCK_SECONDS = 5;

    /**
     * Counts one attempt on $key and returns the count, this one included. If
     * the key's lock cannot be had in time the answer is PHP_INT_MAX, so the
     * caller refuses: a crowd of requests on one key is not let through.
     */
    public static function hit(string $key, int $decaySeconds): int
    {
        return self::holding($key, fn () => RateLimiter::hit($key, $decaySeconds), PHP_INT_MAX);
    }

    /** Starts $key's window again from now, at $count attempts. */
    public static function restart(string $key, int $decaySeconds, int $count): void
    {
        self::holding($key, function () use ($key, $decaySeconds, $count) {
            RateLimiter::clear($key);
            RateLimiter::increment($key, $decaySeconds, $count);
        }, null);
    }

    /** The lock counting on $key holds (hashed: a key can be longer than the lock table's column). */
    public static function lock(string $key): Lock
    {
        return Cache::lock('attempts:'.sha1($key), self::LOCK_SECONDS);
    }

    private static function holding(string $key, Closure $callback, mixed $onTimeout): mixed
    {
        try {
            return self::lock($key)->block(self::LOCK_SECONDS, $callback);
        } catch (LockTimeoutException) {
            return $onTimeout;
        }
    }
}
