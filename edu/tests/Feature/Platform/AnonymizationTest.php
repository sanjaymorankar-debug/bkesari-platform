<?php

namespace Tests\Feature\Platform;

use App\Models\AnonymousIdentity;
use App\Models\Appeal;
use App\Models\AuditLog;
use App\Models\Complaint;
use App\Models\ComplaintResponse;
use App\Models\ComplaintStatusHistory;
use App\Models\IdentityAccessLog;
use App\Models\OfficerJurisdiction;
use App\Models\SafeguardingEvent;
use App\Models\SafeguardingReport;
use App\Models\School;
use App\Models\SchoolStaff;
use App\Models\User;
use App\Services\IdentityResolutionService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Livewire\Volt\Volt;
use PHPUnit\Framework\AssertionFailedError;
use Tests\Feature\Platform\Concerns\AssertsAnonymityInvariants;
use Tests\Feature\Platform\Concerns\SetsUpPlatformData;
use Tests\TestCase;

class AnonymizationTest extends TestCase
{
    use AssertsAnonymityInvariants, RefreshDatabase, SetsUpPlatformData;

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

        $this->assertNoRowNamesASubmitterBesideTheirOwnAnonymousRecord();
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

        $this->assertNoRowNamesASubmitterBesideTheirOwnAnonymousRecord();
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

        $this->assertNoRowNamesASubmitterBesideTheirOwnAnonymousRecord();
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
    /**
     * The invariant above, proved to actually detect each link it claims to
     * cover. A blanket query is only worth what its joins are: one wrong
     * column name and it passes every run while the leak it exists to catch
     * sits in the table. So each of the ten relations is planted with a row
     * that *is* the leak, and the invariant must trip for every one.
     *
     * This is what the per-action tests cannot give: they cover the writers
     * that exist today.
     */
    public function test_the_submitter_link_invariant_detects_a_leak_in_every_relation_it_covers(): void
    {
        // Push the user ids well clear of the record ids first. Without this
        // the submitter is user 1 and the planted records are row 1, so a
        // join wired to the wrong column (`a.user_id = e.<some other id>`)
        // still matches by coincidence and the relation looks covered when it
        // is not — which is exactly the failure this test exists to catch.
        User::factory()->count(30)->create();

        [$school, $complaint, $submitter] = $this->confirmedComplaint();
        $this->assertGreaterThan(20, $submitter->id);

        $appeal = Appeal::create([
            'complaint_id' => $complaint->id,
            'district_id' => $complaint->district_id,
            'state_id' => $complaint->state_id,
            'anonymous_ref' => $complaint->anonymous_ref,
            'reason' => 'The school never addressed the substance of the complaint.',
            'status' => 'submitted',
        ]);

        $report = SafeguardingReport::create([
            'reference' => SafeguardingReport::generateReference(),
            'school_id' => $school->id,
            'district_id' => $school->district_id,
            'state_id' => $school->state_id,
            'anonymous_ref' => $complaint->anonymous_ref,
            'reporter_role' => 'parent',
            'category' => 'child_sexual_abuse',
            'description' => 'A detailed account of the concern, long enough to be actionable.',
        ]);

        // Clean to start with: nothing in this fixture names the submitter.
        $this->assertNoRowNamesASubmitterBesideTheirOwnAnonymousRecord();

        $id = $submitter->id;

        $plant = [
            'complaint_responses.responder_user_id' => fn () => ComplaintResponse::create([
                'complaint_id' => $complaint->id, 'responder_type' => 'school',
                'responder_user_id' => $id, 'message' => 'Answered by the person who filed it.',
            ]),
            'complaint_status_history.changed_by_user_id' => fn () => ComplaintStatusHistory::create([
                'complaint_id' => $complaint->id, 'from_status' => 'submitted',
                'to_status' => 'investigating', 'changed_by_user_id' => $id,
            ]),
            'identity_access_logs.officer_user_id' => fn () => IdentityAccessLog::create([
                'officer_user_id' => $id, 'anonymous_ref' => $complaint->anonymous_ref,
                'action' => 'complaint-identity-reveal', 'reason' => 'Revealed my own identity to myself.',
            ]),
            'appeals.reviewed_by_user_id' => fn () => $appeal->forceFill(['reviewed_by_user_id' => $id])->save(),
            'audit_logs -> complaints' => fn () => AuditLog::create([
                'user_id' => $id, 'action' => 'complaint.responded',
                'auditable_type' => Complaint::class, 'auditable_id' => $complaint->id,
            ]),
            'audit_logs -> appeals' => fn () => AuditLog::create([
                'user_id' => $id, 'action' => 'appeal.decided',
                'auditable_type' => Appeal::class, 'auditable_id' => $appeal->id,
            ]),
            'safeguarding_reports.assigned_officer_user_id' => fn () => $report->forceFill(['assigned_officer_user_id' => $id])->save(),
            'safeguarding_reports.external_report_acknowledged_by' => fn () => $report->forceFill(['external_report_acknowledged_by' => $id])->save(),
            'safeguarding_reports.closed_by_user_id' => fn () => $report->forceFill(['closed_by_user_id' => $id])->save(),
            'safeguarding_events.actor_user_id' => fn () => SafeguardingEvent::create([
                'safeguarding_report_id' => $report->id, 'event_type' => 'viewed',
                'actor_user_id' => $id, 'occurred_at' => now(),
            ]),
        ];

        foreach ($plant as $relation => $makeLeak) {
            $makeLeak();

            try {
                $this->assertNoRowNamesASubmitterBesideTheirOwnAnonymousRecord();
                $this->fail('the invariant missed a planted leak in '.$relation);
            } catch (AssertionFailedError $e) {
                $this->assertStringContainsString($relation, $e->getMessage());

                // And nothing else tripped: one planted row, one relation, so
                // no join is quietly matching rows it has no business in.
                $this->assertSame(
                    1,
                    substr_count($e->getMessage(), ' (user '),
                    'one planted leak must trip exactly one relation: '.$e->getMessage()
                );
            }

            // Put it back, so each relation is proved on its own.
            match (true) {
                str_starts_with($relation, 'complaint_responses') => ComplaintResponse::query()->delete(),
                str_starts_with($relation, 'complaint_status_history') => ComplaintStatusHistory::query()->delete(),
                str_starts_with($relation, 'identity_access_logs') => IdentityAccessLog::query()->delete(),
                str_starts_with($relation, 'appeals') => $appeal->forceFill(['reviewed_by_user_id' => null])->save(),
                str_starts_with($relation, 'audit_logs') => AuditLog::query()->delete(),
                str_starts_with($relation, 'safeguarding_events') => SafeguardingEvent::query()->delete(),
                default => $report->forceFill([
                    'assigned_officer_user_id' => null,
                    'external_report_acknowledged_by' => null,
                    'closed_by_user_id' => null,
                ])->save(),
            };

            $this->assertNoRowNamesASubmitterBesideTheirOwnAnonymousRecord();
        }
    }

    /**
     * A staff member who filed a safeguarding report at their own school
     * cannot handle it — the same two-hats rule as a complaint, on the
     * table that holds the platform's most sensitive records. The behaviour
     * is covered in detail by `SafeguardingTest`; this states it through
     * CR-04's own invariant, which is where a new writer would be caught.
     */
    public function test_a_reporter_who_is_also_an_officer_leaves_no_link_on_their_safeguarding_case(): void
    {
        $school = $this->makeSchool();
        $officer = User::factory()->create();
        $officer->assignRole('child_safety_officer');
        SchoolStaff::create([
            'user_id' => $officer->id, 'school_id' => $school->id,
            'designation' => 'Child Safety Officer',
        ]);

        Volt::actingAs($officer)->test('safeguarding.report', ['school' => $school])
            ->set('category', 'child_sexual_abuse')
            ->set('description', 'A detailed account of the concern, long enough to be actionable.')
            ->set('understoodLegalDuty', true)
            ->call('submit');

        $report = SafeguardingReport::firstOrFail();
        $this->assertTrue(
            AnonymousIdentity::where('user_id', $officer->id)
                ->where('anonymous_ref', $report->anonymous_ref)->exists()
        );

        // Every official route on the case, and opening it at all.
        Volt::actingAs($officer)->test('safeguarding.show', ['report' => $report])->assertForbidden();

        $service = app(\App\Services\SafeguardingService::class);
        $this->assertFalse($service->canView($officer, $report));
        $this->assertFalse($service->canManage($officer, $report));

        $this->assertNoRowNamesASubmitterBesideTheirOwnAnonymousRecord();
    }
    /**
     * `system_admin` is the role the hub's built-in administrators are given
     * (`HubSignIn::BUILTIN_ADMINS`), and it holds **every** permission the
     * seeder defines — `respond-to-complaint`, `access-protected-identity`,
     * `handle-safeguarding-cases` and the rest. It also passes the final
     * `hasAnyRole([...])` branch of `ComplaintPolicy::review()`,
     * `appeals/show.blade.php::canReview()` and
     * `SafeguardingService::canView()`. Nothing stops such an account also
     * being a verified parent somewhere: a school registration, a profile
     * edit or an ordinary sign-up can attach any address, and the role is
     * granted on the `sub` of a hub token, not on the absence of a parent
     * relationship.
     *
     * So the self-dealing refusals have to come *before* those role branches,
     * not after them. This is the test that says so.
     */
    public function test_a_builtin_system_admin_who_is_also_a_submitter_is_refused_on_every_official_path(): void
    {
        $school = $this->makeSchool();
        $category = $this->makeCategory();

        $user = $this->makeVerifiedParent($school);
        $user->assignRole('system_admin');
        // Exactly what the hub mints for a built-in administrator.
        $user->forceFill(['hub_user_id' => 'builtin:smorankar'])->save();
        $user->refresh();

        $this->assertTrue($user->can('respond-to-complaint'));
        $this->assertTrue($user->can('access-protected-identity'));
        $this->assertTrue($user->can('handle-safeguarding-cases'));

        $complaint = $this->fileComplaint($user, $school, $category, 'Fee receipt never issued');

        // Responding to, and revealing the identity behind, their own complaint.
        Volt::actingAs($user)->test('complaints.show', ['complaint' => $complaint])
            ->set('responseMessage', 'Looked at it myself, all fine.')
            ->call('respond')
            ->assertForbidden();

        Volt::actingAs($user)->test('complaints.show', ['complaint' => $complaint->fresh()])
            ->set('identityReason', 'Confirming who filed this complaint.')
            ->call('revealIdentity')
            ->assertForbidden();

        // Deciding their own appeal.
        $complaint->update(['status' => 'escalated']);

        Volt::actingAs($user)->test('appeals.create', ['complaint' => $complaint->fresh()])
            ->set('reason', 'Nobody at the school ever looked at the missing receipt.')
            ->call('submit');

        $appeal = Appeal::firstOrFail();

        Volt::actingAs($user)->test('appeals.show', ['appeal' => $appeal])
            ->set('decisionNote', 'Upholding my own appeal.')
            ->call('decide', 'upheld')
            ->assertForbidden();

        // And handling the safeguarding case they reported.
        Volt::actingAs($user)->test('safeguarding.report', ['school' => $school])
            ->set('category', 'child_sexual_abuse')
            ->set('description', 'A detailed account of the concern, long enough to be actionable.')
            ->set('understoodLegalDuty', true)
            ->call('submit');

        $report = SafeguardingReport::firstOrFail();
        $service = app(\App\Services\SafeguardingService::class);

        $this->assertFalse($service->canView($user, $report), 'the system_admin branch must not reinstate the reporter');
        $this->assertFalse($service->canManage($user, $report));
        Volt::actingAs($user)->test('safeguarding.show', ['report' => $report])->assertForbidden();

        $appeal->refresh();
        $this->assertNull($appeal->reviewed_by_user_id);
        $this->assertNoRowNamesASubmitterBesideTheirOwnAnonymousRecord();
    }
}
