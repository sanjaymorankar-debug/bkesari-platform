<?php

namespace Tests\Feature\Auth;

use App\Models\User;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Notification;
use Livewire\Volt\Volt;
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
        \Illuminate\Support\Facades\DB::table('sessions')->insert([
            'id' => 'signed-in-before-the-reset', 'user_id' => $user->id, 'ip_address' => '203.0.113.9',
            'user_agent' => 'test', 'payload' => base64_encode('x'), 'last_activity' => time(),
        ]);
        $token = \Illuminate\Support\Facades\Password::createToken($user);

        Volt::test('pages.auth.reset-password', ['token' => $token])
            ->set('email', $user->email)
            ->set('password', 'A-new-pass-2026')
            ->set('password_confirmation', 'A-new-pass-2026')
            ->call('resetPassword')
            ->assertHasNoErrors()
            ->assertRedirect('/login');

        $this->assertNotNull($user->refresh()->email_verified_at, 'the link came to this inbox');
        $this->assertSame(0, \Illuminate\Support\Facades\DB::table('sessions')->where('user_id', $user->id)->count());
    }
}
