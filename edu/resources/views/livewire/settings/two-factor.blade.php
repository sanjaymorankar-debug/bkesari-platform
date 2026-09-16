<?php

use App\Models\TwoFactorAuthentication;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;
use PragmaRX\Google2FA\Google2FA;

new #[Layout('layouts.app')] class extends Component
{
    public ?TwoFactorAuthentication $twoFactor = null;
    public string $confirmCode = '';
    public ?array $freshRecoveryCodes = null;

    public function mount(): void
    {
        $this->twoFactor = TwoFactorAuthentication::where('user_id', Auth::id())->first();
    }

    public function startSetup(): void
    {
        $secret = (new Google2FA())->generateSecretKey();

        $this->twoFactor = TwoFactorAuthentication::updateOrCreate(
            ['user_id' => Auth::id()],
            ['secret' => $secret, 'recovery_codes' => null, 'confirmed_at' => null]
        );
    }

    public function confirm(): void
    {
        $this->validate(['confirmCode' => ['required', 'digits:6']]);

        $valid = (new Google2FA())->verifyKey($this->twoFactor->secret, $this->confirmCode);

        if (! $valid) {
            $this->addError('confirmCode', 'That code is incorrect or has expired. Try the current code from your app.');

            return;
        }

        $codes = collect(range(1, 8))->map(fn () => Str::random(4).'-'.Str::random(4))->all();

        $this->twoFactor->update([
            'confirmed_at' => now(),
            'recovery_codes' => $codes,
        ]);

        $this->freshRecoveryCodes = $codes;
        $this->confirmCode = '';
    }

    public function disable(): void
    {
        TwoFactorAuthentication::where('user_id', Auth::id())->delete();
        $this->twoFactor = null;
        $this->freshRecoveryCodes = null;
    }

    public function with(): array
    {
        return [
            'user' => Auth::user(),
        ];
    }
}; ?>

<div>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">Two-Factor Authentication</h2>
    </x-slot>

    <div class="py-8 max-w-xl mx-auto sm:px-6 lg:px-8">
        <div class="bg-white rounded-lg shadow p-6">
            @if ($twoFactor?->isEnabled())
                <div class="flex items-center gap-2 text-green-700 text-sm font-medium mb-4">
                    <span class="w-2 h-2 bg-green-500 rounded-full"></span> Two-factor authentication is enabled
                </div>

                @if ($freshRecoveryCodes)
                    <div class="bg-yellow-50 border border-yellow-200 rounded p-4 mb-4">
                        <p class="text-sm text-yellow-800 mb-2 font-medium">Save these recovery codes now — they won't be shown again. Each can be used once if you lose access to your authenticator app.</p>
                        <div class="grid grid-cols-2 gap-1 font-mono text-sm">
                            @foreach ($freshRecoveryCodes as $code)
                                <div>{{ $code }}</div>
                            @endforeach
                        </div>
                    </div>
                @endif

                <p class="text-sm text-gray-500 mb-4">You'll be asked for a code from your authenticator app each time you log in.</p>
                <x-danger-button wire:click="disable" wire:confirm="Disable two-factor authentication?">Disable 2FA</x-danger-button>
            @elseif ($twoFactor)
                <p class="text-sm text-gray-600 mb-4">
                    Scan this into your authenticator app (Google Authenticator, Authy, 1Password, etc.) — or enter the key manually — then confirm with the 6-digit code it generates.
                </p>
                <div class="bg-gray-50 rounded p-3 mb-4">
                    <p class="text-xs text-gray-500 mb-1">Manual entry key</p>
                    <p class="font-mono text-sm break-all">{{ $twoFactor->secret }}</p>
                </div>

                <form wire:submit="confirm" class="space-y-3">
                    <div>
                        <x-input-label for="confirmCode" value="6-digit code" />
                        <x-text-input wire:model="confirmCode" id="confirmCode" class="mt-1 w-full" inputmode="numeric" autocomplete="one-time-code" />
                        <x-input-error :messages="$errors->get('confirmCode')" class="mt-2" />
                    </div>
                    <x-primary-button>Confirm & Enable</x-primary-button>
                </form>
            @else
                <p class="text-sm text-gray-600 mb-4">
                    Two-factor authentication adds a second step at login using an authenticator app on your phone.
                    Recommended for School Admin and government officer accounts.
                </p>
                <x-primary-button wire:click="startSetup">Set Up Two-Factor Authentication</x-primary-button>
            @endif
        </div>
    </div>
</div>
