import forms from '@tailwindcss/forms';

/*
 * Tailwind's colours and font, mapped onto the Kesari design system's tokens
 * (/kesari-ui/1.0.0/kesari.css, served by the bkesari hub), so the views
 * written with Tailwind classes take on Kesari without being rewritten:
 *
 *   indigo-*   -> the project accent (Education teal, --k-accent)
 *   gray-*     -> Kesari's warm neutrals (--k-ink, --k-muted, --k-border...)
 *   white      -> --k-surface (cards; and text on an accent fill)
 *   red/green/amber/yellow/orange/blue -> the danger/success/warning/info pairs
 *
 * Every token has its own dark value in kesari.css, so dark mode follows.
 * Each colour carries its light value as a fallback, so a page whose
 * kesari.css failed to load is still legible. The lighter steps are mixes of
 * the base token with the surface (CSS color-mix), because Kesari defines one
 * tint per colour rather than a ten-step scale.
 */
const k = (token, fallback) => `var(--k-${token}, ${fallback})`;
const mix = (token, fallback, pct) => `color-mix(in srgb, ${k(token, fallback)} ${pct}%, ${k('surface', '#FFFFFF')})`;

function scale(token, fallback, tintToken, tintFallback, deep) {
    return {
        50: k(tintToken, tintFallback),
        100: k(tintToken, tintFallback),
        200: mix(token, fallback, 30),
        300: mix(token, fallback, 50),
        400: mix(token, fallback, 75),
        500: k(token, fallback),
        600: k(token, fallback),
        700: deep,
        800: deep,
        900: deep,
        950: deep,
        DEFAULT: k(token, fallback),
    };
}

const accent = scale('accent', '#0F766E', 'accent-tint', '#E0F5F2', k('accent-hover', '#0B5C56'));
const danger = scale('danger', '#B91C1C', 'danger-tint', '#FEE2E2', k('danger', '#B91C1C'));
const success = scale('success', '#15803D', 'success-tint', '#DCFCE7', k('success', '#15803D'));
const warning = scale('warning', '#B45309', 'warning-tint', '#FEF3C7', k('warning', '#B45309'));
const info = scale('info', '#1D4ED8', 'info-tint', '#DBEAFE', k('info', '#1D4ED8'));

const neutral = {
    50: k('page', '#FAF8F5'),
    100: k('surface-2', '#F5F3F0'),
    200: k('border', '#E7E5E4'),
    300: k('border-strong', '#A8A29E'),
    400: k('faint', '#78716C'),
    500: k('muted', '#57534E'),
    600: k('muted', '#57534E'),
    700: k('ink', '#1C1917'),
    800: k('ink', '#1C1917'),
    900: k('ink', '#1C1917'),
    950: k('ink', '#1C1917'),
};

/** @type {import('tailwindcss').Config} */
export default {
    // Only files that are in the repository, so a build gives the same CSS on
    // every machine. Breeze also scanned ./storage/framework/views, the views
    // compiled on whichever machine ran the build, which pulled in classes
    // from Laravel's error pages and, when the views had changed since, left
    // out ones the app now uses. Livewire's own pagination view is listed
    // instead, because every paginated list here renders it.
    content: [
        './vendor/laravel/framework/src/Illuminate/Pagination/resources/views/*.blade.php',
        './vendor/livewire/livewire/src/Features/SupportPagination/views/*.blade.php',
        './resources/views/**/*.blade.php',
    ],

    // Kesari's dark mode: the system setting unless the page is pinned with
    // data-theme="light", and data-theme="dark" always.
    darkMode: ['variant', [
        '@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) & }',
        ':root[data-theme="dark"] &',
    ]],

    theme: {
        extend: {
            colors: {
                primary: { ...accent, DEFAULT: k('accent', '#0F766E') },
                accent,
                brand: { DEFAULT: k('brand', '#C2560A'), tint: k('brand-tint', '#FDF1E8') },
                ink: k('ink', '#1C1917'),
                muted: k('muted', '#57534E'),
                surface: { DEFAULT: k('surface', '#FFFFFF'), 2: k('surface-2', '#F5F3F0') },
                page: k('page', '#FAF8F5'),
                white: k('surface', '#FFFFFF'),
                gray: neutral,
                slate: neutral,
                zinc: neutral,
                indigo: accent,
                teal: accent,
                red: danger,
                rose: danger,
                green: success,
                emerald: success,
                amber: warning,
                yellow: warning,
                orange: warning,
                blue: info,
                sky: info,
            },
            fontFamily: {
                sans: ['Mukta', 'system-ui', '-apple-system', '"Segoe UI"', '"Noto Sans Devanagari"', 'sans-serif'],
                display: ['"Tiro Devanagari Marathi"', 'Mukta', 'Georgia', 'serif'],
            },
            borderRadius: {
                md: k('radius-sm', '8px'),
                lg: k('radius', '12px'),
                xl: k('radius-lg', '20px'),
            },
            boxShadow: {
                sm: k('shadow-1', '0 1px 2px rgba(28,25,23,.06)'),
                DEFAULT: k('shadow-1', '0 1px 2px rgba(28,25,23,.06)'),
                md: k('shadow-2', '0 4px 12px rgba(28,25,23,.08)'),
                lg: k('shadow-2', '0 4px 12px rgba(28,25,23,.08)'),
                xl: k('shadow-3', '0 16px 40px rgba(28,25,23,.16)'),
            },
        },
    },

    plugins: [forms],
};
