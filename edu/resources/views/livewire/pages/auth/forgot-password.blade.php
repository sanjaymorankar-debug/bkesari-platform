<?php

use Illuminate\Support\Facades\Password;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

new #[Layout('layouts.guest')] class extends Component
{
    public string $email = '';

    /**
     * Send a password reset link to the provided email address.
     */
    public function sendPasswordResetLink(): void
    {
        $this->validate([
            'email' => ['required', 'string', 'email'],
        ]);

        // We will send the password reset link to this user. Once we have attempted
        // to send the link, we will examine the response then see the message we
        // need to show to the user. Finally, we'll send out a proper response.
        $status = Password::sendResetLink(
            $this->only('email')
        );

        if ($status != Password::RESET_LINK_SENT) {
            $this->addError('email', __($status));

            return;
        }

        $this->reset('email');

        session()->flash('status', __($status));
    }

    public function rendering($view): void
    {
        $view->title(__('Reset your password'));
    }
}; ?>

<div>
    <h1>{{ __('Reset your password') }}</h1>
    <p class="k-muted">{{ __('Forgot your password? No problem. Just let us know your email address and we will email you a password reset link that will allow you to choose a new one.') }}</p>

    <x-auth-session-status class="mt-4" :status="session('status')" />

    <form wire:submit="sendPasswordResetLink" class="mt-4" novalidate>
        <div class="k-field">
            <x-input-label for="email" :value="__('Email')" />
            <x-text-input wire:model="email" id="email" type="email" name="email" required autofocus autocomplete="username" />
            <x-input-error :messages="$errors->get('email')" />
        </div>

        <button type="submit" class="k-btn k-btn--block" wire:loading.attr="aria-busy" wire:target="sendPasswordResetLink">{{ __('Email Password Reset Link') }}</button>
    </form>

    <p class="mt-6 mb-0">
        <a href="{{ route('sign-in') }}" wire:navigate class="k-link font-semibold">{{ __('Back to sign in') }}</a>
    </p>
</div>
