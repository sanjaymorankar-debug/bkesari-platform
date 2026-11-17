<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /shell/me: who is signed in to Education, for the bkesari app shell.
 *
 * The shell (/shared/menu.js, served by the hub) knows nobody: it asks each
 * project's own endpoint and shows the answer in the account menu. Signed in,
 * that is the name and email, how to sign out (the URL, the CSRF token it
 * must send as X-CSRF-Token, and where to go after), and a couple of links;
 * signed out, a 401 with where to sign in. Nothing here is shared with, or
 * trusted from, any other project.
 *
 * user.roles lists the account's Education role names (parent, student,
 * school_admin...), sorted, so the hub's "My projects" page can say what
 * access the person has here. Names only: never permissions, schools or
 * children, and never anything about anyone else.
 */
class ShellController extends Controller
{
    public function me(Request $request): JsonResponse
    {
        $headers = ['Cache-Control' => 'no-store, private', 'Vary' => 'Cookie'];
        $user = $request->user();

        if (! $user) {
            return response()->json(['user' => null, 'signInUrl' => route('sign-in')], 401, $headers);
        }

        return response()->json([
            'user' => [
                'name' => $user->name,
                'email' => $user->email,
                'roles' => $user->getRoleNames()->sort()->values()->all(),
            ],
            'signOut' => [
                'url' => route('logout'),
                'csrf' => csrf_token(),
                'next' => route('sign-in'),
            ],
            'links' => [
                ['label' => __('Profile'), 'href' => route('profile')],
                ['label' => __('Dashboard'), 'href' => route('dashboard')],
            ],
        ], 200, $headers);
    }
}
