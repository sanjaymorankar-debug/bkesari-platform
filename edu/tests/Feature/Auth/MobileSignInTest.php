<?php

namespace Tests\Feature\Auth;

use App\Models\TwoFactorAuthentication;
use App\Models\User;
use App\Services\MobileSignIn;
use App\Support\IndianMobile;
use Illuminate\Cache\RateLimiter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\RateLimiter as RateLimiterFacade;
use Livewire\Volt\Volt;
use Mockery;
use PragmaRX\Google2FA\Google2FA;
use Tests\TestCase;

/**
 * Signing in with a mobile number and a six-digit code (App\Services\MobileSignIn).
 *
 * With no SMS provider the suite runs in "screen" mode (APP_ENV=testing): the
 * code comes back to the page. The provider and production cases switch the
 * configuration per test.
 */
class MobileSignInTest extends TestCase
{
    use RefreshDatabase;

    private const MOBILE = '+919876543210';

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.sms.webhook_url' => null, 'services.sms.webhook_token' => null]);
        Cache::flush();
    }

    private function asha(): User
    {
        return User::factory()->create(['email' => 'asha@example.com', 'mobile' => self::MOBILE]);
    }

    private function askForCode(string $typed = '98765 43210')
    {
        return Volt::test('pages.auth.login')
            ->call('useMethod', 'mobile')
            ->set('mobile', $typed)
            ->call('sendCode');
    }

    public function test_indian_mobile_numbers_are_normalised_however_they_are_typed(): void
    {
        foreach (['9876543210', '98765 43210', '098765-43210', '+91 98765 43210', '919876543210', '+91-9876543210'] as $typed) {
            $this->assertSame(self::MOBILE, IndianMobile::normalize($typed), $typed);
        }
        foreach (['', '12345', '5876543210', '98765432100', '+44 7700 900123', 'abcdefghij'] as $typed) {
            $this->assertNull(IndianMobile::normalize($typed), $typed);
        }
        $this->assertSame("+91\u{00A0}•••••\u{00A0}•3210", IndianMobile::mask(self::MOBILE));
    }

    public function test_mobile_is_the_first_tab_where_codes_can_be_delivered(): void
    {
        Volt::test('pages.auth.login')->assertSet('method', 'mobile')->assertSee('Send code');
    }

    public function test_a_code_signs_the_account_in(): void
    {
        $asha = $this->asha();

        $component = $this->askForCode();
        $code = $component->get('shownCode');

        $this->assertMatchesRegularExpression('/^\d{6}$/', $code);
        $component->assertSee('Development only.')->assertSee($code)->assertSee("+91\u{00A0}•••••\u{00A0}•3210");

        $component->set('code', $code)->call('verifyCode')
            ->assertHasNoErrors()
            ->assertRedirect(route('dashboard', absolute: false));

        $this->assertAuthenticatedAs($asha);
    }

    public function test_the_code_is_kept_only_as_a_hash(): void
    {
        $this->asha();
        $code = $this->askForCode()->get('shownCode');

        $entry = Cache::get('mobile-sign-in:code:'.hash('sha256', self::MOBILE));
        $this->assertIsArray($entry);
        $this->assertStringNotContainsString($code, json_encode($entry));
        $this->assertTrue(Hash::check($code, $entry['hash']));
    }

    public function test_a_code_works_once(): void
    {
        $this->asha();
        $code = $this->askForCode()->get('shownCode');

        $service = app(MobileSignIn::class);
        $this->assertSame('ok', $service->verify(self::MOBILE, $code)['status']);
        $this->assertSame('expired', $service->verify(self::MOBILE, $code)['status']);
    }

    public function test_a_code_expires_after_ten_minutes(): void
    {
        $this->asha();
        $component = $this->askForCode();
        $code = $component->get('shownCode');

        $this->travel(10)->minutes();
        $this->travel(1)->seconds();

        $component->set('code', $code)->call('verifyCode')->assertHasErrors('code')
            ->assertSee('That code has expired or was never sent.');
        $this->assertGuest();
    }

    public function test_five_wrong_codes_throw_the_code_away(): void
    {
        $this->asha();
        $component = $this->askForCode();
        $code = $component->get('shownCode');
        $wrong = $code === '000000' ? '111111' : '000000';

        foreach ([4, 3, 2, 1] as $left) {
            $component->set('code', $wrong)->call('verifyCode')->assertHasErrors('code')
                ->assertSee($left === 1 ? '1 try left' : "{$left} tries left");
        }
        $component->set('code', $wrong)->call('verifyCode')->assertSee('Too many wrong codes. Ask for a new code.');

        // The right code is no use now: the code itself is gone.
        $component->set('code', $code)->call('verifyCode')->assertHasErrors('code');
        $this->assertGuest();
    }

    public function test_sending_is_rate_limited_per_number(): void
    {
        $this->asha();

        foreach (range(1, MobileSignIn::SENDS_PER_NUMBER) as $i) {
            $this->askForCode()->assertHasNoErrors();
        }

        $this->askForCode()->assertHasErrors('mobile')->assertSee('Too many codes asked for.')->assertSet('sentTo', '');

        $this->travel(MobileSignIn::SEND_WINDOW_SECONDS + 1)->seconds();
        $this->askForCode()->assertHasNoErrors();
    }

    public function test_sending_is_rate_limited_per_address(): void
    {
        foreach (range(1, MobileSignIn::SENDS_PER_ADDRESS) as $i) {
            $this->assertSame('sent', app(MobileSignIn::class)->send('+9198765432'.sprintf('%02d', $i), '203.0.113.9')['status']);
        }

        $this->assertSame('throttled', app(MobileSignIn::class)->send('+919999999999', '203.0.113.9')['status']);
    }

    /**
     * Runs $request $times as if every one of them arrived at the same moment:
     * each reads the code entry as it was before any of them wrote to it,
     * which is what requests racing each other on a tier see. (Twelve real
     * processes against the database cache store got 12 "wrong" from 12
     * wrong codes, and 12 sign-ins from one code, before the fix.)
     */
    private function atOnce(int $times, callable $request): array
    {
        $key = 'mobile-sign-in:code:'.hash('sha256', self::MOBILE);
        $before = Cache::get($key);

        return array_map(function (int $i) use ($key, $before, $request) {
            Cache::put($key, $before, MobileSignIn::CODE_TTL_SECONDS);

            return $request($i);
        }, range(1, $times));
    }

    public function test_wrong_codes_sent_together_still_get_only_five_tries(): void
    {
        $this->asha();
        $code = $this->askForCode()->get('shownCode');
        $wrong = $code === '000000' ? '111111' : '000000';
        $service = app(MobileSignIn::class);

        // Twelve wrong codes and, last, the right one, all at once: only five
        // are ever checked, so the right one is no use either.
        $statuses = $this->atOnce(13, fn (int $i) => $service->verify(self::MOBILE, $i === 13 ? $code : $wrong)['status']);

        $this->assertSame([...array_fill(0, 4, 'wrong'), ...array_fill(0, 9, 'locked')], $statuses);
        $this->assertGuest();
    }

    public function test_a_code_carried_by_several_requests_at_once_signs_in_once(): void
    {
        $this->asha();
        $code = $this->askForCode()->get('shownCode');
        $service = app(MobileSignIn::class);

        $this->assertSame(['ok', 'expired', 'expired'], $this->atOnce(3, fn () => $service->verify(self::MOBILE, $code)['status']));
    }

    public function test_codes_asked_for_together_still_stop_at_the_limit(): void
    {
        $this->asha();
        // Requests that arrive together all pass the limiter's check before
        // any of them has been counted.
        $limiter = Mockery::mock(RateLimiter::class, [app('cache')->driver(config('cache.limiter'))])->makePartial();
        $limiter->shouldReceive('tooManyAttempts')->andReturnFalse();
        RateLimiterFacade::swap($limiter);

        $statuses = array_map(fn (int $i) => app(MobileSignIn::class)->send(self::MOBILE, "203.0.113.{$i}")['status'], range(1, 6));

        $this->assertSame(['sent', 'sent', 'sent', 'throttled', 'throttled', 'throttled'], $statuses);
    }

    public function test_an_unknown_number_gets_the_same_answer_and_no_code(): void
    {
        $component = $this->askForCode('91234 56789');

        $component->assertHasNoErrors()->assertSet('sentTo', '+919123456789')->assertSet('shownCode', null)
            ->assertSee('If no account uses this number, no code is sent.');
        $this->assertNull(Cache::get('mobile-sign-in:code:'.hash('sha256', '+919123456789')));
    }

    public function test_a_number_that_is_not_an_indian_mobile_is_refused(): void
    {
        $this->askForCode('12345')->assertHasErrors('mobile')->assertSee('Enter a 10-digit Indian mobile number');
    }

    public function test_with_a_provider_the_code_goes_by_sms_and_is_not_shown(): void
    {
        config(['services.sms.webhook_url' => 'https://sms.example.test/send', 'services.sms.webhook_token' => 'secret-token']);
        Http::fake(['sms.example.test/*' => Http::response(['ok' => true])]);
        $asha = $this->asha();

        $component = $this->askForCode()->assertHasNoErrors()->assertSet('shownCode', null)->assertDontSee('Development only.');

        $sent = null;
        Http::assertSent(function (Request $request) use (&$sent) {
            $sent = $request;

            return $request->url() === 'https://sms.example.test/send'
                && $request->method() === 'POST'
                && $request->hasHeader('Authorization', 'Bearer secret-token')
                && $request['to'] === self::MOBILE;
        });
        $this->assertMatchesRegularExpression('/sign-in code is (\d{6})\./', $sent['text']);
        preg_match('/(\d{6})/', $sent['text'], $m);

        $component->set('code', $m[1])->call('verifyCode')->assertRedirect(route('dashboard', absolute: false));
        $this->assertAuthenticatedAs($asha);
    }

    public function test_a_provider_failure_is_reported_and_leaves_no_code(): void
    {
        config(['services.sms.webhook_url' => 'https://sms.example.test/send']);
        Http::fake(['sms.example.test/*' => Http::response(['error' => 'down'], 503)]);
        $this->asha();

        $this->askForCode()->assertHasErrors('mobile')->assertSee('We could not send the text message')->assertSet('sentTo', '');
        $this->assertNull(Cache::get('mobile-sign-in:code:'.hash('sha256', self::MOBILE)));
    }

    public function test_in_production_without_a_provider_mobile_sign_in_says_to_use_email(): void
    {
        $this->app['env'] = 'production';
        $this->asha();

        Volt::test('pages.auth.login')->assertSet('method', 'email')
            ->call('useMethod', 'mobile')
            ->assertSee('SMS sign-in is not available yet; use email.')
            ->set('mobile', '98765 43210')->call('sendCode')
            ->assertHasErrors('mobile')->assertSet('sentTo', '')->assertSet('shownCode', null);

        $this->assertSame(MobileSignIn::MODE_OFF, app(MobileSignIn::class)->mode());
        $this->assertNull(Cache::get('mobile-sign-in:code:'.hash('sha256', self::MOBILE)));
    }

    public function test_an_account_with_two_factor_still_has_to_pass_it(): void
    {
        $officer = $this->asha();
        $officer->assignRole('district_officer');
        TwoFactorAuthentication::create([
            'user_id' => $officer->id, 'secret' => (new Google2FA)->generateSecretKey(), 'confirmed_at' => now(),
            'recovery_codes' => ['AAAA-BBBB'],
        ]);

        $component = $this->askForCode();
        $component->set('code', $component->get('shownCode'))->call('verifyCode')
            ->assertRedirect(route('two-factor.challenge', absolute: false));

        $this->assertGuest();
        $this->assertSame($officer->id, session('2fa_user_id'));
    }

    public function test_registration_can_add_a_mobile_number(): void
    {
        Volt::test('pages.auth.register')
            ->set('name', 'Ravi')->set('email', 'ravi@example.com')->set('mobile', '098765 43210')
            ->set('password', 'password')->set('password_confirmation', 'password')
            ->call('register')->assertHasNoErrors();

        $this->assertSame(self::MOBILE, User::where('email', 'ravi@example.com')->value('mobile'));
    }

    public function test_one_mobile_number_belongs_to_one_account(): void
    {
        $this->asha();

        Volt::test('pages.auth.register')
            ->set('name', 'Ravi')->set('email', 'ravi@example.com')->set('mobile', '+91 98765 43210')
            ->set('password', 'password')->set('password_confirmation', 'password')
            ->call('register')->assertHasErrors('mobile');

        Volt::test('pages.auth.register')
            ->set('name', 'Ravi')->set('email', 'ravi@example.com')->set('mobile', '12345')
            ->set('password', 'password')->set('password_confirmation', 'password')
            ->call('register')->assertHasErrors('mobile');

        $this->assertDatabaseMissing('users', ['email' => 'ravi@example.com']);
    }

    public function test_the_profile_can_add_change_and_remove_the_mobile_number(): void
    {
        $user = User::factory()->create();

        Volt::actingAs($user)->test('profile.update-profile-information-form')
            ->set('mobile', '99887 76655')->call('updateProfileInformation')->assertHasNoErrors();
        $this->assertSame('+919988776655', $user->fresh()->mobile);

        Volt::actingAs($user)->test('profile.update-profile-information-form')
            ->set('mobile', '')->call('updateProfileInformation')->assertHasNoErrors();
        $this->assertNull($user->fresh()->mobile);

        $this->asha();
        Volt::actingAs($user)->test('profile.update-profile-information-form')
            ->set('mobile', '9876543210')->call('updateProfileInformation')->assertHasErrors('mobile');
    }
}
