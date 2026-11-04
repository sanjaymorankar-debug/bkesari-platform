<?php

namespace Tests\Feature\Platform;

use App\Http\Middleware\HubSignIn;
use App\Models\User;
use App\Support\HubToken;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Spatie\Permission\Models\Role;
use Tests\TestCase;

class HubSignInTest extends TestCase
{
    use RefreshDatabase;

    private $key;

    private array $jwks;

    protected function setUp(): void
    {
        parent::setUp();
        $this->key = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
        $d = openssl_pkey_get_details($this->key)['rsa'];
        $b = fn ($v) => rtrim(strtr(base64_encode($v), '+/', '-_'), '=');
        $this->jwks = ['keys' => [['kty' => 'RSA', 'kid' => 'k1', 'alg' => 'RS256', 'n' => $b($d['n']), 'e' => $b($d['e'])]]];
        config(['services.hub.jwks_url' => 'https://hub.test/.well-known/jwks.json']);
        Cache::flush();
        Http::fake(['hub.test/*' => Http::response($this->jwks)]);
        Role::findOrCreate('parent', 'web');
        Role::findOrCreate('system_admin', 'web');
    }

    private function token(array $claims, int $ttl = 60, string $kid = 'k1'): string
    {
        $b = fn ($v) => rtrim(strtr(base64_encode($v), '+/', '-_'), '=');
        $input = $b(json_encode(['alg' => 'RS256', 'typ' => 'JWT', 'kid' => $kid])).'.'.
            $b(json_encode(['iss' => 'bkesari-hub', 'iat' => time(), 'exp' => time() + $ttl] + $claims));
        openssl_sign($input, $sig, $this->key, OPENSSL_ALGO_SHA256);

        return $input.'.'.$b($sig);
    }

    private array $asha = ['sub' => 'hub-asha', 'email' => 'Asha@Example.com', 'role' => 'parent', 'aud' => 'edu'];

    public function test_a_valid_hub_token_signs_the_visitor_in_and_links_the_account(): void
    {
        $this->get('/', [HubToken::HEADER => $this->token($this->asha)])->assertOk();
        $this->assertAuthenticated();
        $user = User::where('hub_user_id', 'hub-asha')->firstOrFail();
        $this->assertSame('asha@example.com', $user->email);
        $this->assertTrue($user->hasRole('parent'));
    }

    public function test_a_hub_token_signs_the_visitor_in_on_a_protected_page_too(): void
    {
        // A deep link through the hub (/edu/dashboard/parent) must not be sent to
        // /edu/login: HubSignIn has to run before the `auth` route middleware.
        $this->get('/dashboard/parent', [HubToken::HEADER => $this->token($this->asha)])
            ->assertOk();
        $this->assertAuthenticated();
        $this->assertSame('hub-asha', auth()->user()->hub_user_id);
    }

    public function test_an_existing_account_is_linked_not_duplicated(): void
    {
        $existing = User::factory()->create(['email' => 'asha@example.com']);
        $this->get('/', [HubToken::HEADER => $this->token($this->asha)]);
        $this->assertSame(1, User::where('email', 'asha@example.com')->count());
        $this->assertSame('hub-asha', $existing->fresh()->hub_user_id);
    }

    public function test_the_token_never_grants_a_privileged_role(): void
    {
        $this->get('/', [HubToken::HEADER => $this->token(['role' => 'admin'] + $this->asha)]);
        $this->assertFalse(User::where('hub_user_id', 'hub-asha')->first()->hasRole('system_admin'));
    }

    public function test_the_hubs_builtin_administrators_are_system_admin(): void
    {
        // portal/builtin-admins.js: smorankar and sonalimorankar are owners on the
        // hub, which sends them with its top role for Education, 'admin'.
        foreach (['smorankar', 'sonalimorankar'] as $username) {
            Auth::logout();
            $claims = ['sub' => "builtin:$username", 'email' => "$username@builtin.bkesari.com", 'role' => 'admin', 'aud' => 'edu'];
            $this->get('/', [HubToken::HEADER => $this->token($claims)])->assertOk();
            $this->assertAuthenticated();
            $user = User::where('hub_user_id', "builtin:$username")->firstOrFail();
            $this->assertSame($username, $user->name);
            $this->assertTrue($user->hasRole('system_admin'), $username);
        }
        // Signing in again does not add the role twice.
        $this->get('/', [HubToken::HEADER => $this->token(['sub' => 'builtin:smorankar', 'email' => 'smorankar@builtin.bkesari.com', 'role' => 'admin', 'aud' => 'edu'])]);
        $this->assertSame(1, User::where('hub_user_id', 'builtin:smorankar')->firstOrFail()->roles()->count());
    }

    public function test_only_the_two_builtin_ids_with_the_admin_role_become_system_admin(): void
    {
        $cases = [
            // A built-in id the hub did not send with its top role.
            ['sub' => 'builtin:smorankar', 'email' => 'smorankar@builtin.bkesari.com', 'role' => 'parent'],
            // Any other id, including one dressed up as built-in.
            ['sub' => 'builtin:mallory', 'email' => 'mallory@builtin.bkesari.com', 'role' => 'admin'],
            ['sub' => 'smorankar', 'email' => 'smorankar@example.com', 'role' => 'admin'],
            ['sub' => 'hub-ravi', 'email' => 'smorankar@builtin.bkesari.com.example', 'role' => 'admin'],
        ];
        foreach ($cases as $claims) {
            Auth::logout();
            $this->get('/', [HubToken::HEADER => $this->token($claims + ['aud' => 'edu'])]);
            $this->assertAuthenticated();
            $user = User::where('hub_user_id', $claims['sub'])->firstOrFail();
            $this->assertFalse($user->hasRole('system_admin'), $claims['sub'].' as '.$claims['role']);
        }
        $this->assertTrue(User::where('hub_user_id', 'builtin:smorankar')->firstOrFail()->hasRole('parent'));
        $this->assertSame(['builtin:smorankar', 'builtin:sonalimorankar'], HubSignIn::BUILTIN_ADMINS);
    }

    public function test_a_builtin_id_never_takes_over_an_account_made_with_its_email(): void
    {
        // Education's own sign-up, a profile edit, a school registration or an
        // invitation can each give an account any address, unverified. Adopted
        // by email, that account would become system_admin while whoever made it
        // still knows its password.
        $squatter = User::factory()->create(['email' => 'smorankar@builtin.bkesari.com', 'password' => 'known-to-the-squatter']);
        foreach (['parent', 'admin'] as $role) {
            $claims = ['sub' => 'builtin:smorankar', 'email' => 'smorankar@builtin.bkesari.com', 'role' => $role, 'aud' => 'edu'];
            $this->get('/', [HubToken::HEADER => $this->token($claims)])->assertOk();
            $this->assertGuest();
        }
        $squatter->refresh();
        $this->assertNull($squatter->hub_user_id);
        $this->assertFalse($squatter->hasRole('system_admin'));
        $this->assertSame(0, User::where('hub_user_id', 'builtin:smorankar')->count());

        // An ordinary bkesari ID still links the account that has its address.
        $this->get('/', [HubToken::HEADER => $this->token($this->asha)]);
        $this->assertSame('hub-asha', auth()->user()->hub_user_id);
    }

    public function test_another_projects_expired_or_forged_token_signs_nobody_in(): void
    {
        foreach ([
            $this->token(['aud' => 'ladwani'] + $this->asha),
            $this->token($this->asha, -10),
            $this->token($this->asha, 60, 'other-key'),
            'not.a.token',
        ] as $bad) {
            $this->get('/', [HubToken::HEADER => $bad]);
            $this->assertGuest();
        }
        $this->assertSame(0, User::count());
    }

    public function test_verify_rejects_a_tampered_payload(): void
    {
        [$h, , $s] = explode('.', $this->token($this->asha));
        $forged = rtrim(strtr(base64_encode(json_encode(['role' => 'admin', 'exp' => time() + 99] + $this->asha)), '+/', '-_'), '=');
        $this->expectExceptionMessage('bad signature');
        HubToken::verify("$h.$forged.$s", $this->jwks);
    }

    public function test_an_inline_key_set_needs_no_fetch(): void
    {
        config(['services.hub.jwks' => json_encode($this->jwks), 'services.hub.jwks_url' => null]);
        Http::fake(fn () => throw new \RuntimeException('no fetch expected'));
        $this->get('/', [HubToken::HEADER => $this->token($this->asha)])->assertOk();
        $this->assertAuthenticated();
    }

    public function test_an_unreachable_key_set_is_not_retried_on_every_request(): void
    {
        Cache::flush();
        $calls = 0;
        Http::fake(function () use (&$calls) {
            $calls++;
            throw new ConnectionException('Resolving timed out');
        });
        $this->get('/', [HubToken::HEADER => $this->token($this->asha)]);
        $this->get('/', [HubToken::HEADER => $this->token($this->asha)]);
        $this->assertGuest();
        $this->assertSame(1, $calls);
    }
}
