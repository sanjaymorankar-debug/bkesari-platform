<?php

namespace Tests\Feature\Platform;

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
