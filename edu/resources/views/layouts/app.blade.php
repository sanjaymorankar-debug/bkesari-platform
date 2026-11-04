<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}" data-project="education" data-locale="{{ app()->getLocale() }}">
    <head>
        @include('layouts.partials.head')
    </head>
    <body class="font-sans antialiased k-has-bottomnav">
        {{-- WCAG 2.4.1 Bypass Blocks. Without this a keyboard or screen reader
             user tabs through the whole navigation on every single page before
             reaching the content. Visible only when focused. --}}
        <a href="#main-content" class="k-skip">{{ __('Skip to main content') }}</a>

        {{-- The bkesari shell: logo, "Education", all projects, language,
             theme and the Education account menu (from /shell/me). --}}
        <div data-bkesari-menu data-me-url="{{ url('/shell/me') }}" class="contents"></div>

        {{-- id="main" is the target of the shell's own skip link; without an
             element of that id the shell would take over <main>'s id and
             break the skip link above. --}}
        <div class="k-layout" id="main">
            <livewire:layout.navigation />

            <main id="main-content" class="k-main min-w-0" tabindex="-1">
                @if (isset($header))
                    <header class="edu-page-head">
                        {{ $header }}
                    </header>
                @endif

                {{ $slot }}
            </main>
        </div>
    </body>
</html>
