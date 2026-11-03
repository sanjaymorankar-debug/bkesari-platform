<?php

use App\Livewire\Actions\Logout;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Session;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

new #[Layout('layouts.guest')] class extends Component
{
    /**
     * Send an email verification notification to the user.
     */
    public function sendVerification(): void
    {
        if (Auth::user()->hasVerifiedEmail()) {
            $this->redirectIntended(default: route('dashboard', absolute: false), navigate: true);

            return;
        }

        Auth::user()->sendEmailVerificationNotification();

        Session::flash('status', 'verification-link-sent');
    }

    /**
     * Log the current user out of the application.
     */
    public function logout(Logout $logout): void
    {
        $logout();

        $this->redirect(route('home'), navigate: true);
    }

    public function rendering($view): void
    {
        $view->title(__('Check your email'));
    }
}; ?>

<div>
    <h1>{{ __('Check your email') }}</h1>
    <p class="k-muted">{{ __('Thanks for signing up! Before getting started, could you verify your email address by clicking on the link we just emailed to you? If you didn\'t receive the email, we will gladly send you another.') }}</p>

    @if (session('status') == 'verification-link-sent')
        <div class="k-banner k-banner--success" role="status">
            <p>{{ __('A new verification link has been sent to the email address you provided during registration.') }}</p>
        </div>
    @endif

    <div class="k-row k-row--between mt-4">
        <button type="button" class="k-btn" wire:click="sendVerification">{{ __('Resend Verification Email') }}</button>
        <button type="button" class="k-btn k-btn--ghost" wire:click="logout">{{ __('Sign out') }}</button>
    </div>
</div>
