<?php

namespace Tests\Feature\Platform;

use App\Models\AuditLog;
use App\Models\Invitation;
use App\Models\ParentSchoolRelationship;
use App\Models\StudentSchoolRelationship;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Livewire\Volt\Volt;
use Tests\Feature\Platform\Concerns\SetsUpPlatformData;
use Tests\TestCase;

class ParentChildAndInvitationTest extends TestCase
{
    use RefreshDatabase, SetsUpPlatformData;

    public function test_parent_can_register_with_a_new_child_during_onboarding(): void
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
            ->set('childEmail', 'kidone@example.com')
            ->set('childDateOfBirth', '2015-01-01')
            ->set('childGender', 'male')
            ->set('childClassGrade', '5')
            ->call('link');

        $child = User::where('email', 'kidone@example.com')->firstOrFail();
        $this->assertTrue($child->hasRole('student'));

        $this->assertTrue(StudentSchoolRelationship::where('user_id', $child->id)->where('school_id', $school->id)->where('status', 'pending')->exists());

        $parentRelation = ParentSchoolRelationship::where('user_id', $parent->id)->where('school_id', $school->id)->firstOrFail();
        $this->assertSame($child->id, $parentRelation->student_user_id);
    }

    public function test_parent_can_link_to_an_existing_child_account(): void
    {
        $school = $this->makeSchool();
        $parent = User::factory()->create();
        $parent->assignRole('parent');

        $child = User::factory()->create(['email' => 'existingkid@example.com']);
        $child->assignRole('student');

        Volt::actingAs($parent)->test('onboarding.index')
            ->set('schoolId', (string) $school->id)
            ->set('phone', '9876543210')
            ->set('addChild', true)
            ->set('childMode', 'existing')
            ->set('childEmail', 'existingkid@example.com')
            ->call('link');

        $parentRelation = ParentSchoolRelationship::where('user_id', $parent->id)->where('school_id', $school->id)->firstOrFail();
        $this->assertSame($child->id, $parentRelation->student_user_id);
        $this->assertTrue(StudentSchoolRelationship::where('user_id', $child->id)->where('school_id', $school->id)->exists());
    }

    public function test_parent_cannot_link_a_non_student_account_as_child(): void
    {
        $school = $this->makeSchool();
        $parent = User::factory()->create();
        $parent->assignRole('parent');

        $otherUser = User::factory()->create(['email' => 'notastudent@example.com']);
        $otherUser->assignRole('teacher');

        Volt::actingAs($parent)->test('onboarding.index')
            ->set('schoolId', (string) $school->id)
            ->set('phone', '9876543210')
            ->set('addChild', true)
            ->set('childMode', 'existing')
            ->set('childEmail', 'notastudent@example.com')
            ->call('link')
            ->assertStatus(422);
    }

    public function test_school_admin_can_send_invitation(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);

        Volt::actingAs($admin)->test('dashboards.school')
            ->set('inviteEmail', 'invitedparent@example.com')
            ->set('inviteRole', 'parent')
            ->set('inviteStudentName', 'Jane Doe')
            ->call('sendInvite');

        $this->assertDatabaseHas('invitations', [
            'school_id' => $school->id,
            'email' => 'invitedparent@example.com',
            'role' => 'parent',
            'status' => 'pending',
        ]);
    }

    public function test_guest_can_accept_invitation_and_gets_verified_immediately(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);

        $invitation = Invitation::create([
            'school_id' => $school->id,
            'invited_by_user_id' => $admin->id,
            'email' => 'newparent@example.com',
            'role' => 'parent',
            'token' => Invitation::generateToken(),
            'status' => 'pending',
        ]);

        Volt::test('invitations.show', ['token' => $invitation->token])
            ->set('name', 'New Parent')
            ->set('password', 'Password123!')
            ->set('password_confirmation', 'Password123!')
            ->call('accept');

        $user = User::where('email', 'newparent@example.com')->firstOrFail();
        $this->assertTrue($user->hasRole('parent'));

        $relation = ParentSchoolRelationship::where('user_id', $user->id)->where('school_id', $school->id)->firstOrFail();
        $this->assertSame('verified', $relation->status);

        $this->assertSame('accepted', $invitation->fresh()->status);
        $this->assertSame($user->id, $invitation->fresh()->accepted_by_user_id);
    }

    public function test_authenticated_user_can_accept_invitation_sent_to_their_email(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);
        $teacher = User::factory()->create(['email' => 'existingteacher@example.com']);

        $invitation = Invitation::create([
            'school_id' => $school->id,
            'invited_by_user_id' => $admin->id,
            'email' => 'existingteacher@example.com',
            'role' => 'teacher',
            'token' => Invitation::generateToken(),
            'status' => 'pending',
        ]);

        Volt::actingAs($teacher)->test('invitations.show', ['token' => $invitation->token])
            ->call('accept');

        $this->assertTrue($teacher->fresh()->hasRole('teacher'));
        $this->assertDatabaseHas('teacher_school_relationships', [
            'user_id' => $teacher->id,
            'school_id' => $school->id,
            'status' => 'verified',
        ]);
    }

    public function test_authenticated_user_with_different_email_cannot_accept_invitation(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);
        $wrongUser = User::factory()->create(['email' => 'wrongperson@example.com']);

        $invitation = Invitation::create([
            'school_id' => $school->id,
            'invited_by_user_id' => $admin->id,
            'email' => 'intended@example.com',
            'role' => 'parent',
            'token' => Invitation::generateToken(),
            'status' => 'pending',
        ]);

        Volt::actingAs($wrongUser)->test('invitations.show', ['token' => $invitation->token])
            ->call('accept')
            ->assertForbidden();

        $this->assertSame('pending', $invitation->fresh()->status);
    }

    public function test_revoked_or_invalid_invitation_shows_invalid_state(): void
    {
        Volt::test('invitations.show', ['token' => 'does-not-exist'])
            ->assertSet('invalid', true);
    }

    /**
     * Accepting an invite mints `verified` standing with no approval step, so
     * the school's revocation has to hold at the acceptance itself. `mount()`
     * runs once: the invitee's page can have been open since before the
     * revocation, and Livewire re-hydrates the model without re-running it.
     * Before the status re-check the open page still granted the standing the
     * school had just withdrawn.
     */
    public function test_a_revoked_invitation_cannot_be_accepted_from_an_open_page(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);
        $parent = User::factory()->create(['email' => 'openpage@example.com']);
        $parent->assignRole('parent');

        $invitation = Invitation::create([
            'school_id' => $school->id,
            'invited_by_user_id' => $admin->id,
            'email' => 'openpage@example.com',
            'role' => 'parent',
            'token' => Invitation::generateToken(),
            'status' => 'pending',
        ]);

        // The invitee has the page open ...
        $page = Volt::actingAs($parent)->test('invitations.show', ['token' => $invitation->token]);

        // ... and the school revokes the invitation meanwhile.
        $invitation->update(['status' => 'revoked']);

        $page->call('accept')->assertForbidden();

        $this->assertSame('revoked', $invitation->fresh()->status);
        $this->assertSame(0, ParentSchoolRelationship::where('user_id', $parent->id)->count(),
            'a revoked invitation must not mint verified standing');
    }

    /** And a guest on a revoked invitation gets no account out of it either. */
    public function test_a_guest_cannot_make_an_account_on_a_revoked_invitation(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);

        $invitation = Invitation::create([
            'school_id' => $school->id,
            'invited_by_user_id' => $admin->id,
            'email' => 'guestopen@example.com',
            'role' => 'parent',
            'token' => Invitation::generateToken(),
            'status' => 'pending',
        ]);

        $page = Volt::test('invitations.show', ['token' => $invitation->token])
            ->set('name', 'Guest Parent')
            ->set('password', 'Password123!')
            ->set('password_confirmation', 'Password123!');

        $invitation->update(['status' => 'revoked']);

        $page->call('accept')->assertForbidden();

        $this->assertNull(User::where('email', 'guestopen@example.com')->first());
        $this->assertSame(0, ParentSchoolRelationship::count());
    }

    /** One acceptance, one audit row and one notification, however often it is clicked. */
    public function test_accepting_an_invitation_twice_records_it_once(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);
        $parent = User::factory()->create(['email' => 'twice@example.com']);
        $parent->assignRole('parent');

        $invitation = Invitation::create([
            'school_id' => $school->id,
            'invited_by_user_id' => $admin->id,
            'email' => 'twice@example.com',
            'role' => 'parent',
            'token' => Invitation::generateToken(),
            'status' => 'pending',
        ]);

        $page = Volt::actingAs($parent)->test('invitations.show', ['token' => $invitation->token]);
        $page->call('accept');
        $page->call('accept')->assertForbidden();

        $this->assertSame(1, ParentSchoolRelationship::where('user_id', $parent->id)->count());
        $this->assertSame(1, AuditLog::where('action', 'invitation.accepted')->count(),
            'the acceptance is recorded once, not once per click');
    }

    /**
     * Deleting the inviter cascades the invitation away (the column is NOT
     * NULL, ON DELETE CASCADE), so the token is dead: the page says so and
     * the action refuses rather than failing on an unset property.
     */
    public function test_an_invitation_whose_inviter_was_deleted_is_dead_not_fatal(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);
        $parent = User::factory()->create(['email' => 'orphaned@example.com']);
        $parent->assignRole('parent');

        $invitation = Invitation::create([
            'school_id' => $school->id,
            'invited_by_user_id' => $admin->id,
            'email' => 'orphaned@example.com',
            'role' => 'parent',
            'token' => Invitation::generateToken(),
            'status' => 'pending',
        ]);
        $token = $invitation->token;

        $admin->delete();
        $this->assertNull($invitation->fresh(), 'the invitation goes with its inviter');

        Volt::actingAs($parent)->test('invitations.show', ['token' => $token])
            ->assertSet('invalid', true)
            ->call('accept')->assertForbidden();

        $this->assertSame(0, ParentSchoolRelationship::count());
    }

    /**
     * The address the school typed and the address on the account are one
     * identity when they differ only in case — PostgreSQL's citext column
     * compares them that way and `EmailSignIn` signs people in that way — so
     * a genuine invitee must not be turned away for the spelling.
     */
    public function test_an_invitee_whose_account_differs_only_in_case_can_accept(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);
        $parent = User::factory()->create(['email' => 'mixedcase@example.com']);
        $parent->assignRole('parent');

        $invitation = Invitation::create([
            'school_id' => $school->id,
            'invited_by_user_id' => $admin->id,
            'email' => 'MixedCase@Example.com',
            'role' => 'parent',
            'token' => Invitation::generateToken(),
            'status' => 'pending',
        ]);

        Volt::actingAs($parent)->test('invitations.show', ['token' => $invitation->token])
            ->call('accept');

        $this->assertDatabaseHas('parent_school_relationships', [
            'user_id' => $parent->id,
            'school_id' => $school->id,
            'status' => 'verified',
        ]);
        $this->assertSame('accepted', $invitation->fresh()->status);
    }

    public function test_school_admin_can_revoke_pending_invitation(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);

        $invitation = Invitation::create([
            'school_id' => $school->id,
            'invited_by_user_id' => $admin->id,
            'email' => 'toberevoked@example.com',
            'role' => 'parent',
            'token' => Invitation::generateToken(),
            'status' => 'pending',
        ]);

        Volt::actingAs($admin)->test('dashboards.school')
            ->call('revokeInvite', $invitation->id);

        $this->assertSame('revoked', $invitation->fresh()->status);
    }

    public function test_school_admin_cannot_revoke_another_schools_invitation(): void
    {
        $schoolA = $this->makeSchool();
        $schoolB = $this->makeSchool();
        $adminOfA = $this->makeSchoolAdmin($schoolA);
        $adminOfB = $this->makeSchoolAdmin($schoolB);

        $invitation = Invitation::create([
            'school_id' => $schoolB->id,
            'invited_by_user_id' => $adminOfB->id,
            'email' => 'someone@example.com',
            'role' => 'parent',
            'token' => Invitation::generateToken(),
            'status' => 'pending',
        ]);

        Volt::actingAs($adminOfA)->test('dashboards.school')
            ->call('revokeInvite', $invitation->id)
            ->assertForbidden();

        $this->assertSame('pending', $invitation->fresh()->status);
    }
}
