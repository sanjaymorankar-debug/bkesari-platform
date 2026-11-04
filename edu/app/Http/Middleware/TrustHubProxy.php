<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
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
 * warns once, rather than putting every visitor behind the hub on one
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
            if (! self::$warned) {
                self::$warned = true;
                Log::warning('HUB_PROXY_SECRET is not set: every proxy is trusted, so a client can choose the address the rate limits count (D-038).');
            }
            Request::setTrustedProxies(['0.0.0.0/0', '::/0'], self::HEADERS);
        } elseif ($sent !== '' && hash_equals($secret, $sent)) {
            // The hub itself: the one connection whose forwarded headers count.
            Request::setTrustedProxies([(string) $request->server->get('REMOTE_ADDR')], self::HEADERS);
        } else {
            Request::setTrustedProxies([], self::HEADERS);
        }

        return $next($request);
    }
}
