import defaultTheme from 'tailwindcss/defaultTheme';
import forms from '@tailwindcss/forms';

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

    theme: {
        extend: {
            fontFamily: {
                sans: ['Figtree', ...defaultTheme.fontFamily.sans],
            },
        },
    },

    plugins: [forms],
};
