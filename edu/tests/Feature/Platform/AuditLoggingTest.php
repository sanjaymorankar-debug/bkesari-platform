<?php

namespace Tests\Feature\Platform;

use App\Models\AuditLog;
use App\Models\Complaint;
use App\Models\ParentSchoolRelationship;
use App\Models\School;
use App\Models\SchoolFeedback;
use App\Models\SchoolRatingComponent;
use App\Models\SchoolStaff;
use App\Models\TeacherSchoolRelationship;
use App\Models\TwoFactorAuthentication;
use App\Models\User;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Livewire\Volt\Volt;
use PragmaRX\Google2FA\Google2FA;
use Tests\Feature\Platform\Concerns\AssertsAnonymityInvariants;
use Tests\Feature\Platform\Concerns\SetsUpPlatformData;
use Tests\TestCase;

/**
 * Spec section I — the general audit trail.
 *
 * Before this, `audit_logs` was written only by the admin settings screens,
 * so the platform's actual decisions left no trail there: an officer could
 * verify a school and a School Admin could reject a parent's link with
 * nothing recording who did it.
 *
 * The other half of these tests is the privacy boundary. Complaints and
 * feedback carry no `user_id` by design (see `AnonymizationTest`), so a
 * trail that recorded "user 7 filed complaint 3" would hand every System
 * Admin the deanonymisation table the whole design exists to prevent.
 * Submitter actions are therefore logged with no actor and no IP.
 */
class AuditLoggingTest extends TestCase
{
    use AssertsAnonymityInvariants, RefreshDatabase, SetsUpPlatformData;

    private function rowsFor(string $action): Collection
    {
        return AuditLog::where('action', $action)->get();
    }

    // ---------------------------------------------------------------- officials

    public function test_verifying_a_school_records_the_officer_on_the_school_and_in_the_trail(): void
    {
        $school = $this->makeSchool();
        $school->update(['recognition_status' => 'pending']);
        $officer = $this->makeDistrictOfficer($school);

        Volt::actingAs($officer)->test('dashboards.district')
            ->call('approveSchool', $school->id);

        $school->refresh();

        $this->assertSame('verified', $school->recognition_status);
        $this->assertSame($officer->id, $school->recognition_verified_by_user_id, 'the verifying officer must be on the record');
        $this->assertNotNull($school->recognition_verified_at);

        $row = $this->rowsFor('school.recognition_verified')->sole();
        $this->assertSame($officer->id, $row->user_id);
        $this->assertSame(School::class, $row->auditable_type);
        $this->assertSame($school->id, (int) $row->auditable_id);
    }

    public function test_an_officer_outside_the_district_verifies_nothing_and_logs_nothing(): void
    {
        $school = $this->makeSchool();
        $school->update(['recognition_status' => 'pending']);
        $otherSchool = $this->makeSchool();
        $outsider = $this->makeDistrictOfficer($otherSchool);

        Volt::actingAs($outsider)->test('dashboards.district')
            ->call('approveSchool', $school->id)
            ->assertForbidden();

        $this->assertSame('pending', $school->fresh()->recognition_status);
        $this->assertNull($school->fresh()->recognition_verified_by_user_id);
        $this->assertCount(0, $this->rowsFor('school.recognition_verified'));
    }

    public function test_approving_a_parent_link_records_who_approved_it(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);

        $parent = User::factory()->create();
        $parent->assignRole('parent');
        $relationship = ParentSchoolRelationship::create([
            'user_id' => $parent->id, 'school_id' => $school->id, 'status' => 'pending',
        ]);

        Volt::actingAs($admin)->test('dashboards.school')
            ->call('approveParent', $relationship->id);

        $relationship->refresh();

        $this->assertSame('verified', $relationship->status);
        $this->assertSame($admin->id, $relationship->decided_by_user_id);
        $this->assertNotNull($relationship->decided_at);
        $this->assertNotNull($relationship->verified_at, 'verified_at keeps its old meaning on approval');

        $row = $this->rowsFor('relationship.approved')->sole();
        $this->assertSame($admin->id, $row->user_id);
        $this->assertSame('parent', $row->metadata['role']);
    }

    /** A rejection previously left no trace at all — not even a timestamp. */
    public function test_rejecting_a_teacher_link_records_who_rejected_it(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);

        $teacher = User::factory()->create();
        $teacher->assignRole('teacher');
        $relationship = TeacherSchoolRelationship::create([
            'user_id' => $teacher->id, 'school_id' => $school->id, 'status' => 'pending',
        ]);

        Volt::actingAs($admin)->test('dashboards.school')
            ->call('rejectTeacher', $relationship->id);

        $relationship->refresh();

        $this->assertSame('rejected', $relationship->status);
        $this->assertSame($admin->id, $relationship->decided_by_user_id);
        $this->assertNotNull($relationship->decided_at);
        $this->assertNull($relationship->verified_at, 'a rejection must never look verified');

        $row = $this->rowsFor('relationship.rejected')->sole();
        $this->assertSame($admin->id, $row->user_id);
        $this->assertSame('teacher', $row->metadata['role']);
    }

    public function test_a_school_responding_to_a_complaint_is_logged_against_the_staff_member(): void
    {
        [$school, $complaint] = $this->submittedComplaint();
        $admin = $this->makeSchoolAdmin($school);

        Volt::actingAs($admin)->test('complaints.show', ['complaint' => $complaint])
            ->set('responseMessage', 'We have looked into this and the bus route has been changed.')
            ->call('respond');

        $row = $this->rowsFor('complaint.responded')->sole();
        $this->assertSame($admin->id, $row->user_id, 'staff act in an official capacity, so they are named');
        $this->assertSame($complaint->id, (int) $row->auditable_id);
    }

    public function test_enabling_and_disabling_two_factor_is_logged(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);

        $component = Volt::actingAs($admin)->test('settings.two-factor');
        $component->call('startSetup');

        $secret = TwoFactorAuthentication::where('user_id', $admin->id)->firstOrFail()->secret;
        $component->set('confirmCode', (new Google2FA)->getCurrentOtp($secret))
            ->call('confirm');

        $this->assertSame($admin->id, $this->rowsFor('two_factor.enabled')->sole()->user_id);

        $component->call('disable');

        $this->assertSame($admin->id, $this->rowsFor('two_factor.disabled')->sole()->user_id);
    }

    // ------------------------------------------------------------- anonymisation

    public function test_submitting_a_complaint_is_logged_without_actor_or_ip(): void
    {
        [, $complaint] = $this->submittedComplaint();

        $row = $this->rowsFor('complaint.submitted')->sole();

        $this->assertNull($row->user_id, 'logging the submitter would undo the anonymisation');
        $this->assertNull($row->ip_address, 'an IP next to a complaint id is a deanonymisation vector too');
        $this->assertSame($complaint->anonymous_ref, $row->metadata['anonymous_ref']);
        $this->assertSame($complaint->id, (int) $row->auditable_id);
    }

    public function test_confirming_a_resolution_is_logged_without_actor_or_ip(): void
    {
        [$school, $complaint, $submitter] = $this->submittedComplaint();
        $admin = $this->makeSchoolAdmin($school);

        Volt::actingAs($admin)->test('complaints.show', ['complaint' => $complaint])
            ->set('responseMessage', 'Resolved — the receipt has been issued.')
            ->call('markResolutionProposed');

        Volt::actingAs($submitter)->test('complaints.show', ['complaint' => $complaint->fresh()])
            ->set('confirmChoice', 'yes')
            ->call('confirmResolution');

        $row = $this->rowsFor('complaint.resolution_confirmed')->sole();

        $this->assertNull($row->user_id);
        $this->assertNull($row->ip_address);
        $this->assertSame('yes', $row->metadata['confirmation']);
    }

    public function test_submitting_school_feedback_is_logged_without_actor_or_ip(): void
    {
        SchoolRatingComponent::create(['key' => 'teaching_learning', 'label' => 'Teaching & Learning', 'weight' => 10]);
        $school = $this->makeSchool();
        $parent = $this->makeVerifiedParent($school);

        Volt::actingAs($parent)->test('feedback.create', ['school' => $school])
            ->set('scores.teaching_learning', 5)
            ->call('submit');

        $this->assertSame(1, SchoolFeedback::count());

        $row = $this->rowsFor('school_feedback.submitted')->sole();
        $this->assertNull($row->user_id);
        $this->assertNull($row->ip_address);
    }

    /**
     * The invariant, stated directly: nothing in the audit trail may name a
     * user alongside a complaint or a piece of feedback. If a future call
     * site reaches for `record()` where it should have used
     * `recordAnonymous()`, this is what should fail.
     */
    public function test_no_audit_row_ever_names_a_user_alongside_a_complaint_or_feedback(): void
    {
        [$school, $complaint, $submitter] = $this->submittedComplaint();
        $admin = $this->makeSchoolAdmin($school);

        Volt::actingAs($admin)->test('complaints.show', ['complaint' => $complaint])
            ->set('responseMessage', 'Looking into it now, thank you for the report.')
            ->call('respond');

        Volt::actingAs($admin)->test('complaints.show', ['complaint' => $complaint->fresh()])
            ->set('responseMessage', 'Now resolved.')
            ->call('markResolutionProposed');

        Volt::actingAs($submitter)->test('complaints.show', ['complaint' => $complaint->fresh()])
            ->set('confirmChoice', 'yes')
            ->call('confirmResolution');

        $submitterRows = AuditLog::whereIn('action', [
            'complaint.submitted',
            'complaint.resolution_confirmed',
            'school_feedback.submitted',
            'teacher_feedback.submitted',
            'retaliation_report.submitted',
            'appeal.filed',
        ])->get();

        $this->assertTrue($submitterRows->isNotEmpty(), 'the submitter-side actions must actually be logged');

        foreach ($submitterRows as $row) {
            $this->assertNull($row->user_id, "{$row->action} must not record an actor");
            $this->assertNull($row->ip_address, "{$row->action} must not record an IP");
        }

        // And the submitter is never the named actor on a complaint row.
        $this->assertSame(
            0,
            AuditLog::where('user_id', $submitter->id)->where('auditable_type', Complaint::class)->count(),
            'the submitter must never appear as the actor on their own complaint'
        );
    }

    /**
     * The invariant above, against the actor it was blind to.
     *
     * `test_no_audit_row_ever_names_a_user_alongside_a_complaint_or_feedback`
     * builds its fixture from two distinct users, so it never exercised one
     * person wearing both hats — a clerk or teacher whose own child attends
     * the school they work at, who is both a verified parent and
     * `school_staff`. For that actor the official-side calls
     * (`complaint.responded`, `complaint.resolution_proposed`) would have
     * written their id *and their IP* beside their own complaint, and
     * `/admin/audit-log` renders `actorLabel()`, so a System Admin would
     * have read the submitter's name next to `Complaint #N`.
     *
     * `ComplaintPolicy::respond()` now refuses the conflicted action
     * outright rather than dropping the id — dropping it would weaken the
     * attribution the trail exists for, and nobody should answer their own
     * complaint anyway. Another member of staff still can.
     */
    public function test_no_audit_row_names_a_dual_role_actor_beside_their_own_complaint(): void
    {
        $school = $this->makeSchool();
        $category = $this->makeCategory();

        // One person, both hats: verified parent at the school *and* staff there.
        $both = User::factory()->create();
        $both->assignRole('parent');
        $both->assignRole('school_admin');
        ParentSchoolRelationship::create([
            'user_id' => $both->id, 'school_id' => $school->id,
            'status' => 'verified', 'verified_at' => now(),
        ]);
        SchoolStaff::create(['user_id' => $both->id, 'school_id' => $school->id, 'designation' => 'Clerk']);

        Volt::actingAs($both)->test('complaints.create')
            ->set('schoolId', (string) $school->id)
            ->set('complaintCategoryId', (string) $category->id)
            ->set('subject', 'Staff room roof leaks onto the corridor')
            ->set('description', 'Water comes through the corridor ceiling whenever it rains heavily.')
            ->set('severity', 'medium')
            ->call('submit');

        $complaint = Complaint::firstOrFail();
        $this->assertTrue($complaint->isSubmitter($both->id));

        // They may not answer their own complaint, in either capacity.
        Volt::actingAs($both)->test('complaints.show', ['complaint' => $complaint])
            ->set('responseMessage', 'We have looked at this and the roof is scheduled.')
            ->call('respond')
            ->assertForbidden();

        Volt::actingAs($both)->test('complaints.show', ['complaint' => $complaint])
            ->set('responseMessage', 'Resolved.')
            ->call('markResolutionProposed')
            ->assertForbidden();

        $this->assertNoAuditRowLinksASubmitterToTheirOwnComplaint();

        // And a different staff member still can answer it.
        $colleague = $this->makeSchoolAdmin($school);

        Volt::actingAs($colleague)->test('complaints.show', ['complaint' => $complaint])
            ->set('responseMessage', 'Maintenance has been booked for the corridor ceiling.')
            ->call('respond');

        $row = $this->rowsFor('complaint.responded')->sole();
        $this->assertSame($colleague->id, $row->user_id);

        $this->assertNoAuditRowLinksASubmitterToTheirOwnComplaint();

        // `audit_logs` is one of ten relations that can carry this link; the
        // rest (responses, the timeline, appeals, identity access and the
        // safeguarding columns) are held by the same invariant.
        $this->assertNoRowNamesASubmitterBesideTheirOwnAnonymousRecord();
    }

    /**
     * The invariant stated as a query rather than per-action: no `audit_logs`
     * row may name a user who is the submitter behind the complaint that row
     * points at. Holds however the row was written.
     */
    private function assertNoAuditRowLinksASubmitterToTheirOwnComplaint(): void
    {
        $leaks = DB::table('audit_logs as l')
            ->join('complaints as c', function ($join) {
                $join->on('c.id', '=', 'l.auditable_id')
                    ->where('l.auditable_type', '=', Complaint::class);
            })
            ->join('anonymous_identities as a', function ($join) {
                $join->on('a.anonymous_ref', '=', 'c.anonymous_ref')
                    ->on('a.user_id', '=', 'l.user_id');
            })
            ->select('l.action', 'l.user_id', 'l.ip_address', 'c.id as complaint_id')
            ->get();

        $this->assertCount(
            0,
            $leaks,
            'audit_logs links a submitter to their own complaint: '.$leaks->pluck('action')->implode(', ')
        );
    }

    public function test_an_identity_reveal_names_the_officer_but_never_the_person_revealed(): void
    {
        [$school, $complaint, $submitter] = $this->submittedComplaint();
        $officer = $this->makeDistrictOfficer($school);

        Volt::actingAs($officer)->test('complaints.show', ['complaint' => $complaint])
            ->set('identityReason', 'Child safety escalation requires contacting the family directly.')
            ->call('revealIdentity');

        $row = $this->rowsFor('identity.revealed')->sole();

        $this->assertSame($officer->id, $row->user_id);
        $this->assertSame($complaint->anonymous_ref, $row->metadata['anonymous_ref']);
        $this->assertNotContains($submitter->id, $row->metadata, 'the resolved identity must not be written into the trail');
        $this->assertStringNotContainsString($submitter->email, json_encode($row->metadata));
    }

    /**
     * `SECURITY_PRIVACY.md` states it plainly: the attribution columns are
     * outside `$fillable` so that `School::markRecognitionVerified()` and
     * `RecordsVerificationDecision::recordDecision()` are the only ways to
     * set them, and "no mass-assigned update can forge a decision".
     *
     * Nothing asserted it — putting the four columns back into `$fillable`
     * left all 445 tests green — so a later edit widening `$fillable` (or a
     * school-profile edit screen, which does not exist yet) could hand a
     * school a government verification stamped with a real officer's id.
     * The same gap was already closed for UDISE by
     * `UdiseVerificationTest::test_verification_cannot_be_mass_assigned`.
     */
    public function test_a_verification_decision_cannot_be_forged_by_mass_assignment(): void
    {
        $school = $this->makeSchool();
        $officer = User::factory()->create();

        $school->update([
            'recognition_verified_at' => now(),
            'recognition_verified_by_user_id' => $officer->id,
        ]);
        $school->refresh();

        $this->assertNull($school->recognition_verified_at, 'a school must not be able to stamp its own verification');
        $this->assertNull(
            $school->recognition_verified_by_user_id,
            'a school must not be able to name the officer who supposedly verified it'
        );

        $parent = User::factory()->create();
        $parent->assignRole('parent');
        $relationship = ParentSchoolRelationship::create([
            'user_id' => $parent->id, 'school_id' => $school->id, 'status' => 'pending',
        ]);

        $relationship->update([
            'status' => 'verified',
            'decided_at' => now(),
            'decided_by_user_id' => $officer->id,
        ]);
        $relationship->refresh();

        $this->assertNull($relationship->decided_at, 'only recordDecision() may stamp a decision');
        $this->assertNull($relationship->decided_by_user_id, 'only recordDecision() may name the decider');
    }

    public function test_the_viewer_labels_an_anonymous_row_as_a_submitter_not_as_system(): void
    {
        [, $complaint] = $this->submittedComplaint();

        $row = $this->rowsFor('complaint.submitted')->sole();
        $this->assertSame('Submitter (anonymous)', $row->actorLabel());

        $systemRow = AuditLog::record('analytics.recalculated');
        $this->assertSame('System', $systemRow->actorLabel());
    }

    // -------------------------------------------------------------------- helper

    /** @return array{0: School, 1: Complaint, 2: User} */
    private function submittedComplaint(): array
    {
        $school = $this->makeSchool();
        $category = $this->makeCategory();
        $parent = $this->makeVerifiedParent($school);

        Volt::actingAs($parent)->test('complaints.create')
            ->set('schoolId', (string) $school->id)
            ->set('complaintCategoryId', (string) $category->id)
            ->set('subject', 'Fee receipt not issued')
            ->set('description', 'Paid the term fee two weeks ago and still no receipt has been issued.')
            ->set('severity', 'medium')
            ->call('submit');

        return [$school, Complaint::firstOrFail(), $parent];
    }
}
