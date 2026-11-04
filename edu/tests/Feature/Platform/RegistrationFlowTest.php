<?php

namespace Tests\Feature\Platform;

use App\Mail\StaffCredentialsMail;
use App\Models\District;
use App\Models\OfficerJurisdiction;
use App\Models\Invitation;
use App\Models\ParentSchoolRelationship;
use App\Models\School;
use App\Models\SchoolStaff;
use App\Models\User;
use Illuminate\Auth\Events\Registered;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Mail;
use Livewire\Volt\Volt;
use Tests\Feature\Platform\Concerns\SetsUpPlatformData;
use Tests\TestCase;

class RegistrationFlowTest extends TestCase
{
    use RefreshDatabase, SetsUpPlatformData;

    public function test_guest_can_register_a_school_and_becomes_its_admin(): void
    {
        $state = \App\Models\State::create(['name' => 'Test State', 'code' => 'TS1']);
        $district = District::create(['state_id' => $state->id, 'name' => 'Test District', 'code' => 'TD1']);

        Volt::test('schools.register')
            ->set('adminName', 'New Principal')
            ->set('adminEmail', 'newprincipal@example.com')
            ->set('adminPassword', 'Password123!')
            ->set('adminPassword_confirmation', 'Password123!')
            ->set('name', 'Brand New School')
            ->set('board', 'CBSE')
            ->set('managementType', 'private')
            ->set('stateId', (string) $state->id)
            ->set('districtId', (string) $district->id)
            ->set('address', '1 New Street')
            ->set('city', 'Testville')
            ->set('pincode', '123456')
            ->call('register');

        $school = School::where('name', 'Brand New School')->firstOrFail();
        $this->assertSame('pending', $school->recognition_status);

        $admin = User::where('email', 'newprincipal@example.com')->firstOrFail();
        $this->assertTrue($admin->hasRole('school_admin'));
        $this->assertTrue(SchoolStaff::where('user_id', $admin->id)->where('school_id', $school->id)->exists());
        $this->assertAuthenticatedAs($admin);
    }

    public function test_school_registration_creates_additional_staff_with_credentials(): void
    {
        $state = \App\Models\State::create(['name' => 'Test State', 'code' => 'TS2']);
        $district = District::create(['state_id' => $state->id, 'name' => 'Test District', 'code' => 'TD2']);

        $component = Volt::test('schools.register')
            ->set('adminName', 'Owner')
            ->set('adminEmail', 'owner@example.com')
            ->set('adminPassword', 'Password123!')
            ->set('adminPassword_confirmation', 'Password123!')
            ->set('name', 'Staffed School')
            ->set('board', 'CBSE')
            ->set('managementType', 'private')
            ->set('stateId', (string) $state->id)
            ->set('districtId', (string) $district->id)
            ->set('address', '1 New Street')
            ->set('city', 'Testville')
            ->set('pincode', '123456')
            ->set('additionalStaff.0.name', 'Op Erator')
            ->set('additionalStaff.0.email', 'operator@example.com')
            ->set('additionalStaff.0.designation', 'Operator')
            ->call('register');

        $operator = User::where('email', 'operator@example.com')->firstOrFail();
        $this->assertTrue($operator->hasRole('school_admin'));
        $component->assertSet('submitted', true);
    }

    public function test_parent_onboarding_creates_pending_relationship(): void
    {
        $school = $this->makeSchool();
        $parent = User::factory()->create();
        $parent->assignRole('parent');

        Volt::actingAs($parent)->test('onboarding.index')
            ->set('schoolId', (string) $school->id)
            ->set('phone', '9876543210')
            ->call('link');

        $this->assertDatabaseHas('parent_school_relationships', [
            'user_id' => $parent->id,
            'school_id' => $school->id,
            'status' => 'pending',
        ]);
    }

    public function test_school_admin_can_approve_pending_parent_relationship(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);

        $parent = User::factory()->create();
        $parent->assignRole('parent');
        $relationship = ParentSchoolRelationship::create([
            'user_id' => $parent->id,
            'school_id' => $school->id,
            'status' => 'pending',
        ]);

        Volt::actingAs($admin)->test('dashboards.school')
            ->call('approveParent', $relationship->id);

        $this->assertSame('verified', $relationship->fresh()->status);
    }

    public function test_school_admin_cannot_approve_relationship_for_another_school(): void
    {
        $schoolA = $this->makeSchool();
        $schoolB = $this->makeSchool();
        $adminOfA = $this->makeSchoolAdmin($schoolA);

        $parent = User::factory()->create();
        $parent->assignRole('parent');
        $relationship = ParentSchoolRelationship::create([
            'user_id' => $parent->id,
            'school_id' => $schoolB->id,
            'status' => 'pending',
        ]);

        Volt::actingAs($adminOfA)->test('dashboards.school')
            ->call('approveParent', $relationship->id)
            ->assertForbidden();

        $this->assertSame('pending', $relationship->fresh()->status);
    }

    /**
     * Verified standing at a school is what unlocks anonymous complaints,
     * feedback, teacher ratings and safeguarding reports about it. Every
     * dual-role refusal elsewhere — `ComplaintPolicy`'s respond/review, the
     * appeal screen's `canReview`, `SafeguardingService::canView` — assumes
     * somebody *else* granted that standing. A member of staff who could
     * approve their own request could self-grant it, which is why this is
     * the enabler for all of them rather than a tidiness rule.
     */
    public function test_school_admin_cannot_decide_their_own_relationship_request(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);
        $admin->assignRole('parent');

        // Their own child attends the school they work at, so they file the
        // link like any other parent (onboarding creates it `pending`).
        $own = ParentSchoolRelationship::create([
            'user_id' => $admin->id, 'school_id' => $school->id, 'status' => 'pending',
        ]);

        Volt::actingAs($admin)->test('dashboards.school')
            ->call('approveParent', $own->id)
            ->assertForbidden();

        Volt::actingAs($admin)->test('dashboards.school')
            ->call('rejectParent', $own->id)
            ->assertForbidden();

        $own->refresh();
        $this->assertSame('pending', $own->status);
        $this->assertNull($own->decided_by_user_id, 'no decision may be recorded against themselves');
        $this->assertNull($own->verified_at);
    }

    /** The escape hatch: a colleague decides it, so a genuine parent is not stranded. */
    public function test_a_colleague_can_decide_the_admins_own_request(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);
        $admin->assignRole('parent');
        $colleague = $this->makeSchoolAdmin($school);

        $own = ParentSchoolRelationship::create([
            'user_id' => $admin->id, 'school_id' => $school->id, 'status' => 'pending',
        ]);

        Volt::actingAs($colleague)->test('dashboards.school')
            ->call('approveParent', $own->id);

        $own->refresh();
        $this->assertSame('verified', $own->status);
        $this->assertSame($colleague->id, $own->decided_by_user_id);
    }

    /** The queue says so rather than offering buttons that would only 403. */
    public function test_the_queue_explains_that_a_colleague_must_decide_their_own_request(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);
        $admin->assignRole('parent');

        ParentSchoolRelationship::create([
            'user_id' => $admin->id, 'school_id' => $school->id, 'status' => 'pending',
        ]);

        Volt::actingAs($admin)->test('dashboards.school')
            ->assertOk()
            ->assertSee('another member of staff has to decide it');
    }

    /**
     * The other door to the same self-grant. A school-initiated invite is
     * pre-trusted: accepting it creates the relationship already `verified`,
     * with no approval step at all. So inviting yourself and accepting it
     * would hand you the standing the approval queue just refused.
     */
    public function test_a_school_admin_cannot_invite_their_own_address(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);

        Volt::actingAs($admin)->test('dashboards.school')
            ->set('inviteEmail', strtoupper($admin->email))   // case must not matter
            ->set('inviteRole', 'parent')
            ->call('sendInvite')
            ->assertHasErrors('inviteEmail');

        $this->assertSame(0, Invitation::count());
    }

    /**
     * Including a spelling only PostgreSQL's citext folds onto their own
     * address: `users.email` is citext, so `KİM@…` and `kim@…` are one
     * account there, and the guard has to lowercase the way citext does
     * (`EmailSignIn::normalize`) rather than with `strcasecmp`, which folds
     * ASCII only. The address that got through before ended in a duplicate-key
     * 500 at the acceptance instead of a refusal here.
     */
    public function test_the_self_invite_guard_lowercases_the_way_citext_does(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);
        $admin->forceFill(['email' => 'kim.head@example.com'])->save();

        Volt::actingAs($admin->fresh())->test('dashboards.school')
            ->set('inviteEmail', "K\u{0130}M.HEAD@example.com")   // dotted capital I
            ->set('inviteRole', 'parent')
            ->call('sendInvite')
            ->assertHasErrors('inviteEmail');

        $this->assertSame(0, Invitation::count());
    }

    /** And refused at the acceptance too, which is where the standing is minted. */
    public function test_a_school_admin_cannot_accept_an_invitation_they_sent_themselves(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);

        // Created directly: the sendInvite guard is bypassed on purpose, so
        // this proves the acceptance stands on its own.
        $invitation = Invitation::create([
            'school_id' => $school->id,
            'invited_by_user_id' => $admin->id,
            'email' => $admin->email,
            'role' => 'parent',
            'token' => Invitation::generateToken(),
            'status' => 'pending',
        ]);

        Volt::actingAs($admin)->test('invitations.show', ['token' => $invitation->token])
            ->call('accept')
            ->assertForbidden();

        $this->assertSame(0, ParentSchoolRelationship::where('user_id', $admin->id)->count(),
            'accepting your own invite must not mint a verified relationship');
        $this->assertSame('pending', $invitation->fresh()->status);
    }

    public function test_district_officer_can_verify_pending_school_in_jurisdiction(): void
    {
        $school = $this->makeSchool();
        $school->update(['recognition_status' => 'pending']);

        $officer = User::factory()->create();
        $officer->assignRole('district_officer');
        OfficerJurisdiction::create(['user_id' => $officer->id, 'level' => 'district', 'district_id' => $school->district_id]);

        Volt::actingAs($officer)->test('dashboards.district')
            ->call('approveSchool', $school->id);

        $this->assertSame('verified', $school->fresh()->recognition_status);
    }

    public function test_district_officer_cannot_verify_school_outside_jurisdiction(): void
    {
        $school = $this->makeSchool();
        $school->update(['recognition_status' => 'pending']);

        $otherSchool = $this->makeSchool();
        $officer = User::factory()->create();
        $officer->assignRole('district_officer');
        OfficerJurisdiction::create(['user_id' => $officer->id, 'level' => 'district', 'district_id' => $otherSchool->district_id]);

        Volt::actingAs($officer)->test('dashboards.district')
            ->call('approveSchool', $school->id)
            ->assertForbidden();

        $this->assertSame('pending', $school->fresh()->recognition_status);
    }

    /** Registers a school, signed out, with one additional staff row. */
    private function registerSchoolWithStaff(string $staffEmail)
    {
        $state = \App\Models\State::create(['name' => 'Test State', 'code' => 'TS3']);
        $district = District::create(['state_id' => $state->id, 'name' => 'Test District', 'code' => 'TD3']);

        return Volt::test('schools.register')
            ->set('adminName', 'Visitor')->set('adminEmail', 'visitor@example.com')
            ->set('adminPassword', 'Password123!')->set('adminPassword_confirmation', 'Password123!')
            ->set('name', 'Visitor School')->set('board', 'CBSE')->set('managementType', 'private')
            ->set('stateId', (string) $state->id)->set('districtId', (string) $district->id)
            ->set('address', '1 New Street')->set('city', 'Testville')->set('pincode', '123456')
            ->set('additionalStaff.0.name', 'Someone')->set('additionalStaff.0.email', $staffEmail)
            ->call('register');
    }

    public function test_school_registration_never_makes_an_existing_account_an_admin_of_the_school(): void
    {
        // Anyone can register a school; listing someone's address as staff
        // must not change their account (a system admin who is also a
        // school_admin sees only that school's complaints).
        Mail::fake();
        $sysadmin = User::factory()->create(['email' => 'root@example.com']);
        $sysadmin->assignRole('system_admin');

        $this->registerSchoolWithStaff('root@example.com')
            ->assertHasErrors(['additionalStaff.0.email' => 'unique'])
            ->assertSee('This email already has an account. Only people without an account can be added here.')
            ->assertSet('submitted', false);

        $this->assertSame(['system_admin'], $sysadmin->fresh()->getRoleNames()->all());
        $this->assertSame(0, SchoolStaff::where('user_id', $sysadmin->id)->count());
        $this->assertFalse(School::where('name', 'Visitor School')->exists());
        Mail::assertNotSent(StaffCredentialsMail::class);
    }

    public function test_an_account_made_while_the_school_is_registered_is_left_alone(): void
    {
        // The address had no account when the form was checked; one is made
        // before the staff rows are (here: as the registrant's own account is).
        Mail::fake();
        Event::listen(Registered::class, function (Registered $event) {
            if ($event->user->email === 'visitor@example.com') {
                User::factory()->create(['email' => 'late@example.com'])->assignRole('district_officer');
            }
        });

        $component = $this->registerSchoolWithStaff('late@example.com')->assertHasNoErrors()->assertSet('submitted', true);

        $late = User::where('email', 'late@example.com')->firstOrFail();
        $this->assertSame(['district_officer'], $late->getRoleNames()->all());
        $this->assertSame(0, SchoolStaff::where('user_id', $late->id)->count());
        $this->assertSame([], $component->get('generatedCredentials'), 'no temporary password is shown for it');
        Mail::assertNotSent(StaffCredentialsMail::class);
    }
}
