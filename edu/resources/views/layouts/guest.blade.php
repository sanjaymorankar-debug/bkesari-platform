<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}" data-project="education" data-locale="{{ app()->getLocale() }}">
    <head>
        @include('layouts.partials.head')
    </head>
    <body class="font-sans antialiased">
        <a href="#main-content" class="k-skip">{{ __('Skip to main content') }}</a>

        <div data-bkesari-menu data-me-url="{{ url('/shell/me') }}" class="contents"></div>

        <div id="main" class="contents"></div>
        <main id="main-content" class="k-main k-main--narrow" tabindex="-1">
            <div class="k-card edu-auth">
                <a href="{{ route('home') }}" wire:navigate class="edu-project">
                    <x-application-logo class="edu-project__icon" />
                    <span>{{ __('Education') }}</span>
                </a>

                {{ $slot }}

                <p class="edu-auth__separate">
                    <strong>{{ __('This is a separate account for Education.') }}</strong>
                    {{ __('Signing in here does not sign you in to other bkesari projects, and their accounts do not work here.') }}
                </p>
            </div>
        </main>
    </body>
</html>
