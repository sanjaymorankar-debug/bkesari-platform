@props(['code', 'icon' => 'info', 'heading', 'text'])

{{-- Education's own error page, inside the bkesari shell so the way back
     home and the project switcher are still there. Deliberately free of
     Livewire and of anything that needs a signed-in user or the database:
     it can be rendered before the session has started (a URL that matches
     no route) and must not fail itself. --}}
<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}" data-project="education" data-locale="{{ app()->getLocale() }}">
    <head>
        @include('layouts.partials.head', ['title' => $heading])
    </head>
    {{-- data-project again on <body>: Livewire shows an error response from
         an action in its own overlay, which keeps the body but not <html>. --}}
    <body class="font-sans antialiased" data-project="education">
        <a href="#main-content" class="k-skip">{{ __('Skip to main content') }}</a>
        <div data-bkesari-menu data-me-url="{{ url('/shell/me') }}" class="contents"></div>
        <div id="main" class="contents"></div>
        <main id="main-content" class="k-main k-main--narrow" tabindex="-1">
            <div class="k-card k-empty edu-error">
                <span class="k-picon k-picon--xl"><x-k-icon :name="$icon" /></span>
                <p class="k-chip k-chip--plain">{{ __('Error :code', ['code' => $code]) }}</p>
                <h1>{{ $heading }}</h1>
                <p>{{ $text }}</p>
                <div class="k-row justify-center">
                    <a href="{{ route('home') }}" class="k-btn">{{ __('Go to Education home') }}</a>
                    <a href="{{ route('schools.index') }}" class="k-link-arrow">{{ __('Find a school') }} <x-k-icon name="arrow-right" /></a>
                </div>
            </div>
        </main>
    </body>
</html>
