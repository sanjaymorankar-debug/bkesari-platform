<?php

namespace Tests\Feature\Platform;

use App\Models\User;
use App\Rules\NotReservedEmail;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Livewire\Volt\Volt;
use Tests\Feature\Platform\Concerns\SetsUpPlatformData;
use Tests\TestCase;

/**
 * The hub's built-in administrators sign in as <name>@builtin.bkesari.com, and
 * HubSignIn never links one to an account someone else made with that address.
 * So no form may give an account, a child, a staff member or an invitation one:
 * it would lock the administrator out of Education (edu-tester D3).
 */
class ReservedEmailTest extends TestCase
{
    use RefreshDatabase, SetsUpPlatformData;

    private const RESERVED = ['smorankar@builtin.bkesari.com', 'SonaliMorankar@Builtin.Bkesari.COM', 'anyone@builtin.bkesari.com'];

    public function test_the_rule_knows_the_reserved_domain_however_it_is_typed(): void
    {
        foreach (self::RESERVED as $email) {
            $this->assertTrue(NotReservedEmail::isReserved($email), $email);
        }
        foreach (['smorankar@bkesari.com', 'smorankar@builtin.bkesari.com.example', 'builtin.bkesari.com@example.com', null] as $email) {
            $this->assertFalse(NotReservedEmail::isReserved($email), (string) $email);
        }
    }

    public function test_registration_refuses_a_reserved_address(): void
    {
        foreach (self::RESERVED as $email) {
            Volt::test('pages.auth.register')
                ->set('name', 'Squatter')
                ->set('email', strtolower($email))
                ->set('password', 'password')
                ->set('password_confirmation', 'password')
                ->call('register')
                ->assertHasErrors(['email']);
        }
        $this->assertGuest();
        $this->assertSame(0, User::where('email', 'like', '%@builtin.bkesari.com')->count());
    }

    public function test_a_profile_cannot_take_a_reserved_address(): void
    {
        $user = User::factory()->create(['email' => 'asha@example.com']);
        $this->actingAs($user);

        Volt::test('profile.update-profile-information-form')
            ->set('name', $user->name)
            ->set('email', 'sonalimorankar@builtin.bkesari.com')
            ->call('updateProfileInformation')
            ->assertHasErrors(['email']);

        $this->assertSame('asha@example.com', $user->fresh()->email);
    }

    public function test_a_school_cannot_invite_a_reserved_address(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);

        Volt::actingAs($admin)->test('dashboards.school')
            ->set('inviteEmail', 'smorankar@builtin.bkesari.com')
            ->set('inviteRole', 'parent')
            ->call('sendInvite')
            ->assertHasErrors(['inviteEmail']);

        $this->assertDatabaseMissing('invitations', ['email' => 'smorankar@builtin.bkesari.com']);
    }

    public function test_a_parent_cannot_add_a_child_with_a_reserved_address(): void
    {
        $school = $this->makeSchool();
        $parent = User::factory()->create();
        $parent->assignRole('parent');

        Volt::actingAs($parent)->test('onboarding.index')
            ->set('schoolId', (string) $school->id)
            ->set('phone', '9876543210')
            ->set('addChild', true)
            ->set('childMode', 'new')
            ->set('childName', 'Kid One')
            ->set('childEmail', 'sonalimorankar@builtin.bkesari.com')
            ->set('childDateOfBirth', '2015-01-01')
            ->set('childGender', 'male')
            ->set('childClassGrade', '5')
            ->call('link')
            ->assertHasErrors(['childEmail']);

        $this->assertNull(User::where('email', 'sonalimorankar@builtin.bkesari.com')->first());
    }
}
