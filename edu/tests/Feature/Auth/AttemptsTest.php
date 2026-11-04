<?php

namespace Tests\Feature\Auth;

use App\Support\Attempts;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Sleep;
use Tests\TestCase;

/**
 * Sign-in attempts are counted one at a time per key (App\Support\Attempts),
 * so requests that arrive together each get a count of their own. Several
 * processes cannot race inside PHPUnit; holding the key's lock stands in for
 * the request that is counting at that moment.
 */
class AttemptsTest extends TestCase
{
    private const KEY = 'asha@example.com|203.0.113.9';

    public function test_an_attempt_is_counted_only_while_holding_its_keys_lock(): void
    {
        Sleep::fake(syncWithCarbon: true);
        $this->assertTrue(Attempts::lock(self::KEY)->get(), 'another request is counting');

        // It waits for the lock, and when it cannot have it, it is refused
        // rather than counted alongside the other.
        $this->assertSame(PHP_INT_MAX, Attempts::hit(self::KEY, 60));
        $this->assertSame(0, RateLimiter::attempts(self::KEY));
    }

    public function test_counts_follow_one_another_and_a_restart_starts_the_window_again(): void
    {
        $this->assertSame([1, 2, 3], array_map(fn () => Attempts::hit(self::KEY, 60), range(1, 3)));

        Attempts::restart(self::KEY, 900, 5);

        $this->assertSame(5, RateLimiter::attempts(self::KEY));
        $this->assertGreaterThan(60, RateLimiter::availableIn(self::KEY));
        $this->assertTrue(Attempts::lock(self::KEY)->get(), 'the lock was released');
    }
}
