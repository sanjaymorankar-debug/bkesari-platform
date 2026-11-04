<?php

namespace Tests\Feature\Auth;

use App\Http\Middleware\HubSignIn;
use App\Livewire\Forms\LoginForm;
use App\Models\User;
use App\Services\MobileSignIn;
use Illuminate\Auth\Events\Attempting;
use Illuminate\Cache\RateLimiter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\RateLimiter as RateLimiterFacade;
use Livewire\Volt\Volt;
use Mockery;
use Tests\TestCase;

/**
 * Education keeps its own accounts, end to end: its own session cookie, its
 * own sign-in screens and lockout, and nothing forwarded by the bkesari hub is
 * taken as an identity. The shell above the page asks /shell/me who is signed
 * in, and signs out through POST /logout.
 */
class OwnAccountTest extends TestCase
{
    use RefreshDatabase;

    /** config/session.php as it reads with this APP_URL (and no SESSION_* overrides). */
    private function sessionConfigFor(string $appUrl): array
    {
        $before = [$_ENV['APP_URL'] ?? null, $_SERVER['APP_URL'] ?? null, getenv('APP_URL')];
        $_ENV['APP_URL'] = $_SERVER['APP_URL'] = $appUrl;
        putenv('APP_URL='.$appUrl);

        try {
            return require config_path('session.php');
        } finally {
            [$_ENV['APP_URL'], $_SERVER['APP_URL']] = [$before[0], $before[1]];
            $before[2] === false ? putenv('APP_URL') : putenv('APP_URL='.$before[2]);
        }
    }

    public function test_the_session_cookie_is_edu_sid_on_the_published_path(): void
    {
        $hub = $this->sessionConfigFor('https://bkesari.com/edu');
        $this->assertSame('edu_sid', $hub['cookie']);
        $this->assertSame('/edu', $hub['path']);
        $this->assertTrue($hub['secure']);
        $this->assertTrue($hub['http_only']);
        $this->assertSame('lax', $hub['same_site']);

        $own = $this->sessionConfigFor('http://edu.localhost');
        $this->assertSame('/', $own['path']);
        $this->assertFalse($own['secure']);

        $this->assertSame('/edu', $this->sessionConfigFor('https://dev.bkesari.com/edu/')['path']);
    }

    public function test_the_response_sets_the_edu_sid_cookie_http_only_and_lax(): void
    {
        $cookie = collect($this->get('/login')->headers->getCookies())->firstWhere(fn ($c) => $c->getName() === 'edu_sid');

        $this->assertNotNull($cookie, 'no edu_sid cookie');
        $this->assertTrue($cookie->isHttpOnly());
        $this->assertSame('lax', $cookie->getSameSite());
        $this->assertSame('/', $cookie->getPath());
    }

    public function test_a_hub_token_no_longer_signs_anyone_in(): void
    {
        User::factory()->create(['email' => 'asha@example.com']);

        $this->get('/dashboard', ['X-Bkesari-Token' => 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJodWItYXNoYSIsImVtYWlsIjoiYXNoYUBleGFtcGxlLmNvbSJ9.c2ln'])
            ->assertRedirect(route('login'));
        $this->assertGuest();
        $this->assertFalse(class_exists(HubSignIn::class));
        $this->assertNull(config('services.hub.jwks'));
        $this->assertNull(config('services.hub.jwks_url'));
    }

    public function test_five_wrong_passwords_lock_sign_in_for_fifteen_minutes(): void
    {
        $user = User::factory()->create();
        Cache::flush();
        $attempt = fn (string $password) => Volt::test('pages.auth.login')
            ->call('useMethod', 'password')
            ->set('form.email', $user->email)
            ->set('form.password', $password)
            ->call('login');

        foreach (range(1, LoginForm::MAX_ATTEMPTS - 1) as $i) {
            $attempt('wrong-password')->assertHasErrors('form.email');
        }
        $attempt('wrong-password')->assertHasErrors('form.email')->assertSee('locked for 15 minutes');

        // Locked: even the right password is refused, with the reason.
        $this->travel(14)->minutes();
        $attempt('password')->assertHasErrors('form.email')->assertSee('Too many failed sign-in attempts');
        $this->assertGuest();

        $this->travel(1)->minutes();
        $this->travel(1)->seconds();
        $attempt('password')->assertHasNoErrors()->assertRedirect(route('dashboard', absolute: false));
        $this->assertAuthenticatedAs($user);
    }

    public function test_the_lock_runs_fifteen_minutes_from_the_fifth_miss(): void
    {
        $user = User::factory()->create();
        Cache::flush();
        $attempt = fn (string $password) => Volt::test('pages.auth.login')
            ->call('useMethod', 'password')
            ->set('form.email', $user->email)->set('form.password', $password)->call('login');

        foreach (range(1, LoginForm::MAX_ATTEMPTS - 1) as $i) {
            $attempt('wrong-password');
        }
        $this->travel(14)->minutes();
        $attempt('wrong-password')->assertSee('locked for 15 minutes');

        // 15 minutes after the first miss, but only 1 after the fifth.
        $this->travel(2)->minutes();
        $attempt('password')->assertHasErrors('form.email');
        $this->assertGuest();
    }

    public function test_the_last_tries_say_how_many_are_left(): void
    {
        $user = User::factory()->create();
        Cache::flush();

        foreach (range(1, 3) as $i) {
            $component = Volt::test('pages.auth.login')->call('useMethod', 'password')
                ->set('form.email', $user->email)->set('form.password', 'nope')->call('login');
        }

        $component->assertSee('2 more wrong attempts lock sign-in for 15 minutes.');
    }

    public function test_passwords_sent_together_still_get_only_five_checks(): void
    {
        $user = User::factory()->create();
        Cache::flush();
        // Requests that arrive together all pass the limiter's check before
        // any of them has been counted. (Twelve real requests at once against
        // the database cache store had all twelve passwords checked before
        // the fix.)
        $limiter = Mockery::mock(RateLimiter::class, [app('cache')->driver(config('cache.limiter'))])->makePartial();
        $limiter->shouldReceive('tooManyAttempts')->andReturnFalse();
        RateLimiterFacade::swap($limiter);
        $checked = 0;
        Event::listen(Attempting::class, function () use (&$checked) {
            $checked++;
        });

        // Twelve wrong passwords and, last, the right one.
        foreach ([...array_fill(0, 12, 'wrong-password'), 'password'] as $password) {
            Volt::test('pages.auth.login')->call('useMethod', 'password')
                ->set('form.email', $user->email)->set('form.password', $password)->call('login')
                ->assertHasErrors('form.email');
        }

        $this->assertSame(LoginForm::MAX_ATTEMPTS, $checked);
        $this->assertGuest();
    }

    public function test_the_shared_route_names_open_the_same_screens(): void
    {
        $this->get('/sign-in')->assertOk()->assertSeeVolt('pages.auth.login');
        $this->get('/sign-up')->assertOk()->assertSeeVolt('pages.auth.register');
        $this->get('/forgot-password')->assertOk()->assertSeeVolt('pages.auth.forgot-password');

        $this->get('/verify')->assertRedirect(route('login'));
        $this->actingAs(User::factory()->unverified()->create())
            ->get('/verify')->assertOk()->assertSeeVolt('pages.auth.verify-email');
    }

    public function test_the_sign_in_screen_offers_an_emailed_code_and_a_password_and_mobile_only_with_sms(): void
    {
        config(['services.sms.webhook_url' => null]);

        // SMS on hold: a code by email, and the password.
        $this->get('/sign-in')->assertOk()
            ->assertSee('id="tab-code"', false)->assertSee('Email me a code')
            ->assertSee('id="tab-password"', false)
            ->assertDontSee('id="tab-mobile"', false)->assertDontSee('Mobile number');

        // An SMS provider adds the mobile number, first.
        config(['services.sms.webhook_url' => 'https://sms.example.test/send']);
        $html = $this->get('/sign-in')->assertOk()->getContent();
        $this->assertMatchesRegularExpression('/id="tab-mobile".*id="tab-code".*id="tab-password"/s', $html);
        $this->assertStringContainsString('Mobile number', $html);
    }

    public function test_a_sign_in_code_is_never_shown_on_test_or_production(): void
    {
        config(['services.sms.webhook_url' => null, 'mail.default' => 'log']);
        $user = User::factory()->create(['mobile' => '+919876543210']);
        Cache::flush();

        foreach (['test', 'production'] as $env) {
            $this->app['env'] = $env;

            Volt::test('pages.auth.login')->call('useMethod', 'code')->set('codeEmail', $user->email)->call('sendEmailCode')
                ->assertHasErrors('codeEmail')->assertSet('shownEmailCode', null)->assertSet('emailSentTo', '')
                ->assertSee('Sign in with your password instead.');
            $this->assertSame(['status' => 'unavailable'], app(MobileSignIn::class)->send('+919876543210', '203.0.113.1'));
        }
    }

    public function test_every_sign_in_screen_says_it_is_a_separate_education_account(): void
    {
        foreach (['/sign-in', '/login', '/sign-up', '/register', '/forgot-password'] as $path) {
            $this->get($path)->assertOk()
                ->assertSee('class="edu-project"', false)
                ->assertSee('Education')
                ->assertSee('This is a separate account for Education.');
        }
    }

    public function test_the_shell_is_told_who_is_signed_in(): void
    {
        $this->getJson('/shell/me')->assertStatus(401)
            ->assertExactJson(['user' => null, 'signInUrl' => route('sign-in')]);

        $user = User::factory()->create(['name' => 'Asha Patil', 'email' => 'asha@example.com']);
        $response = $this->actingAs($user)->getJson('/shell/me')->assertOk();

        $response->assertJsonPath('user', ['name' => 'Asha Patil', 'email' => 'asha@example.com'])
            ->assertJsonPath('signOut.url', route('logout'))
            ->assertJsonPath('signOut.next', route('sign-in'))
            ->assertJsonPath('signOut.csrf', session()->token())
            ->assertJsonPath('links.0', ['label' => 'Profile', 'href' => route('profile')])
            ->assertJsonPath('links.1', ['label' => 'Dashboard', 'href' => route('dashboard')]);
        $this->assertStringContainsString('no-store', $response->headers->get('Cache-Control'));
    }

    public function test_the_shell_signs_out_with_a_json_post(): void
    {
        $user = User::factory()->create();
        $this->actingAs($user);

        $this->postJson('/logout', [], ['X-CSRF-Token' => session()->token()])
            ->assertOk()->assertJson(['signedOut' => true, 'next' => route('sign-in')]);
        $this->assertGuest();
    }

    public function test_the_apps_own_sign_out_form_goes_home(): void
    {
        $this->actingAs(User::factory()->create());

        $this->post('/logout')->assertRedirect(route('home'));
        $this->assertGuest();
    }

    public function test_pages_load_kesari_and_the_shell(): void
    {
        $html = $this->get('/login')->assertOk()->getContent();

        $this->assertStringContainsString('data-project="education"', $html);
        $this->assertStringContainsString('<link rel="stylesheet" href="/kesari-ui/1.0.0/kesari.css">', $html);
        $this->assertStringContainsString('<script src="/kesari-ui/1.0.0/kesari.js"></script>', $html);
        $this->assertStringContainsString('<script src="/shared/menu.js" defer></script>', $html);
        $this->assertStringContainsString('data-bkesari-menu data-me-url="'.url('/shell/me').'"', $html);

        // kesari.js is in <head> and not deferred: it sets the theme before the first paint.
        $head = substr($html, 0, strpos($html, '</head>'));
        $this->assertStringContainsString('kesari.js"></script>', $head);
    }

    public function test_the_asset_origin_can_point_at_the_hub(): void
    {
        config(['services.hub.asset_origin' => 'https://bkesari.com']);

        $this->get('/login')->assertOk()
            ->assertSee('href="https://bkesari.com/kesari-ui/1.0.0/kesari.css"', false)
            ->assertSee('src="https://bkesari.com/kesari-ui/1.0.0/kesari.js"', false)
            ->assertSee('src="https://bkesari.com/shared/menu.js"', false);
    }

    public function test_phones_get_at_most_four_role_aware_items(): void
    {
        $count = fn (string $html) => preg_match('/<nav class="k-bottomnav".*?<\/nav>/s', $html, $m) ? substr_count($m[0], '<a ') : 0;

        $this->assertSame(4, $count($this->get('/')->getContent()));

        $parent = User::factory()->create();
        $parent->assignRole('parent');
        $html = $this->actingAs($parent)->get(route('dashboard.parent'))->getContent();
        $this->assertSame(4, $count($html));
        $this->assertMatchesRegularExpression('/k-bottomnav.*'.preg_quote(route('schools.index'), '/').'.*Alerts.*Profile/s', $html);

        $student = User::factory()->create();
        $student->assignRole('student');
        $html = $this->actingAs($student)->get(route('dashboard.student'))->getContent();
        $this->assertSame(4, $count($html));
        $this->assertMatchesRegularExpression('/k-bottomnav.*'.preg_quote(route('growth.show', $student), '/').'/s', $html);
    }
}
