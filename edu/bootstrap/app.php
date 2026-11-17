<?php

use App\Http\Middleware\HubIdentitySignIn;
use App\Http\Middleware\SetLocale;
use App\Http\Middleware\TrustHubProxy;
use Illuminate\Contracts\Auth\Middleware\AuthenticatesRequests;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Middleware\TrustProxies;
use Illuminate\Http\Request;
use Spatie\Permission\Middleware\PermissionMiddleware;
use Spatie\Permission\Middleware\RoleMiddleware;
use Spatie\Permission\Middleware\RoleOrPermissionMiddleware;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Behind the bkesari.com hub this app is reached at `/edu/`, and the
        // hub says who the visitor is. Only a request carrying the hub's
        // secret (HUB_PROXY_SECRET) has its forwarded headers believed; any
        // other is taken as it arrived, so a client reaching this site's own
        // hostname cannot choose the address the rate limits count (D-038).
        // The forwarding address on shared hosting is neither fixed nor
        // published, which is why the secret, not an address, says "the hub".
        // Links stay pinned to APP_URL in AppServiceProvider either way.
        // In place of the framework's TrustProxies, which would reset the list.
        $middleware->replace(TrustProxies::class, TrustHubProxy::class);

        // Education keeps its own accounts and its own session cookie
        // (`edu_sid`, config/session.php, scoped to the path this app is
        // published under). Behind the hub (D-039, docs/design/bkesari-id.md)
        // the person the hub vouches for in its signed X-Bkesari-* headers is
        // signed in to their Education account: HubIdentitySignIn, in the web
        // group after the session starts and, by the priority list, before
        // `auth` and `guest` (which the framework would otherwise sort ahead
        // of anything appended to the group). With HUB_PROXY_SECRET blank or
        // the headers not right it does nothing, and the sign-in below works
        // as before.
        $middleware->appendToGroup('web', HubIdentitySignIn::class);
        $middleware->prependToPriorityList(
            before: AuthenticatesRequests::class,
            prepend: HubIdentitySignIn::class,
        );

        // A session keeps the password it was signed in with (SessionGuard
        // stores its hash) and ends at its next request once the account's
        // password has changed. Deleting an account's stored sessions
        // (App\Support\EndSessions) cannot reach a sign-in that checked the
        // old password a moment before and saves its session just after.
        $middleware->authenticateSessions();

        // The language the visitor picked in the bkesari shell (the `k_lang`
        // cookie, en|mr|hi). The browser writes that cookie itself, so it is
        // read as plain text rather than run through the encrypter, which
        // would discard it as tampered.
        $middleware->encryptCookies(except: ['k_lang']);
        $middleware->appendToGroup('web', SetLocale::class);

        $middleware->alias([
            'role' => RoleMiddleware::class,
            'permission' => PermissionMiddleware::class,
            'role_or_permission' => RoleOrPermissionMiddleware::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );
    })->create();
