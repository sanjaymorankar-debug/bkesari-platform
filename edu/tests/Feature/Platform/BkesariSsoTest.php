<?php

namespace Tests\Feature\Platform;

use App\Models\TwoFactorAuthentication;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Central login (bkesari.com) for Education: introspection, the EDUCATION
 * subscription gate, the bridge into a local account, role sync, the TOTP
 * rule for privileged roles, single logout and enforcement.
 */
class BkesariSsoTest extends TestCase
{
    use RefreshDatabase;

    private const URL = 'https://dev.bkesari.com/auth/api/introspect';

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'bkesari_sso.introspect_url' => self::URL,
            'bkesari_sso.client_id' => 'edu-dev',
            'bkesari_sso.client_secret' => 's3cret',
            'bkesari_sso.hub_url' => 'https://dev.bkesari.com',
            'bkesari_sso.enforce' => false,
            'bkesari_sso.cache_seconds' => 0,
        ]);
        Http::fake([self::URL => fn () => Http::response($this->answer)]);
    }

    private function identity(array $over = []): array
    {
        return array_replace_recursive([
            'active' => true,
            'sid' => 'sid-1',
            'user' => ['id' => 'central-1', 'email' => 'learner@example.test', 'name' => 'Learner One', 'email_verified' => true],
            'roles' => ['USER'],
            'moderator_of' => [],
            'features' => ['EDUCATION'],
            'permissions' => ['education.view_course'],
            'mfa' => false,
        ], $over);
    }

    /** What the fake central service answers; changeable mid-test. */
    private array $answer = ['active' => false];

    private function central(?array $identity): void
    {
        $this->answer = $identity ?? ['active' => false];
    }

    private function withCentralCookie(string $token = 'tok-1'): static
    {
        return $this->withHeader('Cookie', "other=1; __Host-bk_sso={$token}");
    }

    public function test_it_is_off_unless_configured(): void
    {
        config(['bkesari_sso.introspect_url' => null]);
        Http::fake();
        $this->withCentralCookie()->get('/dashboard')->assertRedirect(route('login'));
        Http::assertNothingSent();
    }

    public function test_an_entitled_central_user_is_signed_in_as_a_new_local_user(): void
    {
        $this->central($this->identity());
        $this->withCentralCookie()->get('/dashboard')->assertRedirect();

        $user = User::where('email', 'learner@example.test')->firstOrFail();
        $this->assertAuthenticatedAs($user);
        $this->assertTrue($user->hasRole('public'));
        $this->assertNotNull($user->email_verified_at);
        $this->assertSame('central-1', session('bkesari_sso_sub'));

        Http::assertSent(fn ($r) => $r->url() === self::URL
            && $r->hasHeader('Authorization', 'Basic '.base64_encode('edu-dev:s3cret'))
            && $r['token'] === 'tok-1');
    }

    public function test_an_existing_local_user_is_linked_by_email(): void
    {
        $existing = User::factory()->create(['email' => 'learner@example.test']);
        $existing->assignRole('parent');
        $this->central($this->identity());
        $this->withCentralCookie()->get('/dashboard');
        $this->assertAuthenticatedAs($existing);
        $this->assertTrue($existing->fresh()->hasRole('parent'), 'Education roles are left alone');
    }

    public function test_without_the_education_subscription_pages_go_to_subscribe_and_json_gets_403(): void
    {
        $this->central($this->identity(['features' => ['LADWANI']]));
        $this->withCentralCookie()->get('/dashboard')->assertRedirect('https://dev.bkesari.com/auth/subscribe/education');
        $this->withCentralCookie()->getJson('/dashboard')->assertStatus(403)->assertJson(['error' => 'subscription_required']);
        $this->assertGuest();
        $this->assertDatabaseMissing('users', ['email' => 'learner@example.test']);
    }

    public function test_central_admin_maps_to_system_admin_and_only_bridged_roles_are_removed(): void
    {
        $this->central($this->identity(['roles' => ['USER', 'ADMIN'], 'mfa' => true]));
        $this->withCentralCookie()->get('/dashboard');
        $user = User::where('email', 'learner@example.test')->firstOrFail();
        $this->assertTrue($user->hasRole('system_admin'));
        $user->assignRole('teacher'); // given inside Education

        Auth::logout();
        $this->flushSession();
        $this->central($this->identity(['roles' => ['USER']]));
        $this->withCentralCookie('tok-2')->get('/dashboard');
        $user = $user->fresh();
        $this->assertFalse($user->hasRole('system_admin'));
        $this->assertTrue($user->hasRole('teacher'));
        $this->assertSame(0, DB::table('sso_role_grants')->where('user_id', $user->id)->count());
    }

    public function test_privileged_roles_need_the_central_session_to_have_passed_totp(): void
    {
        $officer = User::factory()->create(['email' => 'learner@example.test']);
        $officer->assignRole('district_officer');

        $this->central($this->identity(['mfa' => false]));
        $this->withCentralCookie()->get('/dashboard')
            ->assertRedirect('https://dev.bkesari.com/auth/step-up?return_to='.urlencode('/dashboard'));
        $this->assertGuest();

        $this->central($this->identity(['mfa' => true]));
        $this->withCentralCookie()->get('/dashboard');
        $this->assertAuthenticatedAs($officer);
    }

    public function test_local_two_factor_users_also_need_central_totp(): void
    {
        $user = User::factory()->create(['email' => 'learner@example.test']);
        TwoFactorAuthentication::create(['user_id' => $user->id, 'secret' => 'JBSWY3DPEHPK3PXP', 'confirmed_at' => now()]);
        $this->central($this->identity());
        $this->withCentralCookie()->get('/dashboard')->assertRedirectContains('/auth/step-up');
        $this->assertGuest();
    }

    public function test_when_the_central_session_ends_the_bridged_session_ends_too(): void
    {
        $this->central($this->identity());
        $this->withCentralCookie()->get('/dashboard');
        $this->assertAuthenticated();

        $this->central(null);
        $this->withCentralCookie()->get('/dashboard')->assertRedirect(route('login'));
        $this->assertGuest();
    }

    public function test_a_local_password_session_is_left_alone_when_not_enforced(): void
    {
        $user = User::factory()->create();
        $this->central(null);
        $this->actingAs($user)->get('/dashboard');
        $this->assertAuthenticatedAs($user);
    }

    public function test_enforced_local_login_pages_lead_to_the_central_login_and_local_sessions_end(): void
    {
        config(['bkesari_sso.enforce' => true]);
        $this->central(null);
        $this->get('/login')->assertRedirect('https://dev.bkesari.com/auth/login?return_to='.urlencode('/dashboard'));
        $this->get('/register')->assertRedirectContains('https://dev.bkesari.com/auth/login');

        $user = User::factory()->create();
        $this->actingAs($user)->get('/dashboard')->assertRedirect(route('login'));
        $this->assertGuest();
    }

    public function test_the_service_being_down_signs_nobody_in(): void
    {
        $this->central($this->identity());
        Http::swap(new \Illuminate\Http\Client\Factory);
        Http::fake([self::URL => fn () => throw new \Illuminate\Http\Client\ConnectionException('down')]);
        $this->withCentralCookie()->get('/dashboard')->assertRedirect(route('login'));
        $this->assertGuest();
    }

    public function test_answers_are_cached_for_the_configured_time(): void
    {
        config(['bkesari_sso.cache_seconds' => 30]);
        $this->central($this->identity());
        $this->withCentralCookie('tok-cached')->get('/dashboard');
        Auth::logout();
        $this->withCentralCookie('tok-cached')->get('/dashboard');
        Http::assertSentCount(1);
    }
}
