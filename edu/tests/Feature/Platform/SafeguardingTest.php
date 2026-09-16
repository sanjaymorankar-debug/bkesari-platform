<?php

namespace Tests\Feature\Platform;

use App\Models\ComplaintCategory;
use App\Models\SafeguardingEvent;
use App\Models\SafeguardingReport;
use App\Models\School;
use App\Models\SchoolStaff;
use App\Models\User;
use App\Services\SafeguardingService;
use Database\Seeders\ComplaintCategorySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\ValidationException;
use Livewire\Volt\Volt;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\Feature\Platform\Concerns\SetsUpPlatformData;
use Tests\TestCase;

/**
 * Spec section 25 and rule 44 — the platform's most legally sensitive
 * workflow. These tests exist to hold the hard rules, not the happy path.
 */
class SafeguardingTest extends TestCase
{
    use RefreshDatabase, SetsUpPlatformData;

    private function makeChildSafetyOfficer(School $school): User
    {
        $user = User::factory()->create();
        $user->assignRole('child_safety_officer');

        SchoolStaff::create([
            'user_id' => $user->id,
            'school_id' => $school->id,
            'designation' => 'Child Safety Officer',
        ]);

        return $user;
    }

    private function makeReport(School $school, array $attributes = []): SafeguardingReport
    {
        return SafeguardingReport::create(array_merge([
            'reference' => SafeguardingReport::generateReference(),
            'school_id' => $school->id,
            'district_id' => $school->district_id,
            'state_id' => $school->state_id,
            'anonymous_ref' => 'ANON-TESTREF1234',
            'reporter_role' => 'parent',
            'category' => 'child_sexual_abuse',
            'description' => 'A detailed account of the concern, long enough to be actionable.',
            'immediate_danger' => false,
        ], $attributes));
    }

    // ---------------------------------------------------------------
    //  The rule that matters most: no internal inquiry in place of law
    // ---------------------------------------------------------------

    public function test_a_pocso_case_cannot_be_closed_without_an_external_report(): void
    {
        $school = $this->makeSchool();
        $officer = $this->makeChildSafetyOfficer($school);
        $report = $this->makeReport($school, ['category' => 'child_sexual_abuse']);

        $this->expectException(ValidationException::class);

        app(SafeguardingService::class)->close($officer, $report, 'Handled internally.');
    }

    public function test_a_pocso_case_stays_open_after_a_blocked_closure_attempt(): void
    {
        $school = $this->makeSchool();
        $officer = $this->makeChildSafetyOfficer($school);
        $report = $this->makeReport($school);

        try {
            app(SafeguardingService::class)->close($officer, $report, 'Handled internally.');
        } catch (ValidationException) {
            // expected
        }

        $this->assertNotSame('closed', $report->fresh()->status);
        $this->assertNull($report->fresh()->closed_at);
    }

    public function test_a_pocso_case_can_be_closed_once_an_external_report_is_recorded(): void
    {
        $school = $this->makeSchool();
        $officer = $this->makeChildSafetyOfficer($school);
        $report = $this->makeReport($school);

        $service = app(SafeguardingService::class);
        $service->recordExternalReport($officer, $report, 'police', 'FIR/2026/1234');
        $service->close($officer, $report->fresh(), 'Investigation concluded by the police.');

        $this->assertSame('closed', $report->fresh()->status);
    }

    public function test_the_closure_block_is_visible_in_the_case_screen(): void
    {
        $school = $this->makeSchool();
        $officer = $this->makeChildSafetyOfficer($school);
        $report = $this->makeReport($school);

        Volt::actingAs($officer)->test('safeguarding.show', ['report' => $report])
            ->assertOk()
            ->assertSee('A report to the police or SJPU has not been recorded')
            ->set('closureReason', 'Dealt with by the school.')
            ->call('close')
            ->assertHasErrors('closureReason');

        $this->assertNotSame('closed', $report->fresh()->status);
    }

    public function test_closing_always_requires_a_reason(): void
    {
        $school = $this->makeSchool();
        $officer = $this->makeChildSafetyOfficer($school);
        $report = $this->makeReport($school, ['category' => 'serious_harassment']);

        $this->expectException(ValidationException::class);

        app(SafeguardingService::class)->close($officer, $report, '   ');
    }

    // ---------------------------------------------------------------
    //  Who can see these cases
    // ---------------------------------------------------------------

    /**
     * The structural expression of "a school may not hold an internal inquiry
     * first": its ordinary administration cannot even see the case.
     */
    public function test_a_school_admin_cannot_view_a_safeguarding_case(): void
    {
        $school = $this->makeSchool();
        $schoolAdmin = $this->makeSchoolAdmin($school);
        $report = $this->makeReport($school);

        $this->assertFalse(app(SafeguardingService::class)->canView($schoolAdmin, $report));

        Volt::actingAs($schoolAdmin)->test('safeguarding.show', ['report' => $report])
            ->assertForbidden();
    }

    public function test_the_service_has_no_school_admin_branch_at_all(): void
    {
        // A guard against someone "helpfully" adding one later.
        $source = file_get_contents(app_path('Services/SafeguardingService.php'));

        $this->assertStringNotContainsString(
            "hasRole('school_admin')",
            $source,
            'School administrators must never gain access to safeguarding cases — see spec section 25.'
        );
    }

    public function test_the_child_safety_officer_of_that_school_can_view_it(): void
    {
        $school = $this->makeSchool();
        $officer = $this->makeChildSafetyOfficer($school);
        $report = $this->makeReport($school);

        $this->assertTrue(app(SafeguardingService::class)->canView($officer, $report));

        Volt::actingAs($officer)->test('safeguarding.show', ['report' => $report])->assertOk();
    }

    public function test_a_child_safety_officer_at_another_school_cannot_view_it(): void
    {
        $school = $this->makeSchool();
        $otherOfficer = $this->makeChildSafetyOfficer($this->makeSchool());
        $report = $this->makeReport($school);

        $this->assertFalse(app(SafeguardingService::class)->canView($otherOfficer, $report));
    }

    public function test_a_district_officer_in_jurisdiction_can_view_it_and_one_outside_cannot(): void
    {
        $school = $this->makeSchool();
        $inJurisdiction = $this->makeDistrictOfficer($school);
        $outside = $this->makeDistrictOfficer($this->makeSchool());
        $report = $this->makeReport($school);

        $service = app(SafeguardingService::class);

        $this->assertTrue($service->canView($inJurisdiction, $report));
        $this->assertFalse($service->canView($outside, $report));
    }

    public function test_a_parent_cannot_browse_the_safeguarding_queue(): void
    {
        $school = $this->makeSchool();
        $parent = $this->makeVerifiedParent($school);

        Volt::actingAs($parent)->test('safeguarding.queue')->assertForbidden();
    }

    // ---------------------------------------------------------------
    //  Never public, never scored
    // ---------------------------------------------------------------

    /** Spec section 25: these cases never appear as public ratings. */
    public function test_a_safeguarding_case_never_appears_on_the_public_school_profile(): void
    {
        $school = $this->makeSchool();
        $report = $this->makeReport($school, ['description' => 'A uniquely identifiable phrase zzqqxx.']);

        Volt::test('schools.show', ['school' => $school])
            ->assertOk()
            ->assertDontSee('zzqqxx')
            ->assertDontSee($report->reference)
            ->assertDontSee('Sexual abuse');
    }

    /** Spec section 25: they never feed into any score. */
    public function test_no_scoring_service_reads_safeguarding_data(): void
    {
        foreach (['SchoolQualityIndexService', 'TeacherEffectivenessIndexService'] as $service) {
            $path = app_path("Services/{$service}.php");

            if (! file_exists($path)) {
                continue;
            }

            $this->assertStringNotContainsString(
                'safeguarding',
                strtolower(file_get_contents($path)),
                "{$service} must never read safeguarding data — spec section 25."
            );
        }
    }

    /** Spec section 26 — anonymised like every other reporting channel. */
    public function test_safeguarding_reports_carry_no_user_identifying_column(): void
    {
        $columns = Schema::getColumnListing('safeguarding_reports');

        foreach (['user_id', 'reporter_user_id', 'email', 'name'] as $forbidden) {
            $this->assertNotContains($forbidden, $columns);
        }

        $this->assertContains('anonymous_ref', $columns);
    }

    // ---------------------------------------------------------------
    //  The legal duty must be surfaced, and never claimed as discharged
    // ---------------------------------------------------------------

    public function test_the_reporting_form_states_the_duty_before_submission(): void
    {
        $school = $this->makeSchool();
        $parent = $this->makeVerifiedParent($school);

        Volt::actingAs($parent)->test('safeguarding.report', ['school' => $school])
            ->assertOk()
            ->assertSee('POCSO Act 2012')
            ->assertSee('does not discharge that duty')
            ->assertSee('1098')
            ->assertSee('carry out an internal inquiry');
    }

    public function test_submission_is_blocked_until_the_duty_is_acknowledged(): void
    {
        $school = $this->makeSchool();
        $parent = $this->makeVerifiedParent($school);

        Volt::actingAs($parent)->test('safeguarding.report', ['school' => $school])
            ->set('category', 'child_sexual_abuse')
            ->set('description', 'A detailed account of the concern, long enough to pass validation.')
            ->set('understoodLegalDuty', false)
            ->call('submit')
            ->assertHasErrors('understoodLegalDuty');

        $this->assertSame(0, SafeguardingReport::count());
    }

    public function test_the_confirmation_never_implies_the_legal_duty_is_done(): void
    {
        $school = $this->makeSchool();
        $parent = $this->makeVerifiedParent($school);

        Volt::actingAs($parent)->test('safeguarding.report', ['school' => $school])
            ->set('category', 'child_sexual_abuse')
            ->set('description', 'A detailed account of the concern, long enough to pass validation.')
            ->set('understoodLegalDuty', true)
            ->call('submit')
            ->assertOk()
            ->assertSee('This is not a report to the police')
            ->assertSee('does not')
            ->assertSee('1098');
    }

    public function test_submitting_records_that_the_duty_was_shown(): void
    {
        $school = $this->makeSchool();
        $parent = $this->makeVerifiedParent($school);

        Volt::actingAs($parent)->test('safeguarding.report', ['school' => $school])
            ->set('category', 'physical_abuse')
            ->set('description', 'A detailed account of the concern, long enough to pass validation.')
            ->set('understoodLegalDuty', true)
            ->call('submit');

        $report = SafeguardingReport::first();

        $this->assertNotNull($report->legal_duty_shown_at);
        $this->assertTrue(
            $report->events()->where('event_type', 'legal_duty_shown')->exists(),
            'The platform must be able to show it surfaced the obligation.'
        );
    }

    // ---------------------------------------------------------------
    //  Audit trail
    // ---------------------------------------------------------------

    public function test_opening_a_case_is_logged(): void
    {
        $school = $this->makeSchool();
        $officer = $this->makeChildSafetyOfficer($school);
        $report = $this->makeReport($school);

        Volt::actingAs($officer)->test('safeguarding.show', ['report' => $report]);

        $this->assertTrue(
            SafeguardingEvent::where('safeguarding_report_id', $report->id)
                ->where('event_type', 'viewed')
                ->where('actor_user_id', $officer->id)
                ->exists()
        );
    }

    public function test_recording_an_external_report_is_logged_with_its_channel(): void
    {
        $school = $this->makeSchool();
        $officer = $this->makeChildSafetyOfficer($school);
        $report = $this->makeReport($school);

        app(SafeguardingService::class)->recordExternalReport($officer, $report, 'sjpu', 'DD/88/2026');

        $event = SafeguardingEvent::where('event_type', 'external_report_recorded')->first();

        $this->assertNotNull($event);
        $this->assertStringContainsString('Special Juvenile Police Unit', $event->detail);
        $this->assertStringContainsString('DD/88/2026', $event->detail);
        $this->assertSame($officer->id, $event->actor_user_id);
    }

    /**
     * Spec section 25 — the obligation must be presented "immediately when
     * such a case is flagged", not after it has gone down the ordinary route.
     */
    public function test_choosing_a_child_safety_complaint_category_surfaces_the_legal_route(): void
    {
        $school = $this->makeSchool();
        $parent = $this->makeVerifiedParent($school);

        $this->seed(ComplaintCategorySeeder::class);

        $childSafetyCategory = ComplaintCategory::where('is_child_safety', true)->firstOrFail();
        $ordinaryCategory = ComplaintCategory::where('is_child_safety', false)->firstOrFail();

        $component = Volt::actingAs($parent)->test('complaints.create')
            ->set('schoolId', (string) $school->id);

        $component->set('complaintCategoryId', (string) $ordinaryCategory->id)
            ->assertDontSee('Is a child at risk of harm?');

        $component->set('complaintCategoryId', (string) $childSafetyCategory->id)
            ->assertSee('Is a child at risk of harm?')
            ->assertSee('POCSO Act 2012')
            ->assertSee('1098');
    }

    // ---------------------------------------------------------------
    //  Cases must reach a person, not just a queue
    // ---------------------------------------------------------------

    public function test_submitting_notifies_the_schools_child_safety_officer(): void
    {
        $school = $this->makeSchool();
        $officer = $this->makeChildSafetyOfficer($school);
        $parent = $this->makeVerifiedParent($school);

        Volt::actingAs($parent)->test('safeguarding.report', ['school' => $school])
            ->set('category', 'child_sexual_abuse')
            ->set('description', 'A detailed account of the concern, long enough to pass validation.')
            ->set('understoodLegalDuty', true)
            ->call('submit');

        $this->assertSame(1, $officer->notifications()->count());
    }

    public function test_the_district_officer_in_jurisdiction_is_also_notified(): void
    {
        $school = $this->makeSchool();
        $districtOfficer = $this->makeDistrictOfficer($school);
        $report = $this->makeReport($school);

        $notified = app(SafeguardingService::class)->notifyResponsibleOfficers($report);

        $this->assertGreaterThanOrEqual(1, $notified);
        $this->assertSame(1, $districtOfficer->notifications()->count());
    }

    /** The school's ordinary administration must not be told either. */
    public function test_the_school_admin_is_never_notified(): void
    {
        $school = $this->makeSchool();
        $schoolAdmin = $this->makeSchoolAdmin($school);
        $this->makeChildSafetyOfficer($school);
        $report = $this->makeReport($school);

        app(SafeguardingService::class)->notifyResponsibleOfficers($report);

        $this->assertSame(0, $schoolAdmin->notifications()->count());
    }

    public function test_an_officer_outside_the_jurisdiction_is_not_notified(): void
    {
        $school = $this->makeSchool();
        $outsideOfficer = $this->makeDistrictOfficer($this->makeSchool());
        $report = $this->makeReport($school);

        app(SafeguardingService::class)->notifyResponsibleOfficers($report);

        $this->assertSame(0, $outsideOfficer->notifications()->count());
    }

    /**
     * A notification row is readable from a list view, so it must not carry
     * the substance of an allegation about a child.
     */
    public function test_the_notification_carries_no_detail_of_the_concern(): void
    {
        $school = $this->makeSchool();
        $officer = $this->makeChildSafetyOfficer($school);
        $report = $this->makeReport($school, [
            'description' => 'A SENSITIVE-DETAIL-zzqq account of what happened.',
            'anonymous_ref' => 'ANON-SECRETREF99',
        ]);

        app(SafeguardingService::class)->notifyResponsibleOfficers($report);

        $payload = json_encode($officer->notifications()->first()->data);

        $this->assertStringNotContainsString('SENSITIVE-DETAIL-zzqq', $payload);
        $this->assertStringNotContainsString('ANON-SECRETREF99', $payload);
        $this->assertStringContainsString($report->reference, $payload);
    }

    public function test_an_immediate_danger_case_is_marked_urgent(): void
    {
        $school = $this->makeSchool();
        $officer = $this->makeChildSafetyOfficer($school);
        $report = $this->makeReport($school, ['immediate_danger' => true]);

        app(SafeguardingService::class)->notifyResponsibleOfficers($report);

        $data = $officer->notifications()->first()->data;

        $this->assertTrue($data['immediate_danger']);
        $this->assertStringContainsString('Urgent', $data['message']);
    }

    /**
     * Telling a reporter their concern was sent when nobody was actually
     * alerted would be a comfortable lie. A school with no Child Safety
     * Officer configured is a real state and the page says so.
     */
    public function test_a_reporter_is_told_when_nobody_was_alerted(): void
    {
        $school = $this->makeSchool();
        $parent = $this->makeVerifiedParent($school);

        Volt::actingAs($parent)->test('safeguarding.report', ['school' => $school])
            ->set('category', 'physical_abuse')
            ->set('description', 'A detailed account of the concern, long enough to pass validation.')
            ->set('understoodLegalDuty', true)
            ->call('submit')
            ->assertSee('No child safety officer is currently set up')
            ->assertSee('1098');
    }

    public function test_notifying_is_recorded_in_the_case_trail(): void
    {
        $school = $this->makeSchool();
        $this->makeChildSafetyOfficer($school);
        $report = $this->makeReport($school);

        app(SafeguardingService::class)->notifyResponsibleOfficers($report);

        $this->assertTrue(
            SafeguardingEvent::where('safeguarding_report_id', $report->id)
                ->where('event_type', 'assigned')
                ->exists()
        );
    }

    public function test_an_unauthorised_user_cannot_act_on_a_case(): void
    {
        $school = $this->makeSchool();
        $report = $this->makeReport($school);
        $outsider = $this->makeChildSafetyOfficer($this->makeSchool());

        $this->expectException(HttpException::class);

        app(SafeguardingService::class)->close($outsider, $report, 'Not my case.');
    }
}
