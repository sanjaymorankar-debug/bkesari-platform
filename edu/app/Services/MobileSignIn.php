<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\RateLimiter;
use Throwable;

/**
 * Signing in with a mobile number and a six-digit code sent by text message.
 *
 * - The code is random, kept only as a bcrypt hash, lasts 10 minutes, is used
 *   once, and is thrown away after 5 wrong tries.
 * - Sending is rate-limited per number (3 codes per 10 minutes) and per
 *   address (10 per hour), so the form cannot be used to flood a phone or
 *   run up the SMS bill, and guessing is bounded at 15 tries per 10 minutes.
 * - The answer to "send me a code" is the same whether or not an account has
 *   that number, so the form does not reveal who is registered.
 *
 * Where the text goes depends on the deployment (mode()):
 *   sms     SMS_WEBHOOK_URL is set: POST {"to": "+91…", "text": "…"} to it,
 *           with SMS_WEBHOOK_TOKEN as a Bearer token.
 *   screen  no provider and APP_ENV is not production: the code is handed back
 *           to be shown on the page. For local development and tests only.
 *   off     no provider in production: mobile sign-in says it is not
 *           available yet, and people use email.
 */
class MobileSignIn
{
    public const CODE_LENGTH = 6;

    public const CODE_TTL_SECONDS = 600;

    public const MAX_TRIES = 5;

    public const SENDS_PER_NUMBER = 3;

    public const SEND_WINDOW_SECONDS = 600;

    public const SENDS_PER_ADDRESS = 10;

    public const ADDRESS_WINDOW_SECONDS = 3600;

    public const MODE_SMS = 'sms';

    public const MODE_SCREEN = 'screen';

    public const MODE_OFF = 'off';

    public function mode(): string
    {
        if (filled(config('services.sms.webhook_url'))) {
            return self::MODE_SMS;
        }

        return app()->environment('production') ? self::MODE_OFF : self::MODE_SCREEN;
    }

    public function available(): bool
    {
        return $this->mode() !== self::MODE_OFF;
    }

    /**
     * Sends a code to $mobile (already normalised, +91 and ten digits).
     * `code` comes back only in screen mode, and only when an account has
     * the number.
     *
     * @return array{status: 'sent'|'throttled'|'unavailable'|'failed', code?: string, retryAfter?: int}
     */
    public function send(string $mobile, string $ip): array
    {
        if (! $this->available()) {
            return ['status' => 'unavailable'];
        }

        foreach ([
            [$this->numberKey($mobile), self::SENDS_PER_NUMBER, self::SEND_WINDOW_SECONDS],
            [$this->addressKey($ip), self::SENDS_PER_ADDRESS, self::ADDRESS_WINDOW_SECONDS],
        ] as [$key, $max, $window]) {
            if (RateLimiter::tooManyAttempts($key, $max)) {
                return ['status' => 'throttled', 'retryAfter' => RateLimiter::availableIn($key)];
            }
        }
        RateLimiter::hit($this->numberKey($mobile), self::SEND_WINDOW_SECONDS);
        RateLimiter::hit($this->addressKey($ip), self::ADDRESS_WINDOW_SECONDS);

        $user = User::where('mobile', $mobile)->first();
        if (! $user) {
            // Nothing is sent, and the caller says the same as when it is.
            return ['status' => 'sent'];
        }

        $code = str_pad((string) random_int(0, 10 ** self::CODE_LENGTH - 1), self::CODE_LENGTH, '0', STR_PAD_LEFT);
        Cache::put($this->codeKey($mobile), [
            'user_id' => $user->id,
            'hash' => Hash::make($code),
            'tries' => 0,
            'expires_at' => now()->addSeconds(self::CODE_TTL_SECONDS)->getTimestamp(),
        ], self::CODE_TTL_SECONDS);

        if ($this->mode() === self::MODE_SCREEN) {
            return ['status' => 'sent', 'code' => $code];
        }

        try {
            Http::withToken((string) config('services.sms.webhook_token'))
                ->acceptJson()
                ->timeout(10)
                ->post((string) config('services.sms.webhook_url'), [
                    'to' => $mobile,
                    'text' => __('Your Education sign-in code is :code. It expires in 10 minutes. Do not share it with anyone.', ['code' => $code]),
                ])
                ->throw();
        } catch (Throwable $e) {
            Cache::forget($this->codeKey($mobile));
            Log::warning('Mobile sign-in: the SMS provider refused the message: '.$e->getMessage());

            return ['status' => 'failed'];
        }

        return ['status' => 'sent'];
    }

    /**
     * Checks a code. On success the code is spent and the account returned.
     *
     * @return array{status: 'ok'|'wrong'|'expired'|'locked', user?: User, triesLeft?: int}
     */
    public function verify(string $mobile, string $code): array
    {
        $key = $this->codeKey($mobile);
        $entry = Cache::get($key);

        if (! is_array($entry) || ($entry['expires_at'] ?? 0) <= now()->getTimestamp()) {
            Cache::forget($key);

            return ['status' => 'expired'];
        }

        // The try is counted before the code is checked, so two requests
        // racing each other cannot both get a free guess.
        $entry['tries']++;
        $remaining = max(1, $entry['expires_at'] - now()->getTimestamp());
        Cache::put($key, $entry, $remaining);

        $code = preg_replace('/\D+/', '', $code);
        if (strlen($code) === self::CODE_LENGTH && Hash::check($code, $entry['hash'])) {
            Cache::forget($key);
            $user = User::find($entry['user_id']);

            return $user && $user->mobile === $mobile ? ['status' => 'ok', 'user' => $user] : ['status' => 'expired'];
        }

        if ($entry['tries'] >= self::MAX_TRIES) {
            Cache::forget($key);

            return ['status' => 'locked'];
        }

        return ['status' => 'wrong', 'triesLeft' => self::MAX_TRIES - $entry['tries']];
    }

    private function codeKey(string $mobile): string
    {
        return 'mobile-sign-in:code:'.hash('sha256', $mobile);
    }

    private function numberKey(string $mobile): string
    {
        return 'mobile-sign-in:send:'.hash('sha256', $mobile);
    }

    private function addressKey(string $ip): string
    {
        return 'mobile-sign-in:address:'.$ip;
    }
}
