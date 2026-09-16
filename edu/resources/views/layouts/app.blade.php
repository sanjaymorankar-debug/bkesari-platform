<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta name="csrf-token" content="{{ csrf_token() }}">

        {{-- WCAG 2.4.2 Page Titled. Every page was previously called
             "Education Accountability Platform", which tells a screen reader
             user nothing about where they are and makes browser history and
             tab lists useless. --}}
        <title>{{ isset($title) ? $title.' — '.config('app.name') : config('app.name', 'Laravel') }}</title>

        <!-- Fonts -->
        <link rel="preconnect" href="https://fonts.bunny.net">
        <link href="https://fonts.bunny.net/css?family=figtree:400,500,600&display=swap" rel="stylesheet" />

        <!-- Scripts -->
        @vite(['resources/css/app.css', 'resources/js/app.js'])
    </head>
    <body class="font-sans antialiased">
        {{-- WCAG 2.4.1 Bypass Blocks. Without this a keyboard or screen reader
             user tabs through the whole navigation on every single page before
             reaching the content. Visible only when focused. --}}
        <a href="#main-content"
            class="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2
                focus:px-4 focus:py-2 focus:rounded focus:bg-indigo-600 focus:text-white">
            Skip to main content
        </a>

        <div class="min-h-screen bg-gray-100">
            <livewire:layout.navigation />

            <!-- Page Heading -->
            @if (isset($header))
                <header class="bg-white shadow">
                    <div class="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
                        {{ $header }}
                    </div>
                </header>
            @endif

            <!-- Page Content -->
            <main id="main-content" tabindex="-1">
                {{ $slot }}
            </main>
        </div>
    </body>
</html>
