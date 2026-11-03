<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Livewire\Actions\Logout;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

/**
 * POST /logout: signs out of Education only.
 *
 * The bkesari shell posts here as JSON with an X-CSRF-Token header (the token
 * from /shell/me) and then goes to the sign-in page itself; a plain form post
 * from the app's own navigation gets a redirect to the same place. Either way
 * the session is invalidated and the CSRF token rotated, and no other
 * project's account is touched.
 */
class SignOutController extends Controller
{
    public function __invoke(Request $request, Logout $logout): JsonResponse|RedirectResponse
    {
        $logout();

        if ($request->expectsJson() || $request->isJson()) {
            return response()->json(['signedOut' => true, 'next' => route('sign-in')]);
        }

        return redirect()->route('home');
    }
}
