<?php

use App\Livewire\Forms\LoginForm;
use App\Models\TwoFactorAuthentication;
use App\Models\User;
use App\Services\EmailSignIn;
use App\Services\MobileSignIn;
use App\Support\IndianMobile;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Session;
use Livewire\Attributes\Layout;
use Livewire\Attributes\Locked;
use Livewire\Volt\Component;

new #[Layout('layouts.guest')] class extends Component
{
    public LoginForm $form;

    /**
     * 'code' (a code sent by email), 'password' (email and password), or
     * 'mobile' (a code by text message, offered only where SMS is set up).
     */
    #[Locked]
    public string $method = 'password';

    /** A code by email: the address typed, and the code typed. */
    public string $codeEmail = '';

    public string $emailCode = '';

    /** The address a code was sent to, normalised; '' until one is sent. */
    #[Locked]
    public string $emailSentTo = '';

    /** APP_ENV local or dev with no mail server only: the code itself. */
    #[Locked]
    public ?string $shownEmailCode = null;

    /** A code by text message: the number typed, and the code typed. */
    public string $mobile = '';

    public string $code = '';

    /** The number a code was sent to, normalised; '' until one is sent. */
    #[Locked]
    public string $sentTo = '';

    /** APP_ENV local or dev with no SMS provider only: the code itself. */
    #[Locked]
    public ?string $shownCode = null;

    public function mount(MobileSignIn $mobileSignIn, EmailSignIn $emailSignIn): void
    {
        // A code first wherever one can actually be delivered: by text
        // message where SMS is set up, otherwise by email.
        $this->method = match (true) {
            $mobileSignIn->offered() => 'mobile',
            $emailSignIn->available() => 'code',
            default => 'password',
        };
    }

    public function useMethod(string $method): void
    {
        $this->method = match ($method) {
            'mobile' => app(MobileSignIn::class)->offered() ? 'mobile' : 'code',
            'code' => 'code',
            default => 'password',
        };
        $this->resetErrorBag();
    }

    /**
     * Handle an incoming authentication request. If the account has 2FA
     * confirmed, password auth alone doesn't finish the login — we log
     * back out immediately and hand off to the challenge page, which is
     * the only place Auth::login() runs for real.
     */
    public function login(): void
    {
        $this->validate([
            // An email address, or a built-in administrator's username (D-036).
            'form.email' => $this->form->emailRules(),
            'form.password' => ['required', 'string'],
            'form.remember' => ['boolean'],
        ]);

        $this->form->authenticate();

        $user = Auth::user();

        if ($this->hasTwoFactor($user)) {
            Auth::logout();
            $this->toTwoFactorChallenge($user, $this->form->remember);

            return;
        }

        Session::regenerate();

        $this->redirectIntended(default: route('dashboard', absolute: false), navigate: true);
    }

    public function sendEmailCode(EmailSignIn $emailSignIn): void
    {
        $this->resetErrorBag();
        $this->shownEmailCode = null;
        // Phones paste addresses with a space at either end.
        $this->codeEmail = trim($this->codeEmail);

        $this->validate(['codeEmail' => ['required', 'string', 'email', 'max:255']], [
            'codeEmail.required' => __('Enter your email address.'),
            'codeEmail.email' => __('Enter a valid email address.'),
            'codeEmail.max' => __('Enter a valid email address.'),
        ]);

        $email = EmailSignIn::normalize($this->codeEmail);
        $result = $emailSignIn->send($email, request()->ip());

        match ($result['status']) {
            'reserved' => $this->addError('codeEmail', __('This email address is reserved.')),
            'unavailable' => $this->addError('codeEmail', __('We could not send a code by email. Sign in with your password instead.')),
            'throttled' => $this->addError('codeEmail', __('Too many codes asked for. Try again in :minutes min, or sign in with your password.', [
                'minutes' => max(1, (int) ceil(($result['retryAfter'] ?? 60) / 60)),
            ])),
            'failed' => $this->addError('codeEmail', __('We could not send the email just now. Try again in a minute, or sign in with your password.')),
            default => null,
        };

        if ($result['status'] === 'sent') {
            $this->emailSentTo = $email;
            $this->emailCode = '';
            $this->shownEmailCode = $result['code'] ?? null;
        }
    }

    public function verifyEmailCode(EmailSignIn $emailSignIn): void
    {
        $this->resetErrorBag();

        if ($this->emailSentTo === '') {
            $this->addError('codeEmail', __('Ask for a code first.'));

            return;
        }

        $this->validate(['emailCode' => ['required', 'string']], ['emailCode.required' => __('Enter the 6-digit code.')]);

        $result = $emailSignIn->verify($this->emailSentTo, $this->emailCode);

        if ($result['status'] !== 'ok') {
            $this->emailCode = '';
            $this->dispatch('otp-reset');
            $this->addError('emailCode', $this->codeError($result));
            if ($result['status'] !== 'wrong') {
                $this->shownEmailCode = null;
            }

            return;
        }

        $this->signInWithCode($result['user']);
    }

    public function changeEmail(): void
    {
        $this->reset('emailSentTo', 'emailCode', 'shownEmailCode');
        $this->resetErrorBag();
    }

    public function sendCode(MobileSignIn $mobileSignIn): void
    {
        $this->resetErrorBag();
        $this->shownCode = null;

        // Offered only where SMS is set up (SMS delivery is on hold).
        if (! $mobileSignIn->offered()) {
            $this->addError('mobile', __('SMS sign-in is not available yet; use email.'));

            return;
        }

        $normalized = IndianMobile::normalize($this->mobile);
        if ($normalized === null) {
            $this->addError('mobile', __('Enter a 10-digit Indian mobile number, like 98765 43210.'));

            return;
        }

        $result = $mobileSignIn->send($normalized, request()->ip());

        match ($result['status']) {
            'unavailable' => $this->addError('mobile', __('SMS sign-in is not available yet; use email.')),
            'throttled' => $this->addError('mobile', __('Too many codes asked for. Try again in :minutes min, or sign in with email.', [
                'minutes' => max(1, (int) ceil(($result['retryAfter'] ?? 60) / 60)),
            ])),
            'failed' => $this->addError('mobile', __('We could not send the text message just now. Try again in a minute, or sign in with email.')),
            default => null,
        };

        if ($result['status'] === 'sent') {
            $this->sentTo = $normalized;
            $this->code = '';
            $this->shownCode = $result['code'] ?? null;
        }
    }

    public function verifyCode(MobileSignIn $mobileSignIn): void
    {
        $this->resetErrorBag();

        if ($this->sentTo === '') {
            $this->addError('mobile', __('Ask for a code first.'));

            return;
        }

        $this->validate(['code' => ['required', 'string']], ['code.required' => __('Enter the 6-digit code.')]);

        $result = $mobileSignIn->verify($this->sentTo, $this->code);

        if ($result['status'] !== 'ok') {
            $this->code = '';
            $this->dispatch('otp-reset');
            $this->addError('code', $this->codeError($result));
            if ($result['status'] !== 'wrong') {
                $this->shownCode = null;
            }

            return;
        }

        $this->signInWithCode($result['user']);
    }

    public function changeNumber(): void
    {
        $this->reset('sentTo', 'code', 'shownCode');
        $this->resetErrorBag();
    }

    /** @param  array{status: string, triesLeft?: int}  $result */
    private function codeError(array $result): string
    {
        return match ($result['status']) {
            'wrong' => trans_choice('That code is not right. :count try left.|That code is not right. :count tries left.', $result['triesLeft']),
            'locked' => __('Too many wrong codes. Ask for a new code.'),
            default => __('That code has expired or was never sent. Ask for a new code.'),
        };
    }

    /** A code proved the address or number; an account with 2FA still has to pass it. */
    private function signInWithCode(User $user): void
    {
        if ($this->hasTwoFactor($user)) {
            $this->toTwoFactorChallenge($user, false);

            return;
        }

        Auth::login($user);
        Session::regenerate();

        $this->redirectIntended(default: route('dashboard', absolute: false), navigate: true);
    }

    private function hasTwoFactor(User $user): bool
    {
        return TwoFactorAuthentication::where('user_id', $user->id)->whereNotNull('confirmed_at')->exists();
    }

    private function toTwoFactorChallenge(User $user, bool $remember): void
    {
        // With the password the first step was passed against: the challenge
        // ends if the account's password changes before it is answered.
        session([
            '2fa_user_id' => $user->id,
            '2fa_remember' => $remember,
            '2fa_password' => Auth::guard()->hashPasswordForCookie($user->getAuthPassword()),
        ]);
        $this->redirect(route('two-factor.challenge', absolute: false), navigate: true);
    }

    public function rendering($view): void
    {
        $view->title(__('Sign in'));
    }

    public function with(): array
    {
        return ['mobileOffered' => app(MobileSignIn::class)->offered()];
    }
}; ?>

<div>
    <h1>{{ __('Sign in') }}</h1>
    <p class="k-muted">{{ __('Find and compare schools, raise a concern safely, and follow your child’s progress.') }}</p>

    <x-auth-session-status class="mt-4" :status="session('status')" />

    <div class="k-tabs mt-4" role="tablist" aria-label="{{ __('How to sign in') }}">
        @if ($mobileOffered)
            <button type="button" role="tab" id="tab-mobile" @if ($method === 'mobile') aria-controls="panel-mobile" @endif
                aria-selected="{{ $method === 'mobile' ? 'true' : 'false' }}" wire:click="useMethod('mobile')">
                {{ __('Mobile number') }}
            </button>
        @endif
        <button type="button" role="tab" id="tab-code" @if ($method === 'code') aria-controls="panel-code" @endif
            aria-selected="{{ $method === 'code' ? 'true' : 'false' }}" wire:click="useMethod('code')">
            {{ __('Email me a code') }}
        </button>
        <button type="button" role="tab" id="tab-password" @if ($method === 'password') aria-controls="panel-password" @endif
            aria-selected="{{ $method === 'password' ? 'true' : 'false' }}" wire:click="useMethod('password')">
            {{ __('Password') }}
        </button>
    </div>

    @if ($method === 'mobile' && $mobileOffered)
        <div id="panel-mobile" role="tabpanel" aria-labelledby="tab-mobile">
            @if ($sentTo === '')
                <form wire:submit="sendCode" novalidate>
                    <div class="k-field">
                        <label for="mobile" class="k-label">{{ __('Mobile number') }}</label>
                        <div class="flex items-stretch gap-2">
                            <span class="k-input !w-auto flex items-center text-gray-600" aria-hidden="true">+91</span>
                            <input wire:model="mobile" id="mobile" name="mobile" type="tel" inputmode="tel" autocomplete="tel-national"
                                class="k-input" placeholder="98765 43210" required autofocus
                                aria-describedby="mobile-hint{{ $errors->has('mobile') ? ' mobile-error' : '' }}"
                                @error('mobile') aria-invalid="true" @enderror>
                        </div>
                        <p id="mobile-hint" class="k-hint">{{ __('We will text a 6-digit code to this number. It works for 10 minutes.') }}</p>
                        @error('mobile')
                            <p id="mobile-error" class="k-error" role="alert">{{ $message }}</p>
                        @enderror
                    </div>
                    <button type="submit" class="k-btn k-btn--block" wire:loading.attr="aria-busy" wire:target="sendCode">{{ __('Send code') }}</button>
                </form>
            @else
                <form wire:submit="verifyCode" novalidate>
                    <p>{{ __('Enter the 6-digit code we sent to :number.', ['number' => IndianMobile::mask($sentTo)]) }}
                        <span class="k-muted">{{ __('If no account uses this number, no code is sent.') }}</span></p>

                    @if ($shownCode)
                        <div class="k-banner k-banner--brand" role="status">
                            <p><strong>{{ __('Development only.') }}</strong> {{ __('No SMS provider is set up, so the code is shown here instead: :code', ['code' => $shownCode]) }}</p>
                        </div>
                    @endif
                    @error('mobile')
                        <p class="k-error" role="alert">{{ $message }}</p>
                    @enderror

                    <div class="k-field">
                        <span id="code-label" class="k-label">{{ __('Code') }}</span>
                        <div class="k-otp" role="group" aria-labelledby="code-label" data-k-otp="6" data-name="otp" wire:ignore
                            x-data x-init="window.Kesari && window.Kesari.wireOtp($el); $nextTick(() => $el.querySelector('input:not([type=hidden])')?.focus())"
                            x-on:kesari:otp="$wire.code = $event.detail.value"
                            x-on:otp-reset.window="$el.querySelectorAll('input').forEach((i) => { i.value = '' }); $el.querySelector('input:not([type=hidden])')?.focus()">
                            <input id="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6"
                                class="k-input !w-40" x-on:input="$wire.code = $event.target.value" aria-labelledby="code-label">
                        </div>
                        @error('code')
                            <p class="k-error" role="alert">{{ $message }}</p>
                        @enderror
                    </div>

                    <button type="submit" class="k-btn k-btn--block" wire:loading.attr="aria-busy" wire:target="verifyCode">{{ __('Sign in') }}</button>
                    <div class="k-row k-row--between mt-3">
                        <button type="button" class="k-btn k-btn--ghost" wire:click="changeNumber">{{ __('Change number') }}</button>
                        <button type="button" class="k-btn k-btn--ghost" wire:click="sendCode">{{ __('Send a new code') }}</button>
                    </div>
                </form>
            @endif
        </div>
    @elseif ($method === 'code')
        <div id="panel-code" role="tabpanel" aria-labelledby="tab-code">
            @if ($emailSentTo === '')
                <form wire:submit="sendEmailCode" id="email-code-request" novalidate>
                    <div class="k-field">
                        <label for="code-email" class="k-label">{{ __('Email') }}</label>
                        <input wire:model="codeEmail" id="code-email" name="email" type="email" autocomplete="email"
                            class="k-input" required autofocus
                            aria-describedby="code-email-hint{{ $errors->has('codeEmail') ? ' code-email-error' : '' }}"
                            @error('codeEmail') aria-invalid="true" @enderror>
                        <p id="code-email-hint" class="k-hint">{{ __('We will email a 6-digit code to this address. It works for 10 minutes.') }}</p>
                        @error('codeEmail')
                            <p id="code-email-error" class="k-error" role="alert">{{ $message }}</p>
                        @enderror
                    </div>
                    <button type="submit" class="k-btn k-btn--block" wire:loading.attr="aria-busy" wire:target="sendEmailCode">{{ __('Email me a code') }}</button>
                </form>
            @else
                <form wire:submit="verifyEmailCode" id="email-code-sign-in" novalidate>
                    <p>{{ __('Enter the 6-digit code we sent to :email.', ['email' => $emailSentTo]) }}
                        <span class="k-muted">{{ __('If no account uses this email, no code is sent.') }}</span></p>

                    @if ($shownEmailCode)
                        <div class="k-banner k-banner--brand" role="status">
                            <p><strong>{{ __('Development only.') }}</strong> {{ __('No mail server is set up, so the code is shown here instead: :code', ['code' => $shownEmailCode]) }}</p>
                        </div>
                    @endif
                    @error('codeEmail')
                        <p class="k-error" role="alert">{{ $message }}</p>
                    @enderror

                    <div class="k-field">
                        <span id="email-code-label" class="k-label">{{ __('Code') }}</span>
                        <div class="k-otp" role="group" aria-labelledby="email-code-label" data-k-otp="6" data-name="email-otp" wire:ignore
                            x-data x-init="window.Kesari && window.Kesari.wireOtp($el); $nextTick(() => $el.querySelector('input:not([type=hidden])')?.focus())"
                            x-on:kesari:otp="$wire.emailCode = $event.detail.value"
                            x-on:otp-reset.window="$el.querySelectorAll('input').forEach((i) => { i.value = '' }); $el.querySelector('input:not([type=hidden])')?.focus()">
                            <input id="email-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6"
                                class="k-input !w-40" x-on:input="$wire.emailCode = $event.target.value" aria-labelledby="email-code-label">
                        </div>
                        @error('emailCode')
                            <p class="k-error" role="alert">{{ $message }}</p>
                        @enderror
                    </div>

                    <button type="submit" class="k-btn k-btn--block" wire:loading.attr="aria-busy" wire:target="verifyEmailCode">{{ __('Sign in') }}</button>
                    <div class="k-row k-row--between mt-3">
                        <button type="button" class="k-btn k-btn--ghost" wire:click="changeEmail">{{ __('Change email') }}</button>
                        <button type="button" class="k-btn k-btn--ghost" wire:click="sendEmailCode">{{ __('Send a new code') }}</button>
                    </div>
                </form>
            @endif

            <p class="mt-4 mb-0">
                <button type="button" class="k-btn k-btn--ghost" wire:click="useMethod('password')">{{ __('Sign in with your password') }}</button>
            </p>
        </div>
    @else
        <div id="panel-password" role="tabpanel" aria-labelledby="tab-password">
            <form wire:submit="login" id="email-sign-in" novalidate>
                <div class="k-field">
                    <x-input-label for="email" :value="__('Email')" />
                    {{-- type="text": the built-in administrators type their username here (D-036). --}}
                    <x-text-input wire:model="form.email" id="email" type="text" inputmode="email" name="email" required autofocus autocomplete="username" autocapitalize="none" spellcheck="false" />
                    <x-input-error :messages="$errors->get('form.email')" />
                </div>

                <div class="k-field">
                    <x-input-label for="password" :value="__('Password')" />
                    <x-text-input wire:model="form.password" id="password" type="password" name="password" required autocomplete="current-password" />
                    <x-input-error :messages="$errors->get('form.password')" />
                </div>

                <label for="remember" class="k-check">
                    <input wire:model="form.remember" id="remember" type="checkbox" name="remember">
                    <span>{{ __('Remember me on this device') }}</span>
                </label>

                <button type="submit" class="k-btn k-btn--block mt-2" wire:loading.attr="aria-busy" wire:target="login">{{ __('Log in') }}</button>

                @if (Route::has('password.request'))
                    <p class="mt-4 mb-0">
                        <a href="{{ route('password.request') }}" wire:navigate>{{ __('Forgot your password?') }}</a>
                    </p>
                @endif
            </form>
        </div>
    @endif

    <p class="mt-6 mb-0">
        {{ __('New to Education?') }}
        <a href="{{ route('sign-up') }}" wire:navigate class="k-link font-semibold">{{ __('Create an account') }}</a>
    </p>
</div>
