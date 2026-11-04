<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;

/**
 * Which forwarded headers to believe (decision D-038).
 *
 * The bkesari.com hub forwards /edu/ here and says who the visitor is in
 * X-Forwarded-For, with HUB_PROXY_SECRET in X-Bkesari-Proxy so this app can
 * tell the hub from anyone else. Only such a request gets its forwarded
 * address (and scheme, host, port) believed; any other request, such as one
 * sent straight to this site's own hostname, is taken as it arrived, so a
 * client cannot choose the address the rate limits count under.
 *
 * With no secret configured it keeps the old rule (every proxy trusted) and
 * warns once a day, rather than putting every visitor behind the hub on one
 * address, which would let one person's mistakes lock out everyone.
 */
class TrustHubProxy
{
    private const HEADERS = Request::HEADER_X_FORWARDED_FOR | Request::HEADER_X_FORWARDED_HOST
        | Request::HEADER_X_FORWARDED_PORT | Request::HEADER_X_FORWARDED_PROTO;

    private static bool $warned = false;

    public function handle(Request $request, Closure $next): Response
    {
        $secret = (string) config('services.hub.proxy_secret', '');
        $sent = (string) $request->headers->get('X-Bkesari-Proxy', '');
        $request->headers->remove('X-Bkesari-Proxy');

        if ($secret === '') {
            self::warnNoSecret();
            Request::setTrustedProxies(['0.0.0.0/0', '::/0'], self::HEADERS);
        } elseif ($sent !== '' && hash_equals($secret, $sent)) {
            // The hub itself: the one connection whose forwarded headers count.
            Request::setTrustedProxies([(string) $request->server->get('REMOTE_ADDR')], self::HEADERS);
        } else {
            Request::setTrustedProxies([], self::HEADERS);
        }

        return $next($request);
    }

    /**
     * At most once a day. The flag on the class is not enough by itself: under
     * PHP-FPM, as under `php artisan serve`, every request starts with fresh
     * static state, so it wrote this line on every request. The cache keeps the
     * mark between requests; without a cache it warns once per process.
     */
    private static function warnNoSecret(): void
    {
        if (self::$warned) {
            return;
        }
        self::$warned = true;

        try {
            if (! Cache::add('trust-hub-proxy:no-secret-warned', true, now()->addDay())) {
                return;
            }
        } catch (\Throwable) {
            // No cache to keep the mark in: warn, rather than not at all.
        }

        Log::warning('HUB_PROXY_SECRET is not set: every proxy is trusted, so a client can choose the address the rate limits count (D-038).');
    }
}
