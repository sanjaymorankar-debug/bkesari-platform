<?php

namespace App\Http\Middleware;

use App\Services\BkesariSso as Sso;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

/**
 * Central login (bkesari.com) for Education. Appended to the web group; does
 * nothing unless BKESARI_SSO_INTROSPECT_URL is set.
 *
 *   central session, EDUCATION subscribed   → logged in here as the matching user
 *   central session, not subscribed         → subscribe page (pages) / 403 (JSON)
 *   central session ended                   → a session this bridge started is ended (single logout)
 *   enforced, no central session            → the local login pages lead to the central login
 *
 * Users whose Education roles already require two-step sign-in need the
 * central session to have passed TOTP; otherwise they are sent to step up.
 */
class BkesariSso
{
    private const SESSION_KEY = 'bkesari_sso_sub';

    private const LOCAL_AUTH_ROUTES = ['login', 'register', 'password.request', 'password.reset', 'two-factor.challenge'];

    public function __construct(private Sso $sso)
    {
    }

    public function handle(Request $request, Closure $next): Response
    {
        if (! $this->sso->enabled() || $request->is('up')) {
            return $next($request);
        }

        $identity = $this->sso->introspect($this->sso->token($request));
        $bridged = $request->hasSession() ? $request->session()->get(self::SESSION_KEY) : null;

        if ($identity !== null) {
            if (! $this->sso->entitled($identity)) {
                $this->endLocal($request);
                if ($request->expectsJson()) {
                    return response()->json(['error' => 'subscription_required', 'feature' => config('bkesari_sso.feature')], 403);
                }

                return redirect()->away($this->sso->hubUrl('/auth/subscribe/education'));
            }

            $user = Auth::user();
            if (! $user || $bridged !== $identity['user']['id'] || strcasecmp($user->email, $identity['user']['email']) !== 0) {
                $user = $this->sso->provision($identity);
                if ($this->sso->needsMfa($user) && ! ($identity['mfa'] ?? false)) {
                    $this->endLocal($request);

                    return redirect()->away($this->sso->hubUrl('/auth/step-up?return_to='.urlencode($this->sso->publicPath($request))));
                }
                Auth::guard('web')->login($user);
                $request->session()->regenerate();
                $request->session()->put(self::SESSION_KEY, $identity['user']['id']);
            } elseif ($this->sso->needsMfa($user) && ! ($identity['mfa'] ?? false)) {
                $this->endLocal($request);

                return redirect()->away($this->sso->hubUrl('/auth/step-up?return_to='.urlencode($this->sso->publicPath($request))));
            }

            if ($request->routeIs(...self::LOCAL_AUTH_ROUTES)) {
                return redirect()->route('dashboard');
            }

            return $next($request);
        }

        // No central session.
        if ($bridged !== null) {
            // The central session this one came from has ended.
            $this->endLocal($request);
        }

        if (config('bkesari_sso.enforce')) {
            if (Auth::check()) {
                // A session from the local password login, which is off now.
                $this->endLocal($request);
            }
            if ($request->routeIs(...self::LOCAL_AUTH_ROUTES)) {
                return redirect()->away($this->sso->hubUrl('/auth/login?return_to='.urlencode($this->prefixed('/dashboard'))));
            }
        }

        return $next($request);
    }

    /** '/dashboard' as the browser sees it under the hub, e.g. '/edu/dashboard'. */
    private function prefixed(string $path): string
    {
        $base = rtrim((string) parse_url((string) config('app.url'), PHP_URL_PATH), '/');

        return $base.$path;
    }

    private function endLocal(Request $request): void
    {
        if (Auth::check()) {
            Auth::guard('web')->logout();
        }
        if ($request->hasSession()) {
            $request->session()->forget(self::SESSION_KEY);
            $request->session()->invalidate();
            $request->session()->regenerateToken();
        }
    }
}
