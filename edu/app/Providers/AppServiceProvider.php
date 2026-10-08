<?php

namespace App\Providers;

use App\Routing\BasePathRedirector;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\ServiceProvider;
use Livewire\Mechanisms\FrontendAssets\FrontendAssets;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        if ($this->publishedPath() === '') {
            return;
        }

        // Done here rather than in boot() so the replacement is in place
        // before anything resolves `redirect`. See BasePathRedirector for
        // what it fixes.
        $this->app->extend('redirect', function ($redirector, $app) {
            $replacement = new BasePathRedirector($app['url']);

            if (isset($app['session.store'])) {
                $replacement->setSession($app['session.store']);
            }

            return $replacement;
        });
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        if ($this->publishedPath() === '') {
            return;
        }

        $this->serveUnderBasePath();
    }

    /**
     * The sub-path this app is published under, or '' when it is served at the
     * root of its own domain.
     *
     * Read from APP_URL rather than a setting of its own, so a deployment that
     * gives this app a domain to itself needs no configuration and gets none
     * of the behaviour below — which is how the test suite and `artisan serve`
     * carry on working unchanged.
     */
    private function publishedPath(): string
    {
        $appUrl = rtrim((string) config('app.url'), '/');

        if ($appUrl === '') {
            return '';
        }

        return rtrim((string) parse_url($appUrl, PHP_URL_PATH), '/');
    }

    /**
     * Teaches the app the sub-path it is published under.
     *
     * On bkesari.com this app is a tab, reached at `/edu/`, and the hub
     * forwards those requests with the `/edu` prefix removed — see
     * `portal/proxy.js`. That split is deliberate: Laravel matches routes
     * against the request path, so a prefix it did not know about would 404 on
     * every page, while `public/` is served by the web server at this site's
     * own root, so `/edu/build/app.js` has nowhere to come from unless the
     * prefix comes off.
     *
     * The consequence is that the app answers at its root but has to *write*
     * every URL with the prefix on, or the first link a visitor clicks takes
     * them out of the tab and onto the hub. Pinning the generator's root does
     * that, and it covers most of the job in one go: `route()`, `url()`,
     * `redirect()`, `asset()` and `@vite`, and Livewire's AJAX endpoint with
     * them — `data-update-uri` is a root-relative URL built from this same
     * root, which matters because the sign-in form has no `action` of its own
     * and posts there.
     *
     * What it does not cover is anything derived from the incoming request
     * instead of the generator, because the hub has already taken the prefix
     * off that. Those are handled one by one below.
     *
     * Two things are deliberately left alone. Pagination resolves its own base
     * path, but Livewire replaces that resolver with one reading the browser's
     * own URL as soon as a component mounts, and every list here pages through
     * Livewire with `wire:click` and no URL at all. And signed URLs would not
     * survive the trip, because `hasValidSignature()` rebuilds the URL from the
     * request, which arrives without the prefix, so the signature would never
     * match: nothing here signs a URL today (`MustVerifyEmail` is switched off
     * on the User model), but anything that starts to will need the prefix put
     * back before the signature is checked.
     *
     * One surprise worth knowing: outside a request — a queued job, a
     * scheduled command — Laravel builds a stand-in request out of APP_URL, so
     * `getBaseUrl()` is `/edu` there and `route(..., absolute: false)` comes
     * back *without* the prefix, the opposite of what happens in a real
     * request. Absolute URLs are right in both, which is what mail and
     * notifications use.
     */
    private function serveUnderBasePath(): void
    {
        $appUrl = rtrim((string) config('app.url'), '/');

        URL::forceRootUrl($appUrl);

        // Without this the scheme is taken from the incoming request, which is
        // plain HTTP from the hub, and `formatRoot()` rewrites the `https://`
        // above back down to `http://` on every URL it builds.
        if (str_starts_with($appUrl, 'https://')) {
            URL::forceScheme('https');
        }

        // Livewire's <script src> is the one URL the generator never sees: it
        // is taken from the raw route path, so it comes out as
        // `/livewire/livewire.min.js` and is fetched from the hub, which does
        // not serve it — leaving the page with no Livewire at all, which here
        // means no sign-in form. The override is read from the route Livewire
        // actually registered rather than written out by hand, because the file
        // is `livewire.js` with debug on and `livewire.min.js` with it off, and
        // guessing wrong is a 404. Deferred until every provider has booted so
        // that Livewire has registered it; nothing reads this until a view
        // renders.
        $this->app->booted(function () use ($appUrl) {
            $route = $this->app->make(FrontendAssets::class)->javaScriptRoute;

            if ($route !== null) {
                config(['livewire.asset_url' => $appUrl.'/'.ltrim($route->uri, '/')]);
            }
        });
    }
}
