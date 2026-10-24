<?php

namespace Tests\Feature\Platform;

use App\Models\TwoFactorAuthentication;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\RateLimiter;
use Livewire\Volt\Volt;
use PragmaRX\Google2FA\Google2FA;
use Tests\TestCase;

class TwoFactorAuthTest extends TestCase
{
    use RefreshDatabase;

    private function makeOfficer(): User
    {
        $user = User::factory()->create();
        $user->assignRole('district_officer');

        return $user;
    }

    public function test_officer_can_set_up_and_confirm_two_factor(): void
    {
        $officer = $this->makeOfficer();

        $component = Volt::actingAs($officer)->test('settings.two-factor')
            ->call('startSetup');

        $twoFactor = TwoFactorAuthentication::where('user_id', $officer->id)->firstOrFail();
        $this->assertNull($twoFactor->confirmed_at);

        $validCode = (new Google2FA())->getCurrentOtp($twoFactor->secret);

        $component->set('confirmCode', $validCode)->call('confirm');

        $twoFactor->refresh();
        $this->assertNotNull($twoFactor->confirmed_at);
        $this->assertNotNull($twoFactor->recovery_codes);
        $this->assertCount(8, $twoFactor->recovery_codes);
    }

    public function test_confirming_with_wrong_code_fails(): void
    {
        $officer = $this->makeOfficer();

        $component = Volt::actingAs($officer)->test('settings.two-factor')
            ->call('startSetup')
            ->set('confirmCode', '000000')
            ->call('confirm');

        $component->assertHasErrors('confirmCode');
        $this->assertNull(TwoFactorAuthentication::where('user_id', $officer->id)->first()->confirmed_at);
    }

    public function test_login_redirects_to_two_factor_challenge_when_enabled(): void
    {
        $officer = $this->makeOfficer();
        $secret = (new Google2FA())->generateSecretKey();
        TwoFactorAuthentication::create([
            'user_id' => $officer->id, 'secret' => $secret, 'confirmed_at' => now(),
            'recovery_codes' => ['AAAA-BBBB'],
        ]);

        $component = Volt::test('pages.auth.login')
            ->set('form.email', $officer->email)
            ->set('form.password', 'password')
            ->call('login');

        $component->assertRedirect(route('two-factor.challenge', absolute: false));
        $this->assertGuest();
    }

    public function test_two_factor_challenge_completes_login_with_valid_code(): void
    {
        $officer = $this->makeOfficer();
        $secret = (new Google2FA())->generateSecretKey();
        TwoFactorAuthentication::create([
            'user_id' => $officer->id, 'secret' => $secret, 'confirmed_at' => now(),
            'recovery_codes' => ['AAAA-BBBB'],
        ]);

        $this->withSession(['2fa_user_id' => $officer->id, '2fa_remember' => false]);

        $validCode = (new Google2FA())->getCurrentOtp($secret);

        Volt::test('pages.auth.two-factor-challenge')
            ->set('code', $validCode)
            ->call('verify')
            ->assertRedirect(route('dashboard', absolute: false));

        $this->assertAuthenticatedAs($officer);
    }

    public function test_two_factor_challenge_rejects_invalid_code(): void
    {
        $officer = $this->makeOfficer();
        $secret = (new Google2FA())->generateSecretKey();
        TwoFactorAuthentication::create([
            'user_id' => $officer->id, 'secret' => $secret, 'confirmed_at' => now(),
            'recovery_codes' => ['AAAA-BBBB'],
        ]);

        $this->withSession(['2fa_user_id' => $officer->id, '2fa_remember' => false]);

        Volt::test('pages.auth.two-factor-challenge')
            ->set('code', '000000')
            ->call('verify')
            ->assertHasErrors('code');

        $this->assertGuest();
    }

    public function test_recovery_code_can_be_used_once(): void
    {
        $officer = $this->makeOfficer();
        $secret = (new Google2FA())->generateSecretKey();
        TwoFactorAuthentication::create([
            'user_id' => $officer->id, 'secret' => $secret, 'confirmed_at' => now(),
            'recovery_codes' => ['AAAA-BBBB'],
        ]);

        $this->withSession(['2fa_user_id' => $officer->id, '2fa_remember' => false]);

        Volt::test('pages.auth.two-factor-challenge')
            ->set('useRecoveryCode', true)
            ->set('code', 'AAAA-BBBB')
            ->call('verify')
            ->assertRedirect(route('dashboard', absolute: false));

        $this->assertAuthenticatedAs($officer);

        $twoFactor = TwoFactorAuthentication::where('user_id', $officer->id)->first();
        $this->assertNotContains('AAAA-BBBB', $twoFactor->recovery_codes);
    }

    private function officerAtTheChallenge(array $recoveryCodes = ['AAAA-BBBB']): array
    {
        $officer = $this->makeOfficer();
        $secret = (new Google2FA())->generateSecretKey();
        TwoFactorAuthentication::create([
            'user_id' => $officer->id, 'secret' => $secret, 'confirmed_at' => now(),
            'recovery_codes' => $recoveryCodes,
        ]);

        $this->withSession(['2fa_user_id' => $officer->id, '2fa_remember' => false]);

        return [$officer, $secret];
    }

    /**
     * Codes that are certainly wrong right now, so a guess can never be the
     * real one by chance.
     */
    private function wrongCodes(string $secret, int $count): array
    {
        $codes = [];
        for ($candidate = 0; count($codes) < $count; $candidate++) {
            $code = sprintf('%06d', $candidate);
            if (! (new Google2FA())->verifyKey($secret, $code)) {
                $codes[] = $code;
            }
        }

        return $codes;
    }

    public function test_challenge_stops_accepting_codes_after_five_wrong_ones(): void
    {
        [$officer, $secret] = $this->officerAtTheChallenge();

        $challenge = Volt::test('pages.auth.two-factor-challenge');
        foreach ($this->wrongCodes($secret, 5) as $guess) {
            $challenge->set('code', $guess)->call('verify')->assertHasErrors('code');
        }

        // Even the right code is refused now, so guessing has stopped paying.
        $challenge->set('code', (new Google2FA())->getCurrentOtp($secret))
            ->call('verify')
            ->assertHasErrors('code')
            ->assertSee('Too many');

        $this->assertGuest();
    }

    public function test_recovery_codes_count_towards_the_same_limit_and_are_not_spent_while_locked(): void
    {
        [$officer] = $this->officerAtTheChallenge(['AAAA-BBBB']);

        $challenge = Volt::test('pages.auth.two-factor-challenge')->set('useRecoveryCode', true);
        foreach (range(1, 5) as $guess) {
            $challenge->set('code', 'WRONG-000'.$guess)->call('verify')->assertHasErrors('code');
        }

        $challenge->set('code', 'AAAA-BBBB')->call('verify')->assertHasErrors('code');

        $this->assertGuest();
        $this->assertContains('AAAA-BBBB', TwoFactorAuthentication::where('user_id', $officer->id)->first()->recovery_codes);
    }

    public function test_a_correct_code_inside_the_limit_signs_in_and_resets_the_count(): void
    {
        [$officer, $secret] = $this->officerAtTheChallenge();

        $challenge = Volt::test('pages.auth.two-factor-challenge');
        foreach ($this->wrongCodes($secret, 4) as $guess) {
            $challenge->set('code', $guess)->call('verify')->assertHasErrors('code');
        }

        $challenge->set('code', (new Google2FA())->getCurrentOtp($secret))
            ->call('verify')
            ->assertRedirect(route('dashboard', absolute: false));

        $this->assertAuthenticatedAs($officer);
        $this->assertSame(0, RateLimiter::attempts('two-factor|'.$officer->id));
    }

    public function test_one_account_being_locked_does_not_lock_another(): void
    {
        [$locked] = $this->officerAtTheChallenge();
        foreach (range(1, 5) as $guess) {
            RateLimiter::hit('two-factor|'.$locked->id);
        }

        [$other, $secret] = $this->officerAtTheChallenge();

        Volt::test('pages.auth.two-factor-challenge')
            ->set('code', (new Google2FA())->getCurrentOtp($secret))
            ->call('verify')
            ->assertRedirect(route('dashboard', absolute: false));

        $this->assertAuthenticatedAs($other);
    }
}
