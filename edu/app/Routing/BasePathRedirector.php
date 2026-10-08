<?php

namespace App\Routing;

use Illuminate\Routing\Redirector;

/**
 * Keeps the "intended" URL inside the path this app is published under.
 *
 * When a guest asks for a page that needs signing in, Laravel remembers where
 * they were going and sends them back there afterwards. It remembers it with
 * `UrlGenerator::full()`, which reads the URL straight off the incoming
 * request — and behind the bkesari.com hub that request has already had the
 * `/edu` prefix stripped from it, so what gets stored is the hub's address
 * with the app's path hung off it. Signing in then lands the visitor on a hub
 * page that does not exist, having thrown away the page they asked for.
 *
 * `UrlGenerator::current()` is the same path put through the generator, whose
 * root is pinned to APP_URL in AppServiceProvider, so it comes back with the
 * prefix on. It drops the query string, which is the one thing `full()` does
 * that matters here, so that goes back on by hand.
 *
 * Only `guest()` is overridden; every other redirect already runs through the
 * generator and arrives prefixed.
 */
class BasePathRedirector extends Redirector
{
    /**
     * Create a new redirect response, while putting the current URL in the
     * session.
     *
     * @param  string  $path
     * @param  int  $status
     * @param  array  $headers
     * @param  bool|null  $secure
     * @return \Illuminate\Http\RedirectResponse
     */
    public function guest($path, $status = 302, $headers = [], $secure = null)
    {
        $request = $this->generator->getRequest();

        $intended = $request->isMethod('GET') && $request->route() && ! $request->expectsJson()
            ? $this->currentUrlWithQuery()
            : $this->generator->previous();

        if ($intended) {
            $this->setIntendedUrl($intended);
        }

        return $this->to($path, $status, $headers, $secure);
    }

    /**
     * The URL being requested, as the visitor's browser addressed it.
     */
    protected function currentUrlWithQuery(): string
    {
        $url = $this->generator->current();
        $query = $this->generator->getRequest()->getQueryString();

        return $query === null || $query === '' ? $url : $url.'?'.$query;
    }
}
