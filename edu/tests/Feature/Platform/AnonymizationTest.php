<?php

namespace Tests\Feature\Platform;

use App\Models\AnonymousIdentity;
use App\Models\Appeal;
use App\Models\AuditLog;
use App\Models\Complaint;
use App\Models\ComplaintStatusHistory;
use App\Models\IdentityAccessLog;
use App\Models\OfficerJurisdiction;
use App\Models\School;
use App\Models\SchoolStaff;
use App\Models\User;
use App\Services\IdentityResolutionService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Livewire\Volt\Volt;
use Tests\Feature\Platform\Concerns\SetsUpPlatformData;
use Tests\TestCase;

class AnonymizationTest extends TestCase
{
    use RefreshDatabase, SetsUpPlatformData;

    public function test_complaints_table_has_no_user_identifying_column(): void
    {
        $columns = Schema::getColumnListing('complaints');

        $this->assertNotContains('user_id', $columns);
        $this->assertNotContains('email', $columns);
        $this->assertNotContains('name', $columns);
        $this->assertContains('anonymous_ref', $columns);
    }

    public function test_school_feedback_table_has_no_user_identifying_column(): void
    {
        $columns = Schema::getColumnListing('school_feedback');

        $this->assertNotContains('user_id', $columns);
        $this->assertContains('anonymous_ref', $columns);
    }

    public function test_complaint_detail_view_never_renders_submitters_real_name_or_email_to_school_admin(): void
    {
        $school = $this->makeSchool();
        $category = $this->makeCategory();
        $parent = $this->makeVerifiedParent($school);
        $parent->update(['name' => 'Very Distinctive Real Name', 'email' => 'realparent@example.com']);
        $schoolAdmin = $this->makeSchoolAdmin($school);

        Volt::actingAs($parent)->test('complaints.create')
            ->set('schoolId', (string) $school->id)
            ->set('complaintCategoryId', (string) $category->id)
            ->set('subject', 'Privacy test complaint')
            ->set('description', 'This complaint description is long enough to pass validation checks.')
            ->call('submit');

        $complaint = \App\Models\Complaint::firstOrFail();

        $html = Volt::actingAs($schoolAdmin)->test('complaints.show', ['complaint' => $complaint])->html();

        $this->assertStringNotContainsString('Very Distinctive Real Name', $html);
        $this->assertStringNotContainsString('realparent@example.com', $html);
        $this->assertStringContainsString($complaint->anonymous_ref, $html);
    }

    public function test_identity_resolution_requires_permission(): void
    {
        $school = $this->makeSchool();
        $parent = $this->makeVerifiedParent($school);
        $ref = $parent->anonymousRefFor($school, 'parent');

        $schoolAdmin = $this->makeSchoolAdmin($school);
        $this->actingAs($schoolAdmin);

        $this->expectException(\Symfony\Component\HttpKernel\Exception\HttpException::class);
        app(IdentityResolutionService::class)->resolve($ref, 'test-resolve', 'test reason');
    }

    public function test_identity_resolution_requires_a_non_empty_reason(): void
    {
        $school = $this->makeSchool();
        $parent = $this->makeVerifiedParent($school);
        $ref = $parent->anonymousRefFor($school, 'parent');

        $officer = User::factory()->create();
        $officer->assignRole('district_officer');
        \App\Models\OfficerJurisdiction::create([
            'user_id' => $officer->id, 'level' => 'district', 'district_id' => $school->district_id,
        ]);
        $this->actingAs($officer);

        $this->expectException(\Illuminate\Validation\ValidationException::class);
        app(IdentityResolutionService::class)->resolve($ref, 'test-resolve', '   ');

        $this->assertSame(0, IdentityAccessLog::count());
    }

    public function test_identity_resolution_by_authorized_officer_logs_access(): void
    {
        $school = $this->makeSchool();
        $parent = $this->makeVerifiedParent($school);
        $ref = $parent->anonymousRefFor($school, 'parent');

        $officer = User::factory()->create();
        $officer->assignRole('district_officer');
        \App\Models\OfficerJurisdiction::create([
            'user_id' => $officer->id, 'level' => 'district', 'district_id' => $school->district_id,
        ]);
        $this->actingAs($officer);

        $resolved = app(IdentityResolutionService::class)->resolve($ref, 'investigation-review', 'Investigating safety complaint #123');

        $this->assertTrue($resolved->is($parent));
        $this->assertDatabaseHas('identity_access_logs', [
            'officer_user_id' => $officer->id,
            'anonymous_ref' => $ref,
            'action' => 'investigation-review',
        ]);
        $this->assertSame(1, IdentityAccessLog::count());
    }

    /**
     * The complaint timeline must not become the back door the rest of the
     * anonymisation design closes.
     *
     * `complaint_status_history.changed_by_user_id` sits beside
     * `complaint_id` in a table the school and every officer in the
     * jurisdiction can read. A submitter's id there links them to their own
     * complaint with none of the controls `IdentityResolutionService`
     * enforces — no permission, no reason, no `identity_access_logs` row.
     */
    public function test_a_submitters_confirmation_leaves_no_actor_on_the_timeline(): void
    {
        [$school, $complaint, $submitter] = $this->confirmedComplaint();

        $rows = ComplaintStatusHistory::where('complaint_id', $complaint->id)->get();

        $this->assertTrue($rows->isNotEmpty(), 'the transitions must actually be recorded');

        foreach ($rows as $row) {
            $this->assertNotSame(
                $submitter->id,
                $row->changed_by_user_id,
                "the {$row->to_status} row names the submitter"
            );
        }

        // The submitter's own confirmation is on the timeline, with no actor.
        $confirmation = $rows->firstWhere('note', 'Submitter confirmed: yes');
        $this->assertNotNull($confirmation, 'the confirmation must still be recorded');
        $this->assertNull($confirmation->changed_by_user_id);
    }

    /** The school's own transitions still name the staff member — that is the trail's purpose. */
    public function test_a_schools_transition_still_names_the_staff_member(): void
    {
        [$school, $complaint] = $this->confirmedComplaint();
        $staffIds = $school->staff()->pluck('user_id');

        $responded = ComplaintStatusHistory::where('complaint_id', $complaint->id)
            ->where('to_status', 'school_responded')->sole();

        $this->assertContains($responded->changed_by_user_id, $staffIds->all());
    }

    /**
     * Enforced in `recordStatusChange()`, not at the call sites — so a future
     * caller that reaches for `Auth::id()` on a submitter-driven transition
     * cannot reintroduce the link, the way the reason gate lives inside
     * `IdentityResolutionService` rather than in the form.
     */
    public function test_recording_a_transition_drops_a_submitter_id_even_when_one_is_passed(): void
    {
        $school = $this->makeSchool();
        $category = $this->makeCategory();
        $parent = $this->makeVerifiedParent($school);

        Volt::actingAs($parent)->test('complaints.create')
            ->set('schoolId', (string) $school->id)
            ->set('complaintCategoryId', (string) $category->id)
            ->set('subject', 'Chemistry lab has no running water')
            ->set('description', 'The lab tap has been dry all term and practicals go ahead anyway.')
            ->set('severity', 'high')
            ->call('submit');

        $complaint = Complaint::firstOrFail();

        $this->assertTrue($complaint->isSubmitter($parent->id));

        // A caller passing the submitter explicitly, as confirmResolution used to.
        $complaint->recordStatusChange('investigating', $parent->id, 'Submitter confirmed: partially');

        $row = ComplaintStatusHistory::where('complaint_id', $complaint->id)
            ->where('to_status', 'investigating')->sole();

        $this->assertNull($row->changed_by_user_id, 'a submitter id must be dropped at the chokepoint');
        $this->assertSame('Submitter confirmed: partially', $row->note, 'the note still says who acted');

        // A staff id passed the same way is kept.
        $admin = $this->makeSchoolAdmin($school);
        $complaint->recordStatusChange('action_taken', $admin->id, 'School proposed a fix.');

        $staffRow = ComplaintStatusHistory::where('complaint_id', $complaint->id)
            ->where('to_status', 'action_taken')->sole();

        $this->assertSame($admin->id, $staffRow->changed_by_user_id);
    }

    /**
     * The rows written before the chokepoint existed are cleared by
     * `2026_11_04_000001_clear_submitter_ids_from_complaint_status_history`,
     * which matches a row by resolving its user against its own complaint's
     * `anonymous_ref` — not by reading the note text, so a row counts as the
     * submitter's because the identity says so.
     */
    public function test_the_migration_clears_submitter_ids_already_on_the_timeline(): void
    {
        [$school, $complaint, $submitter] = $this->confirmedComplaint();
        $admin = $school->staff()->first()->user_id;

        // Put the pre-fix state back: a submitter-stamped row, as
        // confirmResolution used to write.
        $legacyId = DB::table('complaint_status_history')->insertGetId([
            'complaint_id' => $complaint->id,
            'from_status' => 'action_taken',
            'to_status' => 'resolved',
            'changed_by_user_id' => $submitter->id,
            'note' => 'Submitter confirmed: yes',
            'created_at' => now(),
        ]);

        $staffRowId = ComplaintStatusHistory::where('complaint_id', $complaint->id)
            ->where('to_status', 'school_responded')->sole()->id;

        $this->assertSame(
            $submitter->id,
            DB::table('complaint_status_history')->where('id', $legacyId)->value('changed_by_user_id')
        );

        (require database_path('migrations/2026_11_04_000001_clear_submitter_ids_from_complaint_status_history.php'))->up();

        $this->assertNull(
            DB::table('complaint_status_history')->where('id', $legacyId)->value('changed_by_user_id'),
            'the submitter-stamped row must be cleared'
        );
        $this->assertSame(
            $admin,
            DB::table('complaint_status_history')->where('id', $staffRowId)->value('changed_by_user_id'),
            'a staff row must survive — it is the point of the trail'
        );

        // Re-runnable: a second pass finds nothing left to clear and leaves
        // the staff row alone, so re-applying it on a database that already
        // has it (or running it twice by hand) is safe.
        (require database_path('migrations/2026_11_04_000001_clear_submitter_ids_from_complaint_status_history.php'))->up();

        $this->assertNull(
            DB::table('complaint_status_history')->where('id', $legacyId)->value('changed_by_user_id')
        );
        $this->assertSame(
            $admin,
            DB::table('complaint_status_history')->where('id', $staffRowId)->value('changed_by_user_id')
        );
    }

    /**
     * The chokepoint covers the timeline; the other writers on the official
     * side of a complaint are covered by refusing the conflicted action.
     *
     * One person can hold two hats — a clerk or teacher whose own child
     * attends the school they work at. Filing is fine; answering their own
     * complaint is not: `complaint_responses.responder_user_id` and the
     * `audit_logs` row (with the actor's IP) would both name them beside
     * their own complaint, in tables the school and every officer read.
     */
    public function test_a_staff_member_who_filed_a_complaint_cannot_answer_it_officially(): void
    {
        [$complaint, $user] = $this->complaintFiledByStaffMember();

        Volt::actingAs($user)->test('complaints.show', ['complaint' => $complaint])
            ->set('responseMessage', 'We have ordered a replacement railing.')
            ->call('respond')
            ->assertForbidden();

        Volt::actingAs($user)->test('complaints.show', ['complaint' => $complaint->fresh()])
            ->set('responseMessage', 'Fixed.')
            ->call('markResolutionProposed')
            ->assertForbidden();

        $this->assertSame(
            0,
            $complaint->responses()->where('responder_user_id', $user->id)->count(),
            'a response row must never name the submitter beside their own complaint'
        );

        $this->assertSame(
            0,
            AuditLog::where('auditable_type', Complaint::class)
                ->where('auditable_id', $complaint->id)
                ->where('user_id', $user->id)->count(),
            'no audit row may name the submitter alongside their own complaint (CR-22)'
        );

        // Another member of staff still answers it — the complaint is not stuck.
        $otherAdmin = $this->makeSchoolAdmin($complaint->school);

        Volt::actingAs($otherAdmin)->test('complaints.show', ['complaint' => $complaint->fresh()])
            ->set('responseMessage', 'We have ordered a replacement railing.')
            ->call('respond');

        $this->assertSame(1, $complaint->responses()->where('responder_user_id', $otherAdmin->id)->count());
    }

    /**
     * The officer route over a complaint is refused to its own submitter as
     * well: `revealIdentity` would write their id beside their own
     * `anonymous_ref` in `identity_access_logs`.
     */
    public function test_a_submitter_cannot_reveal_their_own_identity_through_the_officer_route(): void
    {
        $school = $this->makeSchool();
        $category = $this->makeCategory();

        $user = $this->makeVerifiedParent($school);
        $user->assignRole('district_officer');
        OfficerJurisdiction::create(['user_id' => $user->id, 'level' => 'district', 'district_id' => $school->district_id]);
        $user->refresh();

        $complaint = $this->fileComplaint($user, $school, $category, 'Staircase railing is loose');

        Volt::actingAs($user)->test('complaints.show', ['complaint' => $complaint])
            ->set('identityReason', 'Checking who filed this complaint.')
            ->call('revealIdentity')
            ->assertForbidden();

        $this->assertSame(0, IdentityAccessLog::count());
    }

    /** And one level up: an officer does not decide the appeal they filed themselves. */
    public function test_a_submitter_cannot_decide_their_own_appeal(): void
    {
        $school = $this->makeSchool();
        $category = $this->makeCategory();

        $user = $this->makeVerifiedParent($school);
        $user->assignRole('state_officer');
        OfficerJurisdiction::create(['user_id' => $user->id, 'level' => 'state', 'state_id' => $school->state_id]);
        $user->refresh();

        $complaint = $this->fileComplaint($user, $school, $category, 'Term fee charged twice');
        $complaint->update(['status' => 'escalated']);

        Volt::actingAs($user)->test('appeals.create', ['complaint' => $complaint->fresh()])
            ->set('reason', 'The duplicate charge was never looked at by anyone at all.')
            ->call('submit');

        $appeal = Appeal::firstOrFail();

        // Viewing their own appeal still works — only deciding it is refused.
        Volt::actingAs($user)->test('appeals.show', ['appeal' => $appeal])
            ->set('decisionNote', 'Upholding this appeal for a fresh look.')
            ->call('decide', 'upheld')
            ->assertForbidden();

        $appeal->refresh();

        $this->assertNull($appeal->reviewed_by_user_id, 'the appeal must not name its own submitter as reviewer');
        $this->assertSame('submitted', $appeal->status);
        $this->assertSame(
            0,
            AuditLog::where('action', 'appeal.decided')->where('user_id', $user->id)->count()
        );
    }

    /** @return array{0: Complaint, 1: User} */
    private function complaintFiledByStaffMember(): array
    {
        $school = $this->makeSchool();
        $category = $this->makeCategory();

        $user = $this->makeVerifiedParent($school);
        $user->assignRole('school_admin');
        SchoolStaff::create(['user_id' => $user->id, 'school_id' => $school->id, 'designation' => 'Clerk']);
        $user->refresh();

        return [$this->fileComplaint($user, $school, $category, 'Staircase railing is loose'), $user];
    }

    private function fileComplaint(User $user, School $school, $category, string $subject): Complaint
    {
        Volt::actingAs($user)->test('complaints.create')
            ->set('schoolId', (string) $school->id)
            ->set('complaintCategoryId', (string) $category->id)
            ->set('subject', $subject)
            ->set('description', 'This has been left unattended for several weeks and nothing has changed.')
            ->set('severity', 'high')
            ->call('submit');

        return Complaint::where('school_id', $school->id)->latest('id')->firstOrFail();
    }

    /** @return array{0: School, 1: Complaint, 2: User} */
    private function confirmedComplaint(): array
    {
        $school = $this->makeSchool();
        $category = $this->makeCategory();
        $parent = $this->makeVerifiedParent($school);
        $admin = $this->makeSchoolAdmin($school);

        Volt::actingAs($parent)->test('complaints.create')
            ->set('schoolId', (string) $school->id)
            ->set('complaintCategoryId', (string) $category->id)
            ->set('subject', 'Fee receipt not issued')
            ->set('description', 'Paid the term fee two weeks ago and still no receipt has been issued.')
            ->set('severity', 'medium')
            ->call('submit');

        $complaint = Complaint::firstOrFail();

        Volt::actingAs($admin)->test('complaints.show', ['complaint' => $complaint])
            ->set('responseMessage', 'We have located the payment and are issuing the receipt.')
            ->call('respond');

        Volt::actingAs($admin)->test('complaints.show', ['complaint' => $complaint->fresh()])
            ->set('responseMessage', 'Receipt issued.')
            ->call('markResolutionProposed');

        Volt::actingAs($parent)->test('complaints.show', ['complaint' => $complaint->fresh()])
            ->set('confirmChoice', 'yes')
            ->call('confirmResolution');

        return [$school, $complaint->fresh(), $parent];
    }

    public function test_anonymous_ref_is_stable_across_multiple_submissions_by_same_user(): void
    {
        $school = $this->makeSchool();
        $parent = $this->makeVerifiedParent($school);

        $ref1 = $parent->anonymousRefFor($school, 'parent');
        $ref2 = $parent->anonymousRefFor($school, 'parent');

        $this->assertSame($ref1, $ref2);
        $this->assertSame(1, AnonymousIdentity::count());
    }
}
