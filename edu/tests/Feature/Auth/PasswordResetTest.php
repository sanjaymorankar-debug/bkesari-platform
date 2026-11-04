<?php

namespace Tests\Feature\Auth;

use App\Models\TwoFactorAuthentication;
use App\Models\User;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Password;
use Livewire\Volt\Volt;
use PragmaRX\Google2FA\Google2FA;
use Tests\TestCase;

class PasswordResetTest extends TestCase
{
    use RefreshDatabase;

    public function test_reset_password_link_screen_can_be_rendered(): void
    {
        $response = $this->get('/forgot-password');

        $response
            ->assertSeeVolt('pages.auth.forgot-password')
            ->assertStatus(200);
    }

    public function test_reset_password_link_can_be_requested(): void
    {
        Notification::fake();

        $user = User::factory()->create();

        Volt::test('pages.auth.forgot-password')
            ->set('email', $user->email)
            ->call('sendPasswordResetLink');

        Notification::assertSentTo($user, ResetPassword::class);
    }

    public function test_reset_password_screen_can_be_rendered(): void
    {
        Notification::fake();

        $user = User::factory()->create();

        Volt::test('pages.auth.forgot-password')
            ->set('email', $user->email)
            ->call('sendPasswordResetLink');

        Notification::assertSentTo($user, ResetPassword::class, function ($notification) {
            $response = $this->get('/reset-password/'.$notification->token);

            $response
                ->assertSeeVolt('pages.auth.reset-password')
                ->assertStatus(200);

            return true;
        });
    }

    public function test_password_can_be_reset_with_valid_token(): void
    {
        Notification::fake();

        $user = User::factory()->create();

        Volt::test('pages.auth.forgot-password')
            ->set('email', $user->email)
            ->call('sendPasswordResetLink');

        Notification::assertSentTo($user, ResetPassword::class, function ($notification) use ($user) {
            $component = Volt::test('pages.auth.reset-password', ['token' => $notification->token])
                ->set('email', $user->email)
                ->set('password', 'password')
                ->set('password_confirmation', 'password');

            $component->call('resetPassword');

            $component
                ->assertRedirect('/login')
                ->assertHasNoErrors();

            return true;
        });
    }

    public function test_a_reset_confirms_the_email_and_ends_every_earlier_session(): void
    {
        $user = User::factory()->create(['email_verified_at' => null]);
        DB::table('sessions')->insert([
            'id' => 'signed-in-before-the-reset', 'user_id' => $user->id, 'ip_address' => '203.0.113.9',
            'user_agent' => 'test', 'payload' => base64_encode('x'), 'last_activity' => time(),
        ]);
        $token = Password::createToken($user);

        Volt::test('pages.auth.reset-password', ['token' => $token])
            ->set('email', $user->email)
            ->set('password', 'A-new-pass-2026')
            ->set('password_confirmation', 'A-new-pass-2026')
            ->call('resetPassword')
            ->assertHasNoErrors()
            ->assertRedirect('/login');

        $this->assertNotNull($user->refresh()->email_verified_at, 'the link came to this inbox');
        $this->assertSame(0, DB::table('sessions')->where('user_id', $user->id)->count());
    }

    public function test_a_two_factor_challenge_opened_before_a_reset_ends_with_it(): void
    {
        $secret = (new Google2FA)->generateSecretKey();
        $user = User::factory()->create();
        TwoFactorAuthentication::create(['user_id' => $user->id, 'secret' => $secret, 'confirmed_at' => now()]);

        // Someone with the old password (and the authenticator app) passes the first step and waits.
        Volt::test('pages.auth.login')->call('useMethod', 'password')
            ->set('form.email', $user->email)->set('form.password', 'password')->call('login')
            ->assertRedirect(route('two-factor.challenge', absolute: false));
        $theirBrowser = session()->all();

        session()->flush();
        Volt::test('pages.auth.reset-password', ['token' => Password::createToken($user)])
            ->set('email', $user->email)
            ->set('password', 'A-new-pass-2026')
            ->set('password_confirmation', 'A-new-pass-2026')
            ->call('resetPassword')
            ->assertHasNoErrors();

        session()->flush();
        session()->put($theirBrowser);
        Volt::test('pages.auth.two-factor-challenge')->set('code', (new Google2FA)->getCurrentOtp($secret))->call('verify')
            ->assertRedirect(route('login', absolute: false));
        $this->assertGuest();
    }
}
