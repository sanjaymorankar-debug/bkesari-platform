{{--
    Shared <head> for both layouts.

    Kesari (the bkesari design system) and the app shell are served by the hub,
    on this app's own origin behind bkesari.com; HUB_ASSET_ORIGIN points a copy
    reached directly at https://bkesari.com instead (config/services.php).
    kesari.css comes first so the app's own stylesheet, which maps Tailwind's
    colours and font onto Kesari's --k-* tokens, can layer on top of it.
    kesari.js is not deferred: it sets the theme before the first paint.
--}}
@php($hubAssets = config('services.hub.asset_origin'))
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="csrf-token" content="{{ csrf_token() }}">
<meta name="theme-color" content="#0F766E">

{{-- WCAG 2.4.2 Page Titled. Every page was previously called
     "Education Accountability Platform", which tells a screen reader
     user nothing about where they are and makes browser history and
     tab lists useless. --}}
<title>{{ isset($title) ? $title.' — '.config('app.name') : config('app.name', 'Laravel') }}</title>

<link rel="stylesheet" href="{{ $hubAssets }}/kesari-ui/1.0.0/kesari.css">
<script src="{{ $hubAssets }}/kesari-ui/1.0.0/kesari.js"></script>
<script>
    // The page is rendered on the server in the language of the k_lang
    // cookie (App\Http\Middleware\SetLocale). When the shell's language
    // control, or kesari.js on a first visit, settles on another language,
    // write the cookie and ask for the page again, once.
    window.addEventListener('kesari:lang', function (event) {
        var want = event.detail && event.detail.lang;
        var have = document.documentElement.getAttribute('data-locale');
        if (!want || want === have) return;
        try {
            if (sessionStorage.getItem('edu.lang') === want) return;
            sessionStorage.setItem('edu.lang', want);
        } catch (e) { return; }
        document.cookie = 'k_lang=' + want + '; Path=/; Max-Age=31536000; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : '');
        location.reload();
    });
    try {
        if (sessionStorage.getItem('edu.lang') === document.documentElement.getAttribute('data-locale')) sessionStorage.removeItem('edu.lang');
    } catch (e) {}

    // Livewire's wire:navigate swaps the <body>, which takes the shell with
    // it: put the shell back and let Kesari wire its controls again.
    document.addEventListener('livewire:navigated', function () {
        if (window.BKESARI_MENU && !document.getElementById('bk-menu-style')) window.BKESARI_MENU.mount(document);
        if (window.Kesari) window.Kesari.boot();
    });
</script>

@vite(['resources/css/app.css', 'resources/js/app.js'])

<script src="{{ $hubAssets }}/shared/menu.js" defer></script>
