<?php

namespace Tests\Feature\Platform;

use App\Models\User;
use App\Support\HubToken;
use Illuminate\Foundation\Testing\RefreshDatabase;
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
}
