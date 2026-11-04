<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\App;
use Symfony\Component\HttpFoundation\Response;

/**
 * Shows the page in the language picked in the bkesari shell.
 *
 * The shell's language control (and kesari.js) writes the choice to the
 * `k_lang` cookie, Path=/, shared by every project on the domain. It is the
 * only input: nothing about the visitor's account decides it, so a parent
 * reading in Marathi on a shared phone does not change anyone else's pages.
 * Anything that is not one of the three languages falls back to English.
 */
class SetLocale
{
    public const COOKIE = 'k_lang';

    public const LOCALES = ['en', 'mr', 'hi'];

    public function handle(Request $request, Closure $next): Response
    {
        App::setLocale(self::fromCookie($request->cookies->get(self::COOKIE)));

        return $next($request);
    }

    public static function fromCookie(mixed $value): string
    {
        $value = is_string($value) ? strtolower(trim($value)) : '';

        return in_array($value, self::LOCALES, true) ? $value : 'en';
    }
}
