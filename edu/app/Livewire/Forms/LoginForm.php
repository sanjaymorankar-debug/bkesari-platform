<?php

namespace App\Livewire\Forms;

use App\Support\Attempts;
use App\Support\BuiltinAdmins;
use Illuminate\Auth\Events\Lockout;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Livewire\Attributes\Validate;
use Livewire\Form;

class LoginForm extends Form
{
    /** Wrong passwords allowed for one email from one address before it locks. */
    public const MAX_ATTEMPTS = 5;

    /** How long that lock lasts, in seconds: 15 minutes from the fifth miss. */
    public const LOCKOUT_SECONDS = 900;

    /** An email address, or a built-in administrator's username (emailRules()). */
    #[Validate('required|string')]
    public string $email = '';

    #[Validate('required|string')]
    public string $password = '';

    #[Validate('boolean')]
    public bool $remember = false;

    /**
     * The rules for the email field: an email address, except that the
     * built-in administrators type their username there (D-036).
     *
     * @return list<string>
     */
    public function emailRules(): array
    {
        return BuiltinAdmins::username($this->email) !== null
            ? ['required', 'string']
            : ['required', 'string', 'email'];
    }

    /**
     * Attempt to authenticate the request's credentials.
     *
     * @throws ValidationException
     */
    public function authenticate(): void
    {
        $this->ensureIsNotRateLimited();

        // Counted before the password is checked, and decided on this
        // request's own count (Attempts::hit): requests that arrive together
        // all pass the check above before any of them is counted, so counting
        // only after a miss let each of them try a password.
        $attempts = Attempts::hit($this->throttleKey(), self::LOCKOUT_SECONDS);
        if ($attempts > self::MAX_ATTEMPTS) {
            event(new Lockout(request()));

            $this->throwLockedOut();
        }

        if (! $this->attempt()) {
            // The fifth miss starts a full 15 minutes, however long the five
            // took: the limiter's window otherwise runs from the first miss.
            if ($attempts >= self::MAX_ATTEMPTS) {
                Attempts::restart($this->throttleKey(), self::LOCKOUT_SECONDS, $attempts);

                $this->throwLockedOut();
            }

            $left = self::MAX_ATTEMPTS - $attempts;

            throw ValidationException::withMessages([
                'form.email' => $left <= 2
                    ? trans_choice('These credentials do not match our records. :count more wrong attempt locks sign-in for 15 minutes.|These credentials do not match our records. :count more wrong attempts lock sign-in for 15 minutes.', $left)
                    : __('These credentials do not match our records.'),
            ]);
        }

        RateLimiter::clear($this->throttleKey());
    }

    /** Checks the password and, when it is right, signs the account in. */
    private function attempt(): bool
    {
        $username = BuiltinAdmins::username($this->email);
        if ($username !== null) {
            // A built-in administrator: their one password, never a row's own.
            // With the hash unset or malformed this is the usual wrong answer.
            if (! BuiltinAdmins::passwordMatches($this->password)) {
                return false;
            }

            Auth::login(BuiltinAdmins::account($username), $this->remember);

            return true;
        }

        // Their addresses take no password at all: the username is the only
        // way in, so a row someone made with such an address opens for nobody.
        if (BuiltinAdmins::isReservedEmail($this->email)) {
            return false;
        }

        return Auth::attempt($this->only(['email', 'password']), $this->remember);
    }

    /**
     * Ensure the authentication request is not rate limited.
     *
     * Five wrong passwords lock sign-in for that email from that address for
     * 15 minutes, and the lock holds even for the right password: the point
     * is that guessing stops paying off, not that it slows down.
     */
    protected function ensureIsNotRateLimited(): void
    {
        if (! RateLimiter::tooManyAttempts($this->throttleKey(), self::MAX_ATTEMPTS)) {
            return;
        }

        event(new Lockout(request()));

        $this->throwLockedOut();
    }

    /** @throws ValidationException */
    protected function throwLockedOut(): never
    {
        $seconds = RateLimiter::availableIn($this->throttleKey());

        throw ValidationException::withMessages([
            'form.email' => __('Too many failed sign-in attempts. For your safety, sign-in for this email is locked for 15 minutes. Try again in :minutes min, or reset your password.', [
                'minutes' => max(1, (int) ceil($seconds / 60)),
            ]),
        ]);
    }

    /**
     * Get the authentication rate limiting throttle key: the email (or the
     * built-in username, however it is typed, so " SMORANKAR" and
     * "smorankar" share one count) and the address the request came from.
     */
    protected function throttleKey(): string
    {
        $who = BuiltinAdmins::username($this->email) ?? Str::lower($this->email);

        return Str::transliterate($who.'|'.request()->ip());
    }
}
