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

        // Central login (bkesari.com). Inert unless BKESARI_SSO_INTROSPECT_URL
        // is set; see App\Http\Middleware\BkesariSso.
        $middleware->web(append: [\App\Http\Middleware\BkesariSso::class]);
        // It must run before `auth` decides the visitor is a guest, and route
        // middleware in the priority list would otherwise be sorted ahead of it.
        $middleware->prependToPriorityList(
            before: \Illuminate\Contracts\Auth\Middleware\AuthenticatesRequests::class,
            prepend: \App\Http\Middleware\BkesariSso::class,
        );

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
