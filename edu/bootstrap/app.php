<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

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
        $middleware->replace(\Illuminate\Http\Middleware\TrustProxies::class, \App\Http\Middleware\TrustHubProxy::class);

        // Education keeps its own accounts: there is no shared sign-in in
        // front of it any more, and nothing the hub forwards is trusted as an
        // identity. The session cookie (config/session.php) is `edu_sid`,
        // scoped to the path this app is published under.
        //
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
        $middleware->appendToGroup('web', \App\Http\Middleware\SetLocale::class);

        $middleware->alias([
            'role' => \Spatie\Permission\Middleware\RoleMiddleware::class,
            'permission' => \Spatie\Permission\Middleware\PermissionMiddleware::class,
            'role_or_permission' => \Spatie\Permission\Middleware\RoleOrPermissionMiddleware::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );
    })->create();
