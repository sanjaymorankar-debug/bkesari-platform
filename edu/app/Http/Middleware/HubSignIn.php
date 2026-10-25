<?php

namespace App\Http\Middleware;

use App\Models\User;
use App\Support\HubToken;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Spatie\Permission\Models\Role;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

/**
 * One bkesari ID: a visitor signed in on the hub is signed in here too.
 *
 * Only the low-privilege roles are granted from the hub token. School, district,
 * national and safeguarding roles carry access to protected identities, so they
 * stay assignments made inside Education, never something a token can confer.
 */
class HubSignIn
{
    /** Hub role -> the Education role it grants. */
    public const ROLE_MAP = ['parent' => 'parent', 'student' => 'student', 'teacher' => 'teacher'];

    public function handle(Request $request, Closure $next): Response
    {
        $token = $request->header(HubToken::HEADER);
        if ($token && (config('services.hub.jwks') || config('services.hub.jwks_url'))) {
            try {
                $this->signIn(HubToken::verify($token, HubToken::jwks()), $request);
            } catch (Throwable $e) {
                Log::notice('Hub token refused: '.$e->getMessage());
            }
        }

        return $next($request);
    }

    private function signIn(array $claims, Request $request): void
    {
        $current = Auth::user();
        if ($current && $current->hub_user_id === $claims['sub']) {
            return;
        }

        $email = Str::lower(trim($claims['email']));
        $user = DB::transaction(function () use ($claims, $email) {
            $user = User::where('hub_user_id', $claims['sub'])->first()
                ?? User::where('email', $email)->first();
            if ($user && $user->hub_user_id && $user->hub_user_id !== $claims['sub']) {
                throw new \RuntimeException('email belongs to another bkesari ID');
            }
            if (! $user) {
                $user = new User;
                $user->name = Str::before($email, '@');
                $user->email = $email;
                $user->password = Str::random(48); // hub-only account: no usable password
            }
            $user->hub_user_id = $claims['sub'];
            $user->email_verified_at ??= now();
            $user->save();

            $role = self::ROLE_MAP[$claims['role'] ?? ''] ?? null;
            if ($role && Role::where('name', $role)->where('guard_name', 'web')->exists() && ! $user->hasRole($role)) {
                $user->assignRole($role);
            }

            return $user;
        });

        if ($current) {
            Auth::logout();
        }
        Auth::login($user);
        $request->session()->regenerate();
    }
}
