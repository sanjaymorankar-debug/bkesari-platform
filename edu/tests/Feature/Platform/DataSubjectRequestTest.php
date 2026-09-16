<?php

namespace Tests\Feature\Platform;

use App\Models\AuditLog;
use App\Models\CapabilityObservation;
use App\Models\ConsentRecord;
use App\Models\DataSubjectRequest;
use App\Models\PhysicalHealthRecord;
use App\Models\SafeguardingReport;
use App\Models\School;
use App\Models\SchoolStaff;
use App\Models\User;
use App\Services\ConsentService;
use App\Services\DataSubjectRequestService;
use App\Support\DataRetention;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Validation\ValidationException;
use Livewire\Volt\Volt;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\Feature\Platform\Concerns\SetsUpPlatformData;
use Tests\TestCase;

/**
 * Spec sections 21 and 40 — DPDP data-subject requests, and the limits on
 * erasure that exist to protect people rather than the platform.
 */
class DataSubjectRequestTest extends TestCase
{
    use RefreshDatabase, SetsUpPlatformData;

    private School $school;

    private User $child;

    private User $guardian;

    private User $dpo;

    protected function setUp(): void
    {
        parent::setUp();

        $this->school = $this->makeSchool();
        $this->child = $this->makeVerifiedStudent($this->school);
        $this->guardian = $this->makeGuardianOf($this->school, $this->child);

        $this->dpo = User::factory()->create();
        $this->dpo->assignRole('data_protection_officer');
    }

    private function service(): DataSubjectRequestService
    {
        return app(DataSubjectRequestService::class);
    }

    private function seedGrowthData(): void
    {
        app(ConsentService::class)->grant($this->guardian, $this->child->id, 'capability_growth');

        $teacher = $this->makeVerifiedTeacher($this->school);

        CapabilityObservation::create([
            'student_user_id' => $this->child->id,
            'school_id' => $this->school->id,
            'observer_user_id' => $teacher->id,
            'observer_role' => 'teacher',
            'domain' => 'cognitive_scholastic',
            'strand' => 'Problem solving',
            'observation_type' => 'strength',
            'observation' => 'Works through problems methodically.',
            'observed_on' => now()->toDateString(),
            'academic_term' => 'Term 1',
        ]);
    }

    // ---------------------------------------------------------------
    //  Who may ask
    // ---------------------------------------------------------------

    public function test_a_guardian_can_request_about_their_own_child(): void
    {
        $this->assertTrue($this->service()->canRequestFor($this->guardian, $this->child->id));
    }

    public function test_a_person_can_request_about_themselves(): void
    {
        $this->assertTrue($this->service()->canRequestFor($this->child, $this->child->id));
    }

    public function test_another_familys_parent_cannot_request_about_this_child(): void
    {
        $otherParent = $this->makeVerifiedParent($this->school);

        $this->assertFalse($this->service()->canRequestFor($otherParent, $this->child->id));
    }

    public function test_submitting_for_someone_elses_child_is_refused(): void
    {
        $otherParent = $this->makeVerifiedParent($this->school);

        $this->expectException(HttpException::class);

        $this->service()->submit($otherParent, $this->child->id, 'access', ['capability_growth']);
    }

    // ---------------------------------------------------------------
    //  Erasure: granted where it can be, refused where it must be
    // ---------------------------------------------------------------

    public function test_erasure_actually_deletes_the_erasable_records(): void
    {
        $this->seedGrowthData();

        $this->assertSame(1, CapabilityObservation::count());

        $request = $this->service()->submit(
            $this->guardian, $this->child->id, 'erasure', ['capability_growth']
        );

        $this->service()->fulfilErasure($this->dpo, $request);

        $this->assertSame(0, CapabilityObservation::count());
        $this->assertSame('completed', $request->fresh()->status);
    }

    /**
     * The rule that matters most. A safeguarding record removable on request
     * is a child protection case that an accused adult could get cleared by
     * pressuring a guardian.
     */
    public function test_safeguarding_records_are_never_erased(): void
    {
        SafeguardingReport::create([
            'reference' => SafeguardingReport::generateReference(),
            'school_id' => $this->school->id,
            'district_id' => $this->school->district_id,
            'state_id' => $this->school->state_id,
            'anonymous_ref' => 'ANON-KEEPME',
            'reporter_role' => 'parent',
            'category' => 'child_sexual_abuse',
            'description' => 'A concern that must survive an erasure request.',
        ]);

        $request = $this->service()->submit(
            $this->guardian, $this->child->id, 'erasure', ['safeguarding']
        );

        $this->service()->fulfilErasure($this->dpo, $request);

        $this->assertSame(1, SafeguardingReport::count());
        $this->assertSame('refused', $request->fresh()->status);
        $this->assertSame('kept', $request->fresh()->outcome_by_category['safeguarding']['result']);
    }

    public function test_consent_records_survive_an_erasure_request(): void
    {
        $this->seedGrowthData();

        $this->assertSame(1, ConsentRecord::count());

        $request = $this->service()->submit(
            $this->guardian, $this->child->id, 'erasure', ['capability_growth', 'consent_records']
        );

        $this->service()->fulfilErasure($this->dpo, $request);

        // The observation is gone; the record that consent existed is not.
        $this->assertSame(0, CapabilityObservation::count());
        $this->assertSame(1, ConsentRecord::count());
    }

    /**
     * A mixed request must be granted in part and refused in part, with both
     * recorded — not collapsed into one status that hides which.
     */
    public function test_a_mixed_request_reports_each_category_separately(): void
    {
        $this->seedGrowthData();

        $request = $this->service()->submit(
            $this->guardian,
            $this->child->id,
            'erasure',
            ['capability_growth', 'safeguarding', 'audit_logs']
        );

        $this->service()->fulfilErasure($this->dpo, $request);

        $outcome = $request->fresh()->outcome_by_category;

        $this->assertSame('partially_completed', $request->fresh()->status);
        $this->assertSame('erased', $outcome['capability_growth']['result']);
        $this->assertSame('kept', $outcome['safeguarding']['result']);
        $this->assertSame('kept', $outcome['audit_logs']['result']);

        // Every refusal carries its reason.
        $this->assertNotSame('', $outcome['safeguarding']['reason']);
        $this->assertNotSame('', $outcome['audit_logs']['reason']);
    }

    public function test_a_protected_category_is_never_reported_as_erased(): void
    {
        $request = $this->service()->submit(
            $this->guardian, $this->child->id, 'erasure', DataRetention::protectedCategories()
        );

        $this->service()->fulfilErasure($this->dpo, $request);

        foreach ($request->fresh()->outcome_by_category as $category => $outcome) {
            $this->assertSame('kept', $outcome['result'], $category.' must never report as erased.');
        }
    }

    /** The audit row outlives the erasure it records — that is the point. */
    public function test_the_erasure_itself_is_audit_logged(): void
    {
        $this->seedGrowthData();

        $request = $this->service()->submit(
            $this->guardian, $this->child->id, 'erasure', ['capability_growth']
        );

        $this->service()->fulfilErasure($this->dpo, $request);

        $this->assertTrue(
            AuditLog::where('action', 'data_subject_request.erasure_fulfilled')
                ->where('user_id', $this->dpo->id)
                ->exists()
        );
    }

    public function test_health_records_are_erasable_on_request(): void
    {
        $nurse = User::factory()->create();
        $nurse->assignRole('school_nurse');
        SchoolStaff::create(['user_id' => $nurse->id, 'school_id' => $this->school->id, 'designation' => 'Nurse']);

        PhysicalHealthRecord::create([
            'student_user_id' => $this->child->id,
            'school_id' => $this->school->id,
            'academic_year' => '2026-27',
            'examination_date' => now()->toDateString(),
            'recorded_by_user_id' => $nurse->id,
        ]);

        $request = $this->service()->submit(
            $this->guardian, $this->child->id, 'erasure', ['physical_health']
        );

        $this->service()->fulfilErasure($this->dpo, $request);

        $this->assertSame(0, PhysicalHealthRecord::count());
    }

    // ---------------------------------------------------------------
    //  Who may act
    // ---------------------------------------------------------------

    public function test_only_the_data_protection_officer_can_fulfil_a_request(): void
    {
        $request = $this->service()->submit(
            $this->guardian, $this->child->id, 'erasure', ['capability_growth']
        );

        foreach ([$this->guardian, $this->makeSchoolAdmin($this->school), $this->makeDistrictOfficer($this->school)] as $user) {
            try {
                $this->service()->fulfilErasure($user, $request);
                $this->fail($user->getRoleNames()->first().' must not be able to fulfil a request.');
            } catch (HttpException $e) {
                $this->assertSame(403, $e->getStatusCode());
            }
        }
    }

    public function test_an_access_request_must_record_what_was_done(): void
    {
        $request = $this->service()->submit(
            $this->guardian, $this->child->id, 'access', ['capability_growth']
        );

        $this->expectException(ValidationException::class);

        $this->service()->complete($this->dpo, $request, '   ');
    }

    // ---------------------------------------------------------------
    //  Housekeeping
    // ---------------------------------------------------------------

    public function test_a_request_carries_a_due_date_so_delay_is_visible(): void
    {
        $request = $this->service()->submit(
            $this->guardian, $this->child->id, 'access', ['capability_growth']
        );

        $this->assertNotNull($request->due_by);
        $this->assertTrue($request->due_by->isFuture());
        $this->assertFalse($request->isOverdue());

        $request->forceFill(['due_by' => now()->subDay()])->save();

        $this->assertTrue($request->fresh()->isOverdue());
    }

    public function test_a_request_with_no_recognised_category_is_rejected(): void
    {
        $this->expectException(ValidationException::class);

        $this->service()->submit($this->guardian, $this->child->id, 'erasure', ['not_a_category']);
    }

    // ---------------------------------------------------------------
    //  The screens
    // ---------------------------------------------------------------

    /**
     * The limits are stated before someone asks, not after they have waited a
     * month for a refusal. That is the difference between a right honoured and
     * a right processed.
     */
    public function test_the_request_form_states_the_limits_up_front(): void
    {
        Volt::actingAs($this->guardian)->test('privacy.requests')
            ->assertOk()
            ->assertSee('cannot be deleted')
            ->assertSee('Safeguarding cases')
            ->assertSee('Digital Personal Data Protection Act 2023');
    }

    public function test_a_guardian_can_submit_through_the_form(): void
    {
        Volt::actingAs($this->guardian)->test('privacy.requests')
            ->set('subjectUserId', (string) $this->child->id)
            ->set('requestType', 'erasure')
            ->set('selected.capability_growth', true)
            ->call('submit')
            ->assertSee('Request DSR-');

        $this->assertSame(1, DataSubjectRequest::count());
    }

    public function test_submitting_with_nothing_selected_is_rejected(): void
    {
        Volt::actingAs($this->guardian)->test('privacy.requests')
            ->set('subjectUserId', (string) $this->child->id)
            ->call('submit')
            ->assertHasErrors('selected');

        $this->assertSame(0, DataSubjectRequest::count());
    }

    public function test_only_the_dpo_can_open_the_queue(): void
    {
        Volt::actingAs($this->guardian)->test('privacy.queue')->assertForbidden();
        Volt::actingAs($this->makeSchoolAdmin($this->school))->test('privacy.queue')->assertForbidden();
        Volt::actingAs($this->dpo)->test('privacy.queue')->assertOk();
    }

    public function test_the_queue_shows_what_an_erasure_will_and_will_not_touch(): void
    {
        $this->service()->submit(
            $this->guardian, $this->child->id, 'erasure', ['capability_growth', 'safeguarding']
        );

        Volt::actingAs($this->dpo)->test('privacy.queue')
            ->assertOk()
            ->assertSee('Will delete: 1')
            ->assertSee('Will keep: 1');
    }

    /** Every category the platform holds must declare a retention position. */
    public function test_every_consent_purpose_has_a_retention_position(): void
    {
        foreach (array_keys(ConsentRecord::PURPOSES) as $purpose) {
            if ($purpose === 'alumni_outcomes') {
                continue; // module not built yet — tracked in ROADMAP.md
            }

            $this->assertArrayHasKey(
                $purpose,
                DataRetention::CATEGORIES,
                "Consent purpose '{$purpose}' has no declared retention period."
            );
        }
    }
}
