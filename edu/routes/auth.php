<?php

use App\Http\Controllers\Auth\SignOutController;
use App\Http\Controllers\Auth\VerifyEmailController;
use Illuminate\Support\Facades\Route;
use Livewire\Volt\Volt;

/*
 * Education's own accounts. Each screen answers at its original Breeze path
 * (which every redirect, link and test uses) and at the friendlier one the
 * bkesari projects share: /sign-in, /sign-up and /verify. The hub sends
 * /education/* to /edu/*, so /education/sign-in lands on /edu/sign-in.
 */
Route::middleware('guest')->group(function () {
    Volt::route('register', 'pages.auth.register')
        ->name('register');
    Volt::route('sign-up', 'pages.auth.register')
        ->name('sign-up');

    Volt::route('login', 'pages.auth.login')
        ->name('login');
    Volt::route('sign-in', 'pages.auth.login')
        ->name('sign-in');

    Volt::route('forgot-password', 'pages.auth.forgot-password')
        ->name('password.request');

    Volt::route('reset-password/{token}', 'pages.auth.reset-password')
        ->name('password.reset');

    Volt::route('two-factor-challenge', 'pages.auth.two-factor-challenge')
        ->name('two-factor.challenge');
});

Route::middleware('auth')->group(function () {
    Volt::route('verify-email', 'pages.auth.verify-email')
        ->name('verification.notice');
    Volt::route('verify', 'pages.auth.verify-email')
        ->name('verify');

    Route::get('verify-email/{id}/{hash}', VerifyEmailController::class)
        ->middleware(['signed', 'throttle:6,1'])
        ->name('verification.verify');

    Volt::route('confirm-password', 'pages.auth.confirm-password')
        ->name('password.confirm');
});

// Signing out, from the bkesari shell's account menu (JSON, X-CSRF-Token) or
// the app's own navigation (a form). Not behind `auth`: an expired session
// signing out again is not an error.
Route::post('logout', SignOutController::class)->name('logout');
