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
        // Behind the bkesari.com hub this app is reached at `/edu/` over
        // HTTPS, while the hub forwards to it over plain HTTP on the same
        // account. Without this, `request()->secure()` is false on a request
        // that reached the visitor's browser over TLS, and the client IP in
        // logs and rate limits is the hub's rather than the visitor's.
        //
        // `'*'` because the forwarding address on shared hosting is neither
        // fixed nor published, so there is no narrower set to name. The cost
        // is that a client reaching this site's own hostname directly can put
        // whatever it likes in `X-Forwarded-For`, which is worth knowing when
        // reading a rate limit. It cannot forge the links this app generates:
        // those are pinned to APP_URL in AppServiceProvider.
        $middleware->trustProxies(at: '*');

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
