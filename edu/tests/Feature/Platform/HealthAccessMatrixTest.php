<?php

namespace Tests\Feature\Platform;

use App\Models\ConsentRecord;
use App\Models\CounsellingSession;
use App\Models\HealthAccessLog;
use App\Models\PhysicalHealthRecord;
use App\Models\School;
use App\Models\SchoolStaff;
use App\Models\User;
use App\Services\ConsentService;
use App\Services\HealthAccessService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\Feature\Platform\Concerns\SetsUpPlatformData;
use Tests\TestCase;

/**
 * Spec sections 18-21 — the health data access matrix, the teacher/counsellor
 * separation, and the audit trail.
 */
class HealthAccessMatrixTest extends TestCase
{
    use RefreshDatabase, SetsUpPlatformData;

    private School $school;

    private User $child;

    private User $guardian;

    protected function setUp(): void
    {
        parent::setUp();

        $this->school = $this->makeSchool();
        $this->child = $this->makeVerifiedStudent($this->school);
        $this->guardian = $this->makeGuardianOf($this->school, $this->child);
    }

    private function roleOnlyUser(string $role): User
    {
        $user = User::factory()->create();
        $user->assignRole($role);

        return $user;
    }

    private function staffMember(string $role): User
    {
        $user = User::factory()->create();
        $user->assignRole($role);

        SchoolStaff::create([
            'user_id' => $user->id,
            'school_id' => $this->school->id,
            'designation' => ucfirst(str_replace('_', ' ', $role)),
        ]);

        return $user;
    }

    private function grantConsent(string $purpose): void
    {
        app(ConsentService::class)->grant($this->guardian, $this->child->id, $purpose);
    }

    private function service(): HealthAccessService
    {
        return app(HealthAccessService::class);
    }

    // ---------------------------------------------------------------
    //  Consent gates everything
    // ---------------------------------------------------------------

    public function test_a_nurse_cannot_see_health_records_without_consent(): void
    {
        $nurse = $this->staffMember('school_nurse');

        $this->assertFalse(
            $this->service()->canView($nurse, $this->child->id, HealthAccessService::PURPOSE_PHYSICAL)
        );
    }

    public function test_a_nurse_can_see_them_once_the_guardian_consents(): void
    {
        $nurse = $this->staffMember('school_nurse');
        $this->grantConsent(HealthAccessService::PURPOSE_PHYSICAL);

        $this->assertTrue(
            $this->service()->canView($nurse, $this->child->id, HealthAccessService::PURPOSE_PHYSICAL)
        );
    }

    public function test_withdrawing_consent_removes_access_immediately(): void
    {
        $nurse = $this->staffMember('school_nurse');
        $this->grantConsent(HealthAccessService::PURPOSE_PHYSICAL);

        app(ConsentService::class)->withdraw($this->guardian, $this->child->id, HealthAccessService::PURPOSE_PHYSICAL);

        $this->assertFalse(
            $this->service()->canView($nurse, $this->child->id, HealthAccessService::PURPOSE_PHYSICAL)
        );
    }

    /** Health and wellbeing consent are separate purposes and must not leak. */
    public function test_physical_health_consent_does_not_grant_wellbeing_access(): void
    {
        $counsellor = $this->staffMember('counsellor');
        $this->grantConsent(HealthAccessService::PURPOSE_PHYSICAL);

        $this->assertTrue($this->service()->canView($counsellor, $this->child->id, HealthAccessService::PURPOSE_PHYSICAL));
        $this->assertFalse($this->service()->canView($counsellor, $this->child->id, HealthAccessService::PURPOSE_WELLBEING));
    }

    // ---------------------------------------------------------------
    //  Who sees what (section 20's matrix)
    // ---------------------------------------------------------------

    public function test_the_guardian_can_see_their_own_childs_records(): void
    {
        $this->grantConsent(HealthAccessService::PURPOSE_PHYSICAL);

        $this->assertTrue(
            $this->service()->canView($this->guardian, $this->child->id, HealthAccessService::PURPOSE_PHYSICAL)
        );
    }

    /** A child is not a stranger to their own health record. */
    public function test_the_child_can_always_see_their_own_record(): void
    {
        $this->assertTrue(
            $this->service()->canView($this->child, $this->child->id, HealthAccessService::PURPOSE_PHYSICAL)
        );
    }

    public function test_another_familys_parent_cannot_see_this_childs_records(): void
    {
        $this->grantConsent(HealthAccessService::PURPOSE_PHYSICAL);
        $otherParent = $this->makeVerifiedParent($this->school);

        $this->assertFalse(
            $this->service()->canView($otherParent, $this->child->id, HealthAccessService::PURPOSE_PHYSICAL)
        );
    }

    /**
     * Section 20: a teacher may raise an observation and read nothing back.
     * They are not a health professional and the record is not theirs.
     */
    public function test_a_teacher_cannot_read_health_or_counselling_records(): void
    {
        $teacher = $this->staffMember('teacher');
        $this->grantConsent(HealthAccessService::PURPOSE_PHYSICAL);
        $this->grantConsent(HealthAccessService::PURPOSE_WELLBEING);

        $this->assertFalse($this->service()->canView($teacher, $this->child->id, HealthAccessService::PURPOSE_PHYSICAL));
        $this->assertFalse($this->service()->canView($teacher, $this->child->id, HealthAccessService::PURPOSE_WELLBEING));
    }

    public function test_a_teacher_can_still_raise_a_wellbeing_observation(): void
    {
        $teacher = $this->staffMember('teacher');
        $this->grantConsent(HealthAccessService::PURPOSE_WELLBEING);

        $this->assertTrue(
            $this->service()->canRaiseWellbeingConcern($teacher, $this->child->id, $this->school->id)
        );
    }

    public function test_a_nurse_cannot_read_wellbeing_records(): void
    {
        $nurse = $this->staffMember('school_nurse');
        $this->grantConsent(HealthAccessService::PURPOSE_WELLBEING);

        $this->assertFalse(
            $this->service()->canView($nurse, $this->child->id, HealthAccessService::PURPOSE_WELLBEING)
        );
    }

    /** Section 20: a counsellor may read a physical health record but not alter one. */
    public function test_a_counsellor_cannot_record_a_physical_health_entry(): void
    {
        $counsellor = $this->staffMember('counsellor');
        $this->grantConsent(HealthAccessService::PURPOSE_PHYSICAL);

        $this->assertFalse(
            $this->service()->canRecordPhysicalHealth($counsellor, $this->child->id, $this->school->id)
        );
    }

    public function test_staff_at_a_different_school_cannot_see_the_record(): void
    {
        $this->grantConsent(HealthAccessService::PURPOSE_PHYSICAL);

        $otherSchool = $this->makeSchool();
        $outsider = User::factory()->create();
        $outsider->assignRole('school_nurse');
        SchoolStaff::create(['user_id' => $outsider->id, 'school_id' => $otherSchool->id, 'designation' => 'Nurse']);

        $this->assertFalse(
            $this->service()->canView($outsider, $this->child->id, HealthAccessService::PURPOSE_PHYSICAL)
        );
    }

    // ---------------------------------------------------------------
    //  The stricter counselling tier
    // ---------------------------------------------------------------

    public function test_raw_counselling_notes_are_visible_only_to_the_counsellor(): void
    {
        $counsellor = $this->staffMember('counsellor');
        $this->grantConsent(HealthAccessService::PURPOSE_WELLBEING);

        $session = CounsellingSession::create([
            'student_user_id' => $this->child->id,
            'school_id' => $this->school->id,
            'session_date' => now()->toDateString(),
            'session_notes' => 'Detailed clinical working notes.',
            'shareable_summary' => 'We talked about settling into the new class.',
            'counsellor_user_id' => $counsellor->id,
        ]);

        $service = $this->service();

        $this->assertTrue($service->canViewCounsellingNotes($counsellor, $session));
        $this->assertFalse($service->canViewCounsellingNotes($this->guardian, $session));
        $this->assertFalse($service->canViewCounsellingNotes($this->child, $session));
        $this->assertFalse($service->canViewCounsellingNotes($this->staffMember('school_nurse'), $session));
        $this->assertFalse($service->canViewCounsellingNotes($this->makeSchoolAdmin($this->school), $session));
    }

    /**
     * The guardian view must never fall back to the raw notes when a
     * counsellor hasn't written a summary — silence is the safe default.
     */
    public function test_the_guardian_view_never_leaks_the_raw_notes(): void
    {
        $counsellor = $this->staffMember('counsellor');

        $session = CounsellingSession::create([
            'student_user_id' => $this->child->id,
            'school_id' => $this->school->id,
            'session_date' => now()->toDateString(),
            'session_notes' => 'SENSITIVE-CLINICAL-DETAIL',
            'shareable_summary' => null,
            'counsellor_user_id' => $counsellor->id,
        ]);

        $view = $session->guardianView();

        $this->assertNull($view['summary']);
        $this->assertFalse($view['has_summary']);
        $this->assertStringNotContainsString('SENSITIVE-CLINICAL-DETAIL', json_encode($view));
    }

    // ---------------------------------------------------------------
    //  Government sees nothing individual
    // ---------------------------------------------------------------

    public function test_officers_and_researchers_cannot_read_an_individual_childs_records(): void
    {
        $this->grantConsent(HealthAccessService::PURPOSE_PHYSICAL);
        $this->grantConsent(HealthAccessService::PURPOSE_WELLBEING);

        $officers = [
            $this->makeDistrictOfficer($this->school),
            $this->makeStateOfficer($this->school),
            $this->roleOnlyUser('national_admin'),
            $this->roleOnlyUser('researcher'),
        ];

        foreach ($officers as $officer) {
            foreach ([HealthAccessService::PURPOSE_PHYSICAL, HealthAccessService::PURPOSE_WELLBEING] as $purpose) {
                $this->assertFalse(
                    $this->service()->canView($officer, $this->child->id, $purpose),
                    $officer->getRoleNames()->first().' must not read an individual health record — spec section 20.'
                );
            }
        }
    }

    public function test_the_access_service_contains_no_government_branch(): void
    {
        $source = file_get_contents(app_path('Services/HealthAccessService.php'));

        foreach (['district_officer', 'state_officer', 'national_admin', 'researcher'] as $role) {
            $this->assertStringNotContainsString(
                "'{$role}'",
                $source,
                "Government roles get aggregates only — {$role} must never appear in the health access matrix."
            );
        }
    }

    // ---------------------------------------------------------------
    //  Teachers must never diagnose (enforced at the data model)
    // ---------------------------------------------------------------

    public function test_the_teacher_observation_table_has_no_clinical_columns(): void
    {
        $columns = Schema::getColumnListing('wellbeing_concerns');

        foreach (['diagnosis', 'condition', 'severity', 'risk_level', 'treatment', 'intervention', 'score'] as $forbidden) {
            $this->assertNotContains(
                $forbidden,
                $columns,
                "wellbeing_concerns must never carry '{$forbidden}' — spec section 19 forbids teachers diagnosing."
            );
        }
    }

    public function test_teacher_observations_and_counselling_notes_are_separate_tables(): void
    {
        // A shared table with a role column would need only one careless write
        // to put a teacher's opinion where a clinical note belongs.
        $this->assertTrue(Schema::hasTable('wellbeing_concerns'));
        $this->assertTrue(Schema::hasTable('counselling_sessions'));
        $this->assertFalse(Schema::hasColumn('wellbeing_concerns', 'session_notes'));
    }

    // ---------------------------------------------------------------
    //  Audit trail
    // ---------------------------------------------------------------

    public function test_a_permitted_view_is_logged(): void
    {
        $nurse = $this->staffMember('school_nurse');
        $this->grantConsent(HealthAccessService::PURPOSE_PHYSICAL);

        $this->service()->authoriseAndLogView(
            $nurse, $this->child->id, HealthAccessService::PURPOSE_PHYSICAL, 'physical_health'
        );

        $this->assertTrue(
            HealthAccessLog::where('actor_user_id', $nurse->id)->where('action', 'viewed')->exists()
        );
    }

    /** A refused attempt is as worth recording as a successful one. */
    public function test_a_refused_view_is_logged_as_denied(): void
    {
        $teacher = $this->staffMember('teacher');
        $this->grantConsent(HealthAccessService::PURPOSE_PHYSICAL);

        try {
            $this->service()->authoriseAndLogView(
                $teacher, $this->child->id, HealthAccessService::PURPOSE_PHYSICAL, 'physical_health'
            );
            $this->fail('Access should have been refused.');
        } catch (HttpException $e) {
            $this->assertSame(403, $e->getStatusCode());
        }

        $this->assertTrue(
            HealthAccessLog::where('actor_user_id', $teacher->id)->where('action', 'denied')->exists()
        );
    }

    // ---------------------------------------------------------------
    //  Longitudinal history and follow-ups
    // ---------------------------------------------------------------

    public function test_health_records_accumulate_rather_than_overwrite(): void
    {
        $nurse = $this->staffMember('school_nurse');

        foreach (['2024-25' => 120.5, '2025-26' => 128.0, '2026-27' => 134.2] as $year => $height) {
            PhysicalHealthRecord::create([
                'student_user_id' => $this->child->id,
                'school_id' => $this->school->id,
                'academic_year' => $year,
                'examination_date' => substr($year, 0, 4).'-07-01',
                'height_cm' => $height,
                'recorded_by_user_id' => $nurse->id,
            ]);
        }

        $this->assertSame(3, PhysicalHealthRecord::where('student_user_id', $this->child->id)->count());
        $this->assertSame('120.5', PhysicalHealthRecord::where('academic_year', '2024-25')->first()->height_cm);
    }

    public function test_bmi_is_calculated_but_never_classified(): void
    {
        $nurse = $this->staffMember('school_nurse');

        $record = PhysicalHealthRecord::create([
            'student_user_id' => $this->child->id,
            'school_id' => $this->school->id,
            'academic_year' => '2026-27',
            'examination_date' => now()->toDateString(),
            'height_cm' => 150,
            'weight_kg' => 45,
            'recorded_by_user_id' => $nurse->id,
        ]);

        $this->assertSame(20.0, $record->calculatedBmi());

        // No classification method exists, and none should: adult cutoffs are
        // meaningless for a growing child and a label is what the spec forbids.
        $this->assertFalse(method_exists($record, 'bmiCategory'));
        $this->assertFalse(method_exists($record, 'weightStatus'));
    }

    public function test_bmi_is_null_when_a_measurement_is_missing(): void
    {
        $nurse = $this->staffMember('school_nurse');

        $record = PhysicalHealthRecord::create([
            'student_user_id' => $this->child->id,
            'school_id' => $this->school->id,
            'academic_year' => '2026-27',
            'examination_date' => now()->toDateString(),
            'height_cm' => 150,
            'recorded_by_user_id' => $nurse->id,
        ]);

        $this->assertNull($record->calculatedBmi());
    }

    public function test_consent_purposes_cover_both_health_areas(): void
    {
        $this->assertArrayHasKey(HealthAccessService::PURPOSE_PHYSICAL, ConsentRecord::PURPOSES);
        $this->assertArrayHasKey(HealthAccessService::PURPOSE_WELLBEING, ConsentRecord::PURPOSES);
    }
}
