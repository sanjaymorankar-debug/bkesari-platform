<?php

namespace App\Livewire\Forms;

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

    #[Validate('required|string|email')]
    public string $email = '';

    #[Validate('required|string')]
    public string $password = '';

    #[Validate('boolean')]
    public bool $remember = false;

    /**
     * Attempt to authenticate the request's credentials.
     *
     * @throws ValidationException
     */
    public function authenticate(): void
    {
        $this->ensureIsNotRateLimited();

        if (! Auth::attempt($this->only(['email', 'password']), $this->remember)) {
            $attempts = RateLimiter::hit($this->throttleKey(), self::LOCKOUT_SECONDS);

            // The fifth miss starts a full 15 minutes, however long the five
            // took: the limiter's window otherwise runs from the first miss.
            if ($attempts >= self::MAX_ATTEMPTS) {
                RateLimiter::clear($this->throttleKey());
                RateLimiter::increment($this->throttleKey(), self::LOCKOUT_SECONDS, $attempts);

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
     * Get the authentication rate limiting throttle key.
     */
    protected function throttleKey(): string
    {
        return Str::transliterate(Str::lower($this->email).'|'.request()->ip());
    }
}
