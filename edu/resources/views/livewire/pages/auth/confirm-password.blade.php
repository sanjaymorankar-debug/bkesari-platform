<?php

use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\ValidationException;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

new #[Layout('layouts.guest')] class extends Component
{
    public string $password = '';

    /**
     * Confirm the current user's password.
     */
    public function confirmPassword(): void
    {
        $this->validate([
            'password' => ['required', 'string'],
        ]);

        if (! Auth::guard('web')->validate([
            'email' => Auth::user()->email,
            'password' => $this->password,
        ])) {
            throw ValidationException::withMessages([
                'password' => __('auth.password'),
            ]);
        }

        session(['auth.password_confirmed_at' => time()]);

        $this->redirectIntended(default: route('dashboard', absolute: false), navigate: true);
    }

    public function rendering($view): void
    {
        $view->title(__('Confirm your password'));
    }
}; ?>

<div>
    <h1>{{ __('Confirm your password') }}</h1>
    <p class="k-muted">{{ __('This is a secure area of the application. Please confirm your password before continuing.') }}</p>

    <form wire:submit="confirmPassword" class="mt-4" novalidate>
        <div class="k-field">
            <x-input-label for="password" :value="__('Password')" />
            <x-text-input wire:model="password" id="password" type="password" name="password" required autofocus autocomplete="current-password" />
            <x-input-error :messages="$errors->get('password')" />
        </div>

        <button type="submit" class="k-btn k-btn--block" wire:loading.attr="aria-busy" wire:target="confirmPassword">{{ __('Confirm') }}</button>
    </form>
</div>
