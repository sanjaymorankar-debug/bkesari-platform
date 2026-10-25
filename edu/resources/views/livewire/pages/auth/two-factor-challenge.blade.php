<?php

use App\Models\TwoFactorAuthentication;
use App\Models\User;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Session;
use Illuminate\Validation\ValidationException;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;
use PragmaRX\Google2FA\Google2FA;

new #[Layout('layouts.guest')] class extends Component
{
    public string $code = '';
    public bool $useRecoveryCode = false;

    public function mount(): void
    {
        abort_unless(session('2fa_user_id'), 403);
    }

    /**
     * Wrong codes allowed per account per minute, the same as the password
     * step allows (LoginForm).
     */
    private const MAX_ATTEMPTS = 5;

    public function verify(): void
    {
        $userId = session('2fa_user_id');
        abort_unless($userId, 403);

        // Whoever reaches this screen already has the password, and the
        // password step clears its own limit on success, so without this the
        // six-digit code and the recovery codes could be guessed endlessly.
        // Keyed on the account rather than the address, so moving to another
        // address does not buy more guesses.
        $throttleKey = 'two-factor|'.$userId;

        if (RateLimiter::tooManyAttempts($throttleKey, self::MAX_ATTEMPTS)) {
            $seconds = RateLimiter::availableIn($throttleKey);

            throw ValidationException::withMessages([
                'code' => trans('auth.throttle', ['seconds' => $seconds, 'minutes' => ceil($seconds / 60)]),
            ]);
        }

        $user = User::findOrFail($userId);
        $twoFactor = TwoFactorAuthentication::where('user_id', $user->id)->firstOrFail();

        $this->validate(['code' => ['required', 'string']]);

        $verified = false;

        if ($this->useRecoveryCode) {
            $codes = $twoFactor->recovery_codes ?? [];
            if (in_array($this->code, $codes, true)) {
                $verified = true;
                $twoFactor->update(['recovery_codes' => array_values(array_diff($codes, [$this->code]))]);
            }
        } else {
            $verified = (new Google2FA())->verifyKey($twoFactor->secret, $this->code);
        }

        if (! $verified) {
            RateLimiter::hit($throttleKey);
            $this->addError('code', 'That code is not valid.');

            return;
        }

        RateLimiter::clear($throttleKey);
        Auth::login($user, session('2fa_remember', false));
        session()->forget(['2fa_user_id', '2fa_remember']);
        Session::regenerate();

        $this->redirectIntended(default: route('dashboard', absolute: false), navigate: true);
    }
}; ?>

<div>
    <p class="text-sm text-gray-600 mb-4">
        Enter the 6-digit code from your authenticator app.
    </p>

    <form wire:submit="verify">
        <div>
            <x-input-label for="code" :value="$useRecoveryCode ? 'Recovery code' : 'Authentication code'" />
            <x-text-input wire:model="code" id="code" class="block mt-1 w-full" inputmode="{{ $useRecoveryCode ? 'text' : 'numeric' }}" autocomplete="one-time-code" autofocus />
            <x-input-error :messages="$errors->get('code')" class="mt-2" />
        </div>

        <button type="button" wire:click="$toggle('useRecoveryCode')" class="text-sm text-indigo-600 hover:underline mt-3">
            {{ $useRecoveryCode ? 'Use authenticator app instead' : "Use a recovery code instead" }}
        </button>

        <div class="flex justify-end mt-4">
            <x-primary-button>Verify</x-primary-button>
        </div>
    </form>
</div>
