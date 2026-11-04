<?php

namespace App\Services;

use App\Models\User;
use App\Support\BuiltinAdmins;
use App\Support\SignInCodes;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Signing in with a mobile number and a six-digit code sent by text message.
 *
 * SMS delivery is on hold (owner's decision, 4 Nov 2026): the sign-in screen
 * offers this only where SMS_WEBHOOK_URL is set (offered()). Codes by email
 * (App\Services\EmailSignIn) are the alternative to the password meanwhile.
 *
 * - The code (App\Support\SignInCodes) is random, kept only as a bcrypt
 *   hash, lasts 10 minutes, is used once, and is thrown away after 5 wrong
 *   tries.
 * - Sending is rate-limited per number (3 codes per 10 minutes) and per
 *   address (10 per hour), so the form cannot be used to flood a phone or
 *   run up the SMS bill, and guessing is bounded at 15 tries per 10 minutes.
 * - The answer to "send me a code" is the same whether or not an account has
 *   that number, so the form does not reveal who is registered.
 *
 * Where the text goes depends on the deployment (mode()):
 *   sms     SMS_WEBHOOK_URL is set: POST {"to": "+91…", "text": "…"} to it,
 *           with SMS_WEBHOOK_TOKEN as a Bearer token. Never shown on screen.
 *   screen  no provider, and APP_ENV is local or dev: the code is handed
 *           back to be shown on the page. Development only.
 *   off     no provider on any other APP_ENV (test, production, ...): no
 *           code is made, and people use email.
 */
class MobileSignIn
{
    public const CODE_LENGTH = SignInCodes::LENGTH;

    public const CODE_TTL_SECONDS = SignInCodes::TTL_SECONDS;

    public const MAX_TRIES = SignInCodes::MAX_TRIES;

    public const SENDS_PER_NUMBER = 3;

    public const SEND_WINDOW_SECONDS = 600;

    public const SENDS_PER_ADDRESS = 10;

    public const ADDRESS_WINDOW_SECONDS = 3600;

    public const MODE_SMS = 'sms';

    public const MODE_SCREEN = 'screen';

    public const MODE_OFF = 'off';

    private SignInCodes $codes;

    public function __construct()
    {
        $this->codes = new SignInCodes('mobile-sign-in');
    }

    public function mode(): string
    {
        if (filled(config('services.sms.webhook_url'))) {
            return self::MODE_SMS;
        }

        return SignInCodes::mayShowOnScreen() ? self::MODE_SCREEN : self::MODE_OFF;
    }

    public function available(): bool
    {
        return $this->mode() !== self::MODE_OFF;
    }

    /** Whether the sign-in screen offers a code by text message: only with an SMS provider. */
    public function offered(): bool
    {
        return $this->mode() === self::MODE_SMS;
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

        $wait = $this->codes->throttle(
            $mobile, self::SENDS_PER_NUMBER, self::SEND_WINDOW_SECONDS,
            $ip, self::SENDS_PER_ADDRESS, self::ADDRESS_WINDOW_SECONDS,
        );
        if ($wait !== null) {
            return ['status' => 'throttled', 'retryAfter' => $wait];
        }

        $user = User::where('mobile', $mobile)->first();
        // A built-in administrator signs in only with the username (D-036),
        // so a number put on one of those accounts opens nothing either.
        if (! $user || BuiltinAdmins::isBuiltin($user)) {
            // Nothing is sent, and the caller says the same as when it is.
            return ['status' => 'sent'];
        }

        $code = $this->codes->issue($mobile, $user->id);

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
            $this->codes->forget($mobile);
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
        $result = $this->codes->verify($mobile, $code);
        if ($result['status'] !== 'ok') {
            return $result;
        }

        $user = User::find($result['userId']);

        return $user && $user->mobile === $mobile ? ['status' => 'ok', 'user' => $user] : ['status' => 'expired'];
    }
}
