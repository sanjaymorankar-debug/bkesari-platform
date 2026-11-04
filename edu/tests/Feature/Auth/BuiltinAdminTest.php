<?php

namespace Tests\Feature\Auth;

use App\Livewire\Forms\LoginForm;
use App\Models\District;
use App\Models\Invitation;
use App\Models\School;
use App\Models\SchoolStaff;
use App\Models\State;
use App\Models\TwoFactorAuthentication;
use App\Models\User;
use App\Services\EmailSignIn;
use App\Services\MobileSignIn;
use App\Support\BuiltinAdmins;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Cache\RateLimiter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Hashing\HashManager;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\RateLimiter as RateLimiterFacade;
use Livewire\Volt\Volt;
use Mockery;
use PragmaRX\Google2FA\Google2FA;
use Spatie\Permission\Models\Permission;
use Tests\Feature\Platform\Concerns\SetsUpPlatformData;
use Tests\TestCase;

/**
 * The built-in administrators, smorankar and sonalimorankar (D-036): system
 * admins here, signing in on the password tab with their username and the
 * one password whose bcrypt hash is BUILTIN_ADMIN_PASSWORD_BCRYPT. Their
 * addresses, @builtin.bkesari.com, are reserved everywhere an address is
 * typed, and the accounts have no password of their own.
 */
class BuiltinAdminTest extends TestCase
{
    use RefreshDatabase, SetsUpPlatformData;

    private const PASSWORD = 'Owner-password-2026!';

    private string $hash;

    protected function setUp(): void
    {
        parent::setUp();
        $this->hash = Hash::make(self::PASSWORD);
        config([
            'services.builtin_admins.password_bcrypt' => $this->hash,
            'services.sms.webhook_url' => null,
            'services.sms.webhook_token' => null,
        ]);
        Cache::flush();
    }

    private function signIn(string $typed, string $password, bool $remember = false)
    {
        return Volt::test('pages.auth.login')
            ->call('useMethod', 'password')
            ->set('form.email', $typed)
            ->set('form.password', $password)
            ->set('form.remember', $remember)
            ->call('login');
    }

    private function builtinRows(): int
    {
        return User::where('email', 'like', '%@'.BuiltinAdmins::EMAIL_DOMAIN)->count();
    }

    public function test_the_right_password_signs_in_a_system_admin_with_every_permission(): void
    {
        $this->signIn('  SMORANKAR ', self::PASSWORD)
            ->assertHasNoErrors()
            ->assertRedirect(route('dashboard', absolute: false));

        $admin = User::where('email', 'smorankar@builtin.bkesari.com')->firstOrFail();
        $this->assertAuthenticatedAs($admin);
        $this->assertSame('smorankar', $admin->name);
        $this->assertNotNull($admin->email_verified_at);
        $this->assertTrue($admin->hasRole('system_admin'));
        $this->assertGreaterThan(0, Permission::count());
        foreach (Permission::all() as $permission) {
            $this->assertTrue($admin->can($permission->name), $permission->name);
        }
        $this->assertFalse(Hash::check(self::PASSWORD, $admin->password), 'the row has no password of its own');

        $this->get(route('dashboard'))->assertRedirect(route('dashboard.admin'));
        $this->get(route('dashboard.admin'))->assertOk();
    }

    public function test_each_username_is_the_same_row_every_time(): void
    {
        $this->signIn('smorankar', self::PASSWORD)->assertHasNoErrors();
        $first = Auth::id();
        $password = User::findOrFail($first)->password;
        Auth::logout();

        $this->signIn('Smorankar', self::PASSWORD)->assertHasNoErrors();
        $this->assertSame($first, Auth::id());
        $this->assertSame($password, User::findOrFail($first)->password, 'signing in again leaves the row as it was');
        Auth::logout();

        $this->signIn('sonalimorankar', self::PASSWORD)->assertHasNoErrors();
        $this->assertAuthenticatedAs(User::where('email', 'sonalimorankar@builtin.bkesari.com')->firstOrFail());

        $this->assertSame(2, $this->builtinRows());
        $this->assertSame(1, DB::table('model_has_roles')->where('model_id', $first)->count(), 'the role is given once');
    }

    public function test_a_wrong_password_gets_the_usual_answer_and_is_counted(): void
    {
        $this->signIn('smorankar', 'not-the-password')
            ->assertHasErrors('form.email')
            ->assertSee('These credentials do not match our records.');

        $this->assertGuest();
        $this->assertSame(1, RateLimiterFacade::attempts('smorankar|127.0.0.1'));
        $this->assertSame(0, $this->builtinRows(), 'no account is made for a wrong password');
    }

    public function test_five_wrong_passwords_lock_the_username_for_fifteen_minutes_however_it_is_typed(): void
    {
        foreach (['smorankar', ' SMORANKAR', 'Smorankar ', 'sMoRaNkAr'] as $typed) {
            $this->signIn($typed, 'not-the-password')->assertHasErrors('form.email');
        }
        $this->signIn('smorankar', 'not-the-password')->assertSee('locked for 15 minutes');

        // Locked: even the right password is refused, with the reason.
        $this->travel(14)->minutes();
        $this->signIn('smorankar', self::PASSWORD)->assertSee('Too many failed sign-in attempts');
        $this->assertGuest();
        $this->assertSame(0, $this->builtinRows());

        $this->travel(1)->minutes();
        $this->travel(1)->seconds();
        $this->signIn('smorankar', self::PASSWORD)->assertHasNoErrors();
        $this->assertTrue(Auth::user()->hasRole('system_admin'));
    }

    public function test_passwords_sent_together_still_get_only_five_checks(): void
    {
        // Requests that arrive together all pass the limiter's check before
        // any of them has been counted.
        $limiter = Mockery::mock(RateLimiter::class, [app('cache')->driver(config('cache.limiter'))])->makePartial();
        $limiter->shouldReceive('tooManyAttempts')->andReturnFalse();
        RateLimiterFacade::swap($limiter);

        $real = app('hash');
        $checked = 0;
        $hasher = Mockery::mock(HashManager::class, [app()])->makePartial();
        $hasher->shouldReceive('check')->andReturnUsing(function ($value, $hashed, $options = []) use ($real, &$checked) {
            if ($hashed === $this->hash) {
                $checked++;
            }

            return $real->check($value, $hashed, $options);
        });
        Hash::swap($hasher);

        // Twelve wrong passwords, typed every which way, and, last, the right one.
        $typings = ['smorankar', ' SMORANKAR', 'Smorankar '];
        foreach ([...array_fill(0, 12, 'not-the-password'), self::PASSWORD] as $i => $password) {
            $this->signIn($typings[$i % 3], $password)->assertHasErrors('form.email');
        }

        $this->assertSame(LoginForm::MAX_ATTEMPTS, $checked);
        $this->assertGuest();
        $this->assertSame(0, $this->builtinRows());
    }

    public function test_without_a_bcrypt_hash_the_built_in_sign_in_is_off(): void
    {
        $offs = [
            'unset' => null,
            'blank' => '',
            'the password itself' => self::PASSWORD,
            'not a hash' => 'scrypt:32768:8:1:c2FsdA:a2V5',
            '$2b$ (PHP reads only $2y$)' => '$2b$'.substr($this->hash, 4),
            'cut short' => substr($this->hash, 0, 59),
        ];

        foreach ($offs as $label => $value) {
            config(['services.builtin_admins.password_bcrypt' => $value]);
            RateLimiterFacade::clear('smorankar|127.0.0.1');

            $this->assertNull(BuiltinAdmins::passwordHash(), $label);
            $this->signIn('smorankar', self::PASSWORD)
                ->assertHasErrors('form.email')
                ->assertSee('These credentials do not match our records.');
            $this->assertGuest();
            $this->assertSame(1, RateLimiterFacade::attempts('smorankar|127.0.0.1'), "{$label}: the try still counts");
        }

        $this->assertSame(0, $this->builtinRows());
    }

    public function test_a_normal_user_typing_a_built_in_username_with_their_own_password_is_not_let_in(): void
    {
        $user = User::factory()->create([
            'name' => 'smorankar', 'email' => 'smorankar@example.com', 'password' => Hash::make('Their-own-pass-1'),
        ]);

        $this->signIn('smorankar', 'Their-own-pass-1')->assertHasErrors('form.email');
        $this->assertGuest();

        config(['services.builtin_admins.password_bcrypt' => null]);
        RateLimiterFacade::clear('smorankar|127.0.0.1');
        $this->signIn('smorankar', 'Their-own-pass-1')->assertHasErrors('form.email');
        $this->assertGuest();
        $this->assertSame(0, $this->builtinRows());

        // Their own address still opens their own account.
        $this->signIn('smorankar@example.com', 'Their-own-pass-1')->assertHasNoErrors();
        $this->assertAuthenticatedAs($user);
        $this->assertFalse($user->hasRole('system_admin'));
    }

    public function test_only_the_sign_in_form_takes_a_username_in_the_email_field(): void
    {
        config(['services.builtin_admins.password_bcrypt' => null]);

        // Through to the usual failed sign-in, not stopped as a bad address.
        $this->signIn('smorankar', 'anything')->assertDontSee('must be a valid email address')
            ->assertSee('These credentials do not match our records.');
        // Any other word is still not an address.
        $this->signIn('asha', 'anything')->assertHasErrors(['form.email' => 'email']);

        Volt::test('pages.auth.login')->call('useMethod', 'password')
            ->assertSeeHtml('id="email" type="text" inputmode="email"');

        Volt::test('pages.auth.register')
            ->set('name', 'S Morankar')->set('email', 'smorankar')
            ->set('password', 'password')->set('password_confirmation', 'password')
            ->call('register')
            ->assertHasErrors(['email' => 'email']);
        $this->assertGuest();
    }

    public function test_an_address_on_the_reserved_domain_takes_no_password(): void
    {
        // Made with the address before the domain was reserved, with a password its maker knows.
        User::factory()->create(['email' => 'smorankar@builtin.bkesari.com', 'password' => Hash::make('Makers-pass-123')]);

        // Typed as it is stored (SQLite compares case by case; citext on PostgreSQL would not).
        $this->signIn('smorankar@builtin.bkesari.com', 'Makers-pass-123')
            ->assertHasErrors('form.email')
            ->assertSee('These credentials do not match our records.');
        $this->assertGuest();
    }

    public function test_a_row_someone_made_on_the_reserved_address_changes_hands_at_the_first_built_in_sign_in(): void
    {
        $made = User::factory()->create([
            'name' => 'Not the owner', 'email' => 'smorankar@builtin.bkesari.com',
            'email_verified_at' => null, 'password' => Hash::make('Makers-pass-123'),
        ]);
        DB::table('sessions')->insert([
            'id' => 'the-makers-session', 'user_id' => $made->id, 'ip_address' => '203.0.113.9',
            'user_agent' => 'test', 'payload' => base64_encode('x'), 'last_activity' => time(),
        ]);

        $this->signIn('smorankar', self::PASSWORD)->assertHasNoErrors();

        $made->refresh();
        $this->assertAuthenticatedAs($made);
        $this->assertTrue($made->hasRole('system_admin'));
        $this->assertSame('smorankar', $made->name);
        $this->assertNotNull($made->email_verified_at);
        $this->assertFalse(Hash::check('Makers-pass-123', $made->password), 'the maker\'s password no longer opens it');
        $this->assertSame(0, DB::table('sessions')->where('user_id', $made->id)->count(), 'the maker\'s sessions have ended');
        $this->assertSame(1, $this->builtinRows());
    }

    public function test_a_built_in_administrator_with_two_factor_still_has_to_pass_it(): void
    {
        $admin = BuiltinAdmins::account('sonalimorankar');
        TwoFactorAuthentication::create([
            'user_id' => $admin->id, 'secret' => (new Google2FA)->generateSecretKey(), 'confirmed_at' => now(),
            'recovery_codes' => ['AAAA-BBBB'],
        ]);

        $this->signIn('sonalimorankar', self::PASSWORD, remember: true)
            ->assertRedirect(route('two-factor.challenge', absolute: false));

        $this->assertGuest();
        $this->assertSame($admin->id, session('2fa_user_id'));
        $this->assertTrue(session('2fa_remember'));
    }

    public function test_sign_up_refuses_the_reserved_domain(): void
    {
        foreach (['sonalimorankar@builtin.bkesari.com', 'someone.else@builtin.bkesari.com'] as $email) {
            Volt::test('pages.auth.register')
                ->set('name', 'Someone')->set('email', $email)
                ->set('password', 'password')->set('password_confirmation', 'password')
                ->call('register')
                ->assertHasErrors('email')
                ->assertSee('This email address is reserved.');
        }

        $this->assertGuest();
        $this->assertSame(0, $this->builtinRows());
    }

    public function test_no_sign_in_code_goes_to_a_reserved_address(): void
    {
        BuiltinAdmins::account('smorankar');
        Mail::fake();
        config(['mail.default' => 'smtp']); // a mailer that delivers, so codes are offered

        Volt::test('pages.auth.login')
            ->call('useMethod', 'code')
            ->set('codeEmail', ' Smorankar@Builtin.bkesari.com ')
            ->call('sendEmailCode')
            ->assertHasErrors('codeEmail')
            ->assertSee('This email address is reserved.')
            ->assertSet('emailSentTo', '')
            ->assertSet('shownEmailCode', null);

        Mail::assertNothingOutgoing();
        $this->assertNull(Cache::get('email-sign-in:code:'.hash('sha256', 'smorankar@builtin.bkesari.com')));
        $this->assertSame('reserved', app(EmailSignIn::class)->send('sonalimorankar@builtin.bkesari.com', '203.0.113.9')['status']);
    }

    public function test_no_password_reset_is_sent_for_a_reserved_address(): void
    {
        $admin = BuiltinAdmins::account('smorankar');
        Notification::fake();

        Volt::test('pages.auth.forgot-password')
            ->set('email', $admin->email)
            ->call('sendPasswordResetLink')
            ->assertHasErrors('email')
            ->assertSee('This email address is reserved.');

        Notification::assertNotSentTo($admin, ResetPassword::class);
        $this->assertSame(0, DB::table('password_reset_tokens')->count());
    }

    public function test_no_profile_takes_a_reserved_address(): void
    {
        $user = User::factory()->create(['email' => 'asha@example.com']);

        Volt::actingAs($user)->test('profile.update-profile-information-form')
            ->set('email', 'sonalimorankar@builtin.bkesari.com')
            ->call('updateProfileInformation')
            ->assertHasErrors('email')
            ->assertSee('This email address is reserved.');

        $this->assertSame('asha@example.com', $user->refresh()->email);
    }

    public function test_a_built_in_administrator_keeps_its_address_and_cannot_set_a_password(): void
    {
        $admin = BuiltinAdmins::account('smorankar');
        $password = $admin->password;

        // Its name can change; its address cannot.
        Volt::actingAs($admin)->test('profile.update-profile-information-form')
            ->set('name', 'S. Morankar')
            ->call('updateProfileInformation')
            ->assertHasNoErrors();
        Volt::actingAs($admin)->test('profile.update-profile-information-form')
            ->set('email', 'owner@example.com')
            ->call('updateProfileInformation')
            ->assertHasErrors(['email' => 'in'])
            ->assertSee('A built-in administrator account keeps its email address.');
        $this->assertSame('smorankar@builtin.bkesari.com', $admin->refresh()->email);
        $this->assertSame('S. Morankar', $admin->name);

        $this->actingAs($admin)->get('/profile')->assertOk()
            ->assertSee('This is a built-in administrator account. Its password is set on the server and cannot be changed here.')
            ->assertDontSee('update_password_current_password');

        Volt::actingAs($admin)->test('profile.update-password-form')
            ->set('current_password', self::PASSWORD)
            ->set('password', 'A-new-password-1')
            ->set('password_confirmation', 'A-new-password-1')
            ->call('updatePassword')
            ->assertHasErrors('password');
        $this->assertSame($password, $admin->refresh()->password);
    }

    public function test_the_other_forms_that_make_an_account_refuse_the_reserved_domain(): void
    {
        $state = State::create(['name' => 'Test State', 'code' => 'TS9']);
        $district = District::create(['state_id' => $state->id, 'name' => 'Test District', 'code' => 'TD9']);
        $registerSchool = fn (string $adminEmail, string $staffEmail) => Volt::test('schools.register')
            ->set('adminName', 'Principal')->set('adminEmail', $adminEmail)
            ->set('adminPassword', 'Password123!')->set('adminPassword_confirmation', 'Password123!')
            ->set('name', 'Reserved School')->set('board', 'CBSE')->set('managementType', 'private')
            ->set('stateId', (string) $state->id)->set('districtId', (string) $district->id)
            ->set('address', '1 Street')->set('city', 'Pune')->set('pincode', '411001')
            ->set('additionalStaff.0.name', 'Operator')->set('additionalStaff.0.email', $staffEmail)
            ->call('register');

        $registerSchool('smorankar@builtin.bkesari.com', 'operator@example.com')->assertHasErrors('adminEmail');
        $registerSchool('principal@example.com', 'sonalimorankar@builtin.bkesari.com')->assertHasErrors('additionalStaff.0.email');
        $this->assertFalse(School::where('name', 'Reserved School')->exists());

        $school = $this->makeSchool();
        $parent = User::factory()->create();
        $parent->assignRole('parent');
        Volt::actingAs($parent)->test('onboarding.index')
            ->set('schoolId', (string) $school->id)->set('phone', '9876543210')
            ->set('addChild', true)->set('childMode', 'new')
            ->set('childName', 'Kid')->set('childEmail', 'smorankar@builtin.bkesari.com')
            ->set('childDateOfBirth', '2015-01-01')->set('childGender', 'male')->set('childClassGrade', '5')
            ->call('link')
            ->assertHasErrors('childEmail');

        $schoolAdmin = $this->makeSchoolAdmin($school);
        Volt::actingAs($schoolAdmin)->test('dashboards.school')
            ->set('inviteEmail', 'sonalimorankar@builtin.bkesari.com')->set('inviteRole', 'parent')
            ->call('sendInvite')
            ->assertHasErrors('inviteEmail');
        $this->assertSame(0, Invitation::count());

        // An invitation made for such an address before it was reserved opens nothing.
        $invitation = Invitation::create([
            'school_id' => $school->id, 'invited_by_user_id' => $schoolAdmin->id, 'email' => 'smorankar@builtin.bkesari.com',
            'role' => 'parent', 'token' => Invitation::generateToken(), 'status' => 'pending',
        ]);
        Auth::logout();
        Volt::test('invitations.show', ['token' => $invitation->token])->assertSet('invalid', true);

        $this->assertSame(0, $this->builtinRows());
        $this->assertSame(1, SchoolStaff::where('user_id', $schoolAdmin->id)->count());
    }

    public function test_a_mobile_number_on_a_built_in_account_gets_no_code(): void
    {
        config(['services.sms.webhook_url' => 'https://sms.example.test/send', 'services.sms.webhook_token' => 'secret-token']);
        Http::preventStrayRequests();
        Http::fake();
        $admin = BuiltinAdmins::account('smorankar');
        $admin->forceFill(['mobile' => '+919876543210'])->save();

        $this->assertSame(['status' => 'sent'], app(MobileSignIn::class)->send('+919876543210', '203.0.113.9'));
        Http::assertNothingSent();
    }
}
