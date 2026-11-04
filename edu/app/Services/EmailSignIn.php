<?php

namespace App\Services;

use App\Mail\SignInCodeMail;
use App\Models\User;
use App\Support\BuiltinAdmins;
use App\Support\EndSessions;
use App\Support\SignInCodes;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Throwable;

/**
 * Signing in with a six-digit code sent to the account's email address, next
 * to the password. It replaces the text message while SMS is on hold (owner's
 * decision, 4 Nov 2026); mail goes out through the app's mailer, Hostinger's
 * SMTP on every tier (MAIL_* in .env, DEPLOY.md Part 2).
 *
 * - The code (App\Support\SignInCodes) is random, kept only as a bcrypt
 *   hash, lasts 10 minutes, is used once, and is thrown away after 5 wrong
 *   tries.
 * - Sending is rate-limited per email address (3 codes per 10 minutes) and
 *   per IP address (10 per hour), so the form cannot be used to flood
 *   someone's inbox, and guessing is bounded at 15 tries per 10 minutes.
 * - The answer to "email me a code" is the same whether or not an account
 *   has that address, and an unknown address gets no mail, so the form does
 *   not reveal who is registered.
 * - The mail is written in the language the page is in (en, mr or hi).
 *
 * Where the code goes depends on the deployment (mode()):
 *   mail    the app's default mailer delivers (anything but the `log` and
 *           `array` transports): the code is emailed, never shown.
 *   screen  nothing delivers, and APP_ENV is local or dev: the code is
 *           handed back to be shown on the page. Development only.
 *   off     nothing delivers on any other APP_ENV (test, production, ...):
 *           no code is made, and the screen says to use the password.
 */
class EmailSignIn
{
    public const CODE_LENGTH = SignInCodes::LENGTH;

    public const CODE_TTL_SECONDS = SignInCodes::TTL_SECONDS;

    public const MAX_TRIES = SignInCodes::MAX_TRIES;

    public const SENDS_PER_EMAIL = 3;

    public const SEND_WINDOW_SECONDS = 600;

    public const SENDS_PER_ADDRESS = 10;

    public const ADDRESS_WINDOW_SECONDS = 3600;

    public const MODE_MAIL = 'mail';

    public const MODE_SCREEN = 'screen';

    public const MODE_OFF = 'off';

    /** Mail transports that deliver nothing: they keep the message in the log or in memory. */
    private const NOT_DELIVERING = ['log', 'array'];

    private SignInCodes $codes;

    public function __construct()
    {
        $this->codes = new SignInCodes('email-sign-in');
    }

    public static function normalize(string $email): string
    {
        return Str::lower(trim($email));
    }

    public function mode(): string
    {
        if ($this->mailDelivers()) {
            return self::MODE_MAIL;
        }

        return SignInCodes::mayShowOnScreen() ? self::MODE_SCREEN : self::MODE_OFF;
    }

    public function available(): bool
    {
        return $this->mode() !== self::MODE_OFF;
    }

    /**
     * Sends a code to $email (already normalised). `code` comes back only in
     * screen mode, and only when an account has the address. An address on
     * the built-in administrators' domain is refused outright (`reserved`):
     * they sign in only with their username (D-036).
     *
     * @return array{status: 'sent'|'throttled'|'unavailable'|'failed'|'reserved', code?: string, retryAfter?: int}
     */
    public function send(string $email, string $ip): array
    {
        if (BuiltinAdmins::isReservedEmail($email)) {
            return ['status' => 'reserved'];
        }

        if (! $this->available()) {
            return ['status' => 'unavailable'];
        }

        $wait = $this->codes->throttle(
            $email, self::SENDS_PER_EMAIL, self::SEND_WINDOW_SECONDS,
            $ip, self::SENDS_PER_ADDRESS, self::ADDRESS_WINDOW_SECONDS,
        );
        if ($wait !== null) {
            return ['status' => 'throttled', 'retryAfter' => $wait];
        }

        // Emails are stored lower-case (sign-up and the profile require it),
        // and on PostgreSQL the column is citext, so this matches however
        // the address was typed.
        $user = User::where('email', $email)->first();
        if (! $user) {
            // Nothing is sent, and the caller says the same as when it is.
            return ['status' => 'sent'];
        }

        $code = $this->codes->issue($email, $user->id);

        if ($this->mode() === self::MODE_SCREEN) {
            return ['status' => 'sent', 'code' => $code];
        }

        try {
            // Sent now, not queued: a failure is reported to the person and
            // the code thrown away, rather than left waiting for a mail that
            // never comes.
            Mail::to($user)
                ->locale(app()->getLocale())
                ->send(new SignInCodeMail($code));
        } catch (Throwable $e) {
            $this->codes->forget($email);
            Log::warning('Email sign-in: the code could not be sent: '.$e->getMessage());

            return ['status' => 'failed'];
        }

        return ['status' => 'sent'];
    }

    /**
     * Checks a code. On success the code is spent and the account returned.
     *
     * @return array{status: 'ok'|'wrong'|'expired'|'locked', user?: User, triesLeft?: int}
     */
    public function verify(string $email, string $code): array
    {
        $result = $this->codes->verify($email, $code);
        if ($result['status'] !== 'ok') {
            return $result;
        }

        // The account must still have the address the code went to.
        $user = User::find($result['userId']);
        if (! $user || self::normalize((string) $user->email) !== $email) {
            return ['status' => 'expired'];
        }

        if ($user->email_verified_at === null) {
            // Nobody had proved this inbox: whoever set the account up with
            // the address (a password sign-up, say) may not be the person who
            // reads it. The first code makes the account the inbox owner's:
            // the address is confirmed, the old password is replaced by one
            // nobody knows ("Forgot password" sets a new one) and every
            // earlier session ends.
            DB::transaction(function () use ($user) {
                $user->forceFill(['email_verified_at' => now(), 'password' => Hash::make(Str::random(64))])->save();
                EndSessions::forUser($user);
            });
        }

        return ['status' => 'ok', 'user' => $user];
    }

    private function mailDelivers(): bool
    {
        $mailer = (string) config('mail.default');
        $transport = config("mail.mailers.{$mailer}.transport");

        return filled($transport) && ! in_array($transport, self::NOT_DELIVERING, true);
    }
}
