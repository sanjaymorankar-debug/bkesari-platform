<?php

namespace Tests\Feature\Auth;

use App\Http\Middleware\HubIdentitySignIn;
use App\Models\ParentProfile;
use App\Models\TwoFactorAuthentication;
use App\Models\User;
use App\Support\BuiltinAdmins;
use Illuminate\Auth\Events\Login;
use Illuminate\Auth\Events\Logout;
use Illuminate\Auth\Middleware\Authenticate;
use Illuminate\Auth\Middleware\RedirectIfAuthenticated;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Route;
use Livewire\Volt\Volt;
use Mockery;
use Tests\TestCase;

/**
 * The bkesari hub's signed identity headers (D-039, docs/design/bkesari-id.md
 * section 3; App\Http\Middleware\HubIdentitySignIn, App\Support\HubIdentity).
 * The headers are built here with the contract's own HMAC, independently of
 * the code under test.
 */
class HubIdentitySignInTest extends TestCase
{
    use RefreshDatabase;

    private const SECRET = 'test-only-hub-proxy-secret-0123456789abcdef';

    private const BASE_URL = 'https://dev.bkesari.com/edu';

    private ?string $originalAppUrl = null;

    protected function setUp(): void
    {
        // The /edu test needs APP_URL set before the application boots, as BasePathTest does.
        if ($this->name() === 'test_behind_the_hub_the_edu_base_path_stays_intact') {
            $this->originalAppUrl = $_ENV['APP_URL'] ?? null;
            $_ENV['APP_URL'] = $_SERVER['APP_URL'] = self::BASE_URL;
            putenv('APP_URL='.self::BASE_URL);
        }

        parent::setUp();

        config(['services.hub.proxy_secret' => self::SECRET]);
        Cache::flush();
        $this->freezeSecond();
    }

    protected function tearDown(): void
    {
        parent::tearDown();

        if ($this->name() === 'test_behind_the_hub_the_edu_base_path_stays_intact') {
            if ($this->originalAppUrl === null) {
                unset($_ENV['APP_URL'], $_SERVER['APP_URL']);
                putenv('APP_URL');
            } else {
                $_ENV['APP_URL'] = $_SERVER['APP_URL'] = $this->originalAppUrl;
                putenv('APP_URL='.$this->originalAppUrl);
            }
        }
    }

    private static function base64url(string $bytes): string
    {
        return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
    }

    /**
     * The headers the hub sends, signed as the contract says:
     * HMAC-SHA256(HUB_PROXY_SECRET, "bkesari-id-v1\n<project>\n<user>\n<email>\n<role>\n<name>\n<ts>"),
     * base64url, with <name> the base64url header value. `name` here is the
     * plain display name; `sig` or `secret` override the signature.
     *
     * @param  array<string, string|int>  $with
     * @return array<string, string>
     */
    private function hub(array $with = []): array
    {
        $f = array_merge([
            'user' => '4021',
            'email' => 'asha@example.com',
            'role' => 'parent',
            'name' => 'Asha Patil',
            'project' => 'edu',
            'ts' => now()->getTimestamp(),
            'secret' => self::SECRET,
        ], $with);
        $name = self::base64url((string) $f['name']);
        $signed = implode("\n", ['bkesari-id-v1', $f['project'], $f['user'], $f['email'], $f['role'], $name, $f['ts']]);

        return [
            'X-Bkesari-User' => (string) $f['user'],
            'X-Bkesari-Email' => (string) $f['email'],
            'X-Bkesari-Role' => (string) $f['role'],
            'X-Bkesari-Name' => $name,
            'X-Bkesari-Project' => (string) $f['project'],
            'X-Bkesari-Ts' => (string) $f['ts'],
            'X-Bkesari-Sig' => (string) ($f['sig'] ?? self::base64url(hash_hmac('sha256', $signed, (string) $f['secret'], true))),
        ];
    }

    private function confirmedUser(array $attributes = []): User
    {
        $user = User::factory()->create(array_merge(['email_verified_at' => now()], $attributes));
        if (array_key_exists('hub_user_id', $attributes)) {
            $user->forceFill(['hub_user_id' => $attributes['hub_user_id']])->save();
        }

        return $user->fresh();
    }

    private function assertIgnored(array $headers, string $why): void
    {
        $this->get('/dashboard', $headers)->assertRedirect(route('login'));
        $this->assertGuest();
        $this->assertSame(0, User::where('hub_user_id', $headers['X-Bkesari-User'] ?? '4021')->count(), $why);
    }

    // --- A valid identity --------------------------------------------------

    public function test_a_valid_identity_signs_in_the_account_with_that_hub_id(): void
    {
        // Found by hub id even though its email has since changed here.
        $user = User::factory()->create(['email' => 'asha.old@example.com', 'email_verified_at' => now()]);
        $user->forceFill(['hub_user_id' => '4021'])->save();

        $this->get('/dashboard', $this->hub())->assertRedirect(route('dashboard.parent'));

        $this->assertAuthenticatedAs($user);
        $this->assertSame(1, User::count());
        $this->assertSame('asha.old@example.com', $user->fresh()->email);
    }

    public function test_a_confirmed_email_is_linked_and_the_hub_id_stored(): void
    {
        $user = User::factory()->create(['email' => 'asha@example.com', 'email_verified_at' => now()]);
        $password = $user->password;

        $this->get('/dashboard', $this->hub())->assertRedirect(route('dashboard.parent'));

        $this->assertAuthenticatedAs($user);
        $this->assertSame('4021', $user->fresh()->hub_user_id);
        $this->assertSame($password, $user->fresh()->password, 'the account keeps its own password');
        $this->assertSame(1, User::count());
    }

    public function test_an_id_from_the_retired_shared_sign_in_is_replaced(): void
    {
        // A Neon Auth id from before 3 Nov 2026 (not digits) is no hub user of today's.
        $user = $this->confirmedUser(['email' => 'asha@example.com', 'hub_user_id' => '6f1c2a54-0b8e-4e43-9d7a-2b5f3c9e1a00']);

        $this->get('/dashboard', $this->hub());

        $this->assertAuthenticatedAs($user);
        $this->assertSame('4021', $user->fresh()->hub_user_id);
    }

    public function test_a_new_person_gets_a_confirmed_account_with_a_password_nobody_knows(): void
    {
        $this->get('/dashboard', $this->hub(['name' => 'आशा पाटील', 'email' => 'asha@example.com']))
            ->assertRedirect(route('dashboard.parent'));

        $user = User::where('hub_user_id', '4021')->firstOrFail();
        $this->assertAuthenticatedAs($user);
        $this->assertSame('आशा पाटील', $user->name);
        $this->assertSame('asha@example.com', $user->email);
        $this->assertNotNull($user->email_verified_at);
        $this->assertTrue(Hash::isHashed($user->password));
        $this->assertFalse(Hash::check('password', $user->password));
        $this->assertSame(['parent'], $user->getRoleNames()->all());
        $this->assertSame('parent', $user->hub_role);
        $this->assertTrue(ParentProfile::where('user_id', $user->id)->exists(), 'a parent account has its profile, as at sign-up');

        $this->get('/dashboard/parent')->assertOk();
    }

    public function test_with_no_name_the_new_account_is_named_after_the_email(): void
    {
        $this->get('/dashboard', $this->hub(['name' => '', 'email' => 'ravi.k@example.com', 'user' => '77']));

        $this->assertSame('ravi.k', User::where('hub_user_id', '77')->value('name'));
    }

    public function test_a_session_already_signed_in_as_that_hub_user_is_not_signed_in_again(): void
    {
        $user = $this->confirmedUser(['hub_user_id' => '4021']);
        Event::fake([Login::class]);

        $this->get('/dashboard', $this->hub());
        $this->get('/dashboard', $this->hub());
        $this->travel(30)->seconds();
        $this->get('/dashboard', $this->hub());

        $this->assertAuthenticatedAs($user);
        Event::assertDispatchedTimes(Login::class, 1);
    }

    public function test_a_signed_in_hub_user_is_not_shown_the_sign_in_page(): void
    {
        // Runs before `guest`, so the sign-in page sends them on.
        $this->get('/login', $this->hub())->assertRedirect(route('dashboard'));
        $this->assertAuthenticated();
    }

    // --- Headers that are not believed -------------------------------------

    public function test_a_wrong_signature_is_ignored(): void
    {
        $this->assertIgnored($this->hub(['secret' => 'another-secret']), 'another key');
        $this->assertIgnored($this->hub(['sig' => 'not-a-signature']), 'garbage');
        $this->assertIgnored($this->hub(['sig' => '']), 'empty');

        // Signed as a parent, sent as an admin.
        $headers = $this->hub();
        $headers['X-Bkesari-Role'] = 'admin';
        $this->assertIgnored($headers, 'role changed after signing');

        // Signed for one person, sent for another.
        $headers = $this->hub();
        $headers['X-Bkesari-User'] = '1';
        $this->assertIgnored($headers, 'user changed after signing');
        $this->assertSame(0, User::count());
    }

    public function test_another_projects_identity_is_ignored(): void
    {
        foreach (['ladwani', 'tasklist', 'EDU', ''] as $project) {
            $this->assertIgnored($this->hub(['project' => $project]), $project);
        }
        $this->assertSame(0, User::count());
    }

    public function test_a_time_sixty_seconds_old_or_ahead_is_ignored(): void
    {
        $now = now()->getTimestamp();
        $this->assertIgnored($this->hub(['ts' => $now - 60]), '60 s old');
        $this->assertIgnored($this->hub(['ts' => $now + 60]), '60 s ahead');
        $this->assertIgnored($this->hub(['ts' => $now - 3600]), 'an hour old');

        // A captured set stops working once it is a minute old.
        $headers = $this->hub();
        $this->travel(60)->seconds();
        $this->assertIgnored($headers, 'replayed a minute later');
        $this->assertSame(0, User::count());

        $this->get('/dashboard', $this->hub(['ts' => now()->getTimestamp() - 59]))->assertRedirect(route('dashboard.parent'));
        $this->assertAuthenticated();
    }

    public function test_with_a_blank_secret_the_headers_are_ignored(): void
    {
        foreach (['', null] as $blank) {
            config(['services.hub.proxy_secret' => $blank]);
            $this->assertIgnored($this->hub(), 'signed with the hub secret');
            $this->assertIgnored($this->hub(['secret' => '']), 'signed with an empty key');
        }
        $this->assertSame(0, User::count());

        // Education's own sign-in still works.
        $user = User::factory()->create();
        Volt::test('pages.auth.login')
            ->call('useMethod', 'password')
            ->set('form.email', $user->email)
            ->set('form.password', 'password')
            ->call('login')
            ->assertHasNoErrors();
        $this->assertAuthenticatedAs($user);
    }

    public function test_a_missing_header_is_ignored(): void
    {
        foreach (['X-Bkesari-User', 'X-Bkesari-Email', 'X-Bkesari-Role', 'X-Bkesari-Project', 'X-Bkesari-Ts', 'X-Bkesari-Sig'] as $header) {
            $headers = $this->hub();
            unset($headers[$header]);
            $this->assertIgnored($headers, 'without '.$header);
        }
        $this->assertSame(0, User::count());

        // The name may be empty, and an empty header may not arrive at all.
        $headers = $this->hub(['name' => '']);
        unset($headers['X-Bkesari-Name']);
        $this->get('/dashboard', $headers)->assertRedirect(route('dashboard.parent'));
        $this->assertAuthenticated();
    }

    public function test_the_headers_are_removed_before_the_app_sees_them(): void
    {
        Route::middleware('web')->get('/__hub-headers', fn () => [
            'user' => auth()->id(),
            'headers' => collect(request()->headers->keys())->filter(fn ($k) => str_starts_with($k, 'x-bkesari-'))->values(),
        ]);

        $seen = $this->get('/__hub-headers', $this->hub(['secret' => 'wrong']))->assertOk()->json();
        $this->assertSame([], $seen['headers'], 'not believed, and still not passed on');
        $this->assertNull($seen['user']);

        $seen = $this->get('/__hub-headers', $this->hub())->assertOk()->json();
        $this->assertSame([], $seen['headers']);
        $this->assertNotNull($seen['user']);
    }

    // --- Accounts that must not be taken -----------------------------------

    public function test_an_account_whose_email_nobody_confirmed_is_not_adopted(): void
    {
        Log::spy();
        $squatter = User::factory()->unverified()->create(['email' => 'asha@example.com']);
        $password = $squatter->password;

        $this->get('/dashboard', $this->hub())->assertRedirect(route('login'));
        $this->get('/dashboard', $this->hub());

        $this->assertGuest();
        $squatter->refresh();
        $this->assertNull($squatter->hub_user_id);
        $this->assertNull($squatter->email_verified_at);
        $this->assertSame($password, $squatter->password);
        $this->assertSame([], $squatter->getRoleNames()->all());
        $this->assertSame(1, User::count(), 'and no second account is made');
        Log::shouldHaveReceived('warning')
            ->with(Mockery::pattern('/whose email nobody has confirmed/'), Mockery::on(fn ($c) => $c['hub_user_id'] === '4021' && ! in_array('asha@example.com', $c, true)))
            ->once();
    }

    public function test_an_account_already_linked_to_another_hub_user_is_not_taken(): void
    {
        $user = $this->confirmedUser(['email' => 'asha@example.com', 'hub_user_id' => '15']);

        $this->assertIgnored($this->hub(['user' => '4021']), 'linked to hub user 15');
        $this->assertSame('15', $user->fresh()->hub_user_id);
    }

    public function test_a_signed_role_education_does_not_know_signs_nobody_in(): void
    {
        Log::spy();

        $this->assertIgnored($this->hub(['role' => 'owner']), 'owner');
        $this->assertIgnored($this->hub(['role' => 'karta']), 'karta');
        Log::shouldHaveReceived('warning')->with(Mockery::pattern('/role Education does not know/'), Mockery::any())->twice();
    }

    // --- Sessions ----------------------------------------------------------

    public function test_another_hub_users_session_ends_first(): void
    {
        Event::fake([Logout::class]);
        $other = $this->confirmedUser(['hub_user_id' => '9999']);
        $this->actingAs($other);

        $this->get('/dashboard', $this->hub())->assertRedirect(route('dashboard.parent'));

        $asha = User::where('hub_user_id', '4021')->firstOrFail();
        $this->assertAuthenticatedAs($asha);
        Event::assertDispatched(Logout::class, fn (Logout $e) => $e->user->is($other));
    }

    public function test_a_session_from_educations_own_sign_in_ends_when_the_hub_names_someone_else(): void
    {
        $own = User::factory()->create(['email' => 'someone.else@example.com']);
        $this->actingAs($own);

        $this->get('/dashboard', $this->hub());

        $this->assertAuthenticatedAs(User::where('hub_user_id', '4021')->firstOrFail());
    }

    public function test_a_session_from_educations_own_sign_in_continues_when_it_is_the_same_person(): void
    {
        $asha = $this->confirmedUser(['email' => 'asha@example.com']);
        $this->actingAs($asha);
        Event::fake([Login::class, Logout::class]);

        $this->get('/dashboard', $this->hub());

        $this->assertAuthenticatedAs($asha);
        $this->assertSame('4021', $asha->fresh()->hub_user_id);
        Event::assertNotDispatched(Logout::class);
        Event::assertNotDispatched(Login::class);
    }

    public function test_a_session_ends_even_when_the_hub_user_cannot_be_signed_in(): void
    {
        // The browser is Asha's now; the earlier session is not, and her own
        // address is held by an account nobody confirmed.
        $other = $this->confirmedUser(['hub_user_id' => '9999']);
        User::factory()->unverified()->create(['email' => 'asha@example.com']);
        $this->actingAs($other);

        $this->get('/dashboard', $this->hub())->assertRedirect(route('login'));

        $this->assertGuest();
    }

    public function test_two_factor_does_not_hold_up_a_hub_sign_in(): void
    {
        $user = $this->confirmedUser(['email' => 'asha@example.com']);
        $user->assignRole('school_admin');
        TwoFactorAuthentication::create(['user_id' => $user->id, 'secret' => 'JBSWY3DPEHPK3PXP', 'recovery_codes' => [], 'confirmed_at' => now()]);

        // Education's own sign-in got as far as the two-factor challenge
        // (pages.auth.login) before the visitor came through the hub.
        $this->withSession(['2fa_user_id' => $user->id, '2fa_remember' => true, '2fa_password' => 'pending-challenge']);

        $this->get('/dashboard', $this->hub(['role' => 'school_admin']))->assertRedirect(route('dashboard.school'));

        $this->assertAuthenticatedAs($user);
        $this->assertNull(session('2fa_user_id'));
        $this->assertNull(session('2fa_remember'));
        $this->assertNull(session('2fa_password'));
    }

    // --- Roles -------------------------------------------------------------

    public function test_each_hub_role_is_its_education_role(): void
    {
        $expected = [
            'parent' => ['parent', 'dashboard.parent'],
            'student' => ['student', 'dashboard.student'],
            'teacher' => ['teacher', 'dashboard.teacher'],
            'school_admin' => ['school_admin', 'dashboard.school'],
            'admin' => ['system_admin', 'dashboard.admin'],
        ];

        $id = 100;
        foreach ($expected as $hubRole => [$role, $dashboard]) {
            $id++;
            $this->get('/dashboard', $this->hub(['user' => $id, 'email' => "{$hubRole}@example.com", 'role' => $hubRole]))
                ->assertRedirect(route($dashboard));

            $user = User::where('hub_user_id', (string) $id)->firstOrFail();
            $this->assertAuthenticatedAs($user);
            $this->assertSame([$role], $user->getRoleNames()->all(), $hubRole);
            $this->assertSame($role, $user->hub_role, $hubRole);
        }
    }

    public function test_a_changed_hub_role_replaces_only_the_role_the_hub_gave(): void
    {
        $user = $this->confirmedUser(['hub_user_id' => '4021']);
        $user->assignRole('counsellor'); // given inside Education
        $roles = fn () => $user->fresh()->getRoleNames()->sort()->values()->all();

        $this->get('/dashboard', $this->hub(['role' => 'parent']));
        $this->assertSame(['counsellor', 'parent'], $roles());
        $this->assertSame('parent', $user->fresh()->hub_role);

        $this->get('/dashboard', $this->hub(['role' => 'student']));
        $this->assertSame(['counsellor', 'student'], $roles());
        $this->assertSame('student', $user->fresh()->hub_role);

        // The admin turns them into an Education admin at the hub.
        $this->get('/dashboard', $this->hub(['role' => 'admin']));
        $this->assertSame(['counsellor', 'system_admin'], $roles());
        $this->assertSame('system_admin', $user->fresh()->hub_role);
    }

    public function test_a_role_the_account_already_held_inside_education_is_never_taken_away(): void
    {
        $user = $this->confirmedUser(['hub_user_id' => '4021']);
        $user->assignRole('teacher'); // given inside Education
        $roles = fn () => $user->fresh()->getRoleNames()->sort()->values()->all();

        // The hub names the role it already has: it stays Education's.
        $this->get('/dashboard', $this->hub(['role' => 'teacher']));
        $this->assertSame(['teacher'], $roles());
        $this->assertNull($user->fresh()->hub_role);

        $this->get('/dashboard', $this->hub(['role' => 'parent']));
        $this->assertSame(['parent', 'teacher'], $roles());
        $this->assertSame('parent', $user->fresh()->hub_role);

        // Back to teacher: the hub's parent goes, Education's teacher stays.
        $this->get('/dashboard', $this->hub(['role' => 'teacher']));
        $this->assertSame(['teacher'], $roles());
        $this->assertNull($user->fresh()->hub_role);
    }

    public function test_the_hub_role_comes_back_if_it_was_removed_inside_education(): void
    {
        $user = $this->confirmedUser(['hub_user_id' => '4021']);
        $this->get('/dashboard', $this->hub());
        $user->fresh()->removeRole('parent');

        $this->app['auth']->forgetGuards();
        $this->get('/dashboard', $this->hub())->assertRedirect(route('dashboard.parent'));
        $this->assertSame(['parent'], $user->fresh()->getRoleNames()->all());
    }

    // --- The built-in administrators ---------------------------------------

    public function test_a_built_in_administrator_reaches_their_own_row_as_system_admin(): void
    {
        $row = BuiltinAdmins::account('smorankar'); // made earlier by their password sign-in

        $this->get('/dashboard', $this->hub(['user' => '1', 'email' => 'smorankar@builtin.bkesari.com', 'role' => 'admin', 'name' => 'smorankar']))
            ->assertRedirect(route('dashboard.admin'));

        $this->assertAuthenticatedAs($row);
        $this->assertSame('1', $row->fresh()->hub_user_id);
        $this->assertSame(['system_admin'], $row->fresh()->getRoleNames()->all());
        $this->assertSame(1, User::count());

        // The other, with no row yet, gets one, as at their first password sign-in.
        $this->get('/dashboard', $this->hub(['user' => '2', 'email' => 'sonalimorankar@builtin.bkesari.com', 'role' => 'admin', 'name' => '']))
            ->assertRedirect(route('dashboard.admin'));
        $sonali = User::where('email', BuiltinAdmins::emailFor('sonalimorankar'))->firstOrFail();
        $this->assertAuthenticatedAs($sonali);
        $this->assertSame('2', $sonali->hub_user_id);
        $this->assertSame(['system_admin'], $sonali->getRoleNames()->all());
        $this->assertSame('sonalimorankar', $sonali->name);
    }

    public function test_a_reserved_address_is_only_ever_a_built_in_administrator(): void
    {
        $this->assertIgnored($this->hub(['email' => 'someone@builtin.bkesari.com', 'role' => 'admin']), 'not one of the two');
        $this->assertIgnored($this->hub(['email' => 'smorankar@builtin.bkesari.com', 'role' => 'parent']), 'not as admin');
        $this->assertSame(0, User::count());
    }

    // --- Where it runs -----------------------------------------------------

    public function test_it_runs_after_the_session_starts_and_before_auth_and_guest(): void
    {
        $router = $this->app['router'];
        foreach (['dashboard' => Authenticate::class, 'login' => RedirectIfAuthenticated::class, 'dashboard.parent' => Authenticate::class] as $name => $gate) {
            $stack = $router->gatherRouteMiddleware($router->getRoutes()->getByName($name));
            $at = array_search(HubIdentitySignIn::class, $stack, true);

            $this->assertNotFalse($at, $name);
            $this->assertGreaterThan(array_search(StartSession::class, $stack, true), $at, $name);
            $this->assertLessThan(array_search($gate, $stack, true), $at, $name);
        }
    }

    public function test_behind_the_hub_the_edu_base_path_stays_intact(): void
    {
        $this->assertSame(self::BASE_URL, rtrim(config('app.url'), '/'));

        // What the hub forwards: the path without /edu, on the hub's host.
        $this->get('http://dev.bkesari.com/dashboard', $this->hub(['secret' => 'wrong']))
            ->assertRedirect(self::BASE_URL.'/login');
        $this->assertGuest();

        $this->get('http://dev.bkesari.com/dashboard', $this->hub())
            ->assertRedirect(self::BASE_URL.'/dashboard/parent');
        $this->assertAuthenticated();

        $this->getJson('http://dev.bkesari.com/shell/me', $this->hub())
            ->assertOk()
            ->assertJsonPath('user.email', 'asha@example.com')
            ->assertJsonPath('signOut.url', self::BASE_URL.'/logout');
    }
}
