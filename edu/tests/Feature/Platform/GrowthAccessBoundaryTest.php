<?php

namespace Tests\Feature\Platform;

use App\Models\CapabilityObservation;
use App\Models\User;
use App\Services\ConsentService;
use App\Services\DevelopmentAccessService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Livewire\Volt\Volt;
use Tests\Feature\Platform\Concerns\SetsUpPlatformData;
use Tests\TestCase;

/**
 * Spec section 20's access matrix, and section 32's rule that government sees
 * aggregate data only. These are the tests that would catch the worst possible
 * failure of this module: one family's private developmental record becoming
 * visible to someone with no business seeing it.
 */
class GrowthAccessBoundaryTest extends TestCase
{
    use RefreshDatabase, SetsUpPlatformData;

    /** Sets up a consented child with one recorded strength. */
    private function consentedStudent(): array
    {
        $school = $this->makeSchool();
        $student = $this->makeVerifiedStudent($school);
        $guardian = $this->makeGuardianOf($school, $student);
        $teacher = $this->makeVerifiedTeacher($school);

        $consent = app(ConsentService::class);
        foreach (['capability_growth', 'career_pathway', 'life_skills'] as $purpose) {
            $consent->grant($guardian, $student->id, $purpose);
        }

        CapabilityObservation::create([
            'student_user_id' => $student->id,
            'school_id' => $school->id,
            'observer_user_id' => $teacher->id,
            'observer_role' => 'teacher',
            'domain' => 'cognitive_scholastic',
            'strand' => 'problem solving',
            'observation_type' => 'strength',
            'observation' => 'Worked through a hard problem set without giving up.',
            'academic_term' => '2026-27 Term 1',
            'observed_on' => now()->toDateString(),
        ]);

        return compact('school', 'student', 'guardian', 'teacher');
    }

    public function test_a_district_officer_cannot_open_an_individual_childs_growth_record(): void
    {
        ['school' => $school, 'student' => $student] = $this->consentedStudent();
        $officer = $this->makeDistrictOfficer($school);

        Volt::actingAs($officer)->test('growth.show', ['student' => $student])
            ->assertForbidden();
    }

    public function test_a_state_officer_cannot_open_an_individual_childs_growth_record(): void
    {
        ['school' => $school, 'student' => $student] = $this->consentedStudent();
        $officer = $this->makeStateOfficer($school);

        Volt::actingAs($officer)->test('growth.show', ['student' => $student])
            ->assertForbidden();
    }

    public function test_a_national_admin_cannot_open_an_individual_childs_growth_record(): void
    {
        ['student' => $student] = $this->consentedStudent();

        $nationalAdmin = User::factory()->create();
        $nationalAdmin->assignRole('national_admin');

        Volt::actingAs($nationalAdmin)->test('growth.show', ['student' => $student])
            ->assertForbidden();
    }

    public function test_a_researcher_cannot_open_an_individual_childs_growth_record(): void
    {
        ['student' => $student] = $this->consentedStudent();

        $researcher = User::factory()->create();
        $researcher->assignRole('researcher');

        Volt::actingAs($researcher)->test('growth.show', ['student' => $student])
            ->assertForbidden();
    }

    public function test_another_familys_parent_cannot_open_this_childs_growth_record(): void
    {
        ['school' => $school, 'student' => $student] = $this->consentedStudent();

        // A different child at the same school, and that child's guardian.
        $otherStudent = $this->makeVerifiedStudent($school);
        $otherGuardian = $this->makeGuardianOf($school, $otherStudent);

        Volt::actingAs($otherGuardian)->test('growth.show', ['student' => $student])
            ->assertForbidden();
    }

    public function test_another_student_cannot_open_a_classmates_growth_record(): void
    {
        ['school' => $school, 'student' => $student] = $this->consentedStudent();
        $classmate = $this->makeVerifiedStudent($school);

        Volt::actingAs($classmate)->test('growth.show', ['student' => $student])
            ->assertForbidden();
    }

    public function test_a_teacher_at_a_different_school_cannot_open_the_record(): void
    {
        ['student' => $student] = $this->consentedStudent();

        $otherSchool = $this->makeSchool();
        $outsideTeacher = $this->makeVerifiedTeacher($otherSchool);

        Volt::actingAs($outsideTeacher)->test('growth.show', ['student' => $student])
            ->assertForbidden();
    }

    public function test_the_guardian_can_open_the_record(): void
    {
        ['student' => $student, 'guardian' => $guardian] = $this->consentedStudent();

        Volt::actingAs($guardian)->test('growth.show', ['student' => $student])
            ->assertOk();
    }

    public function test_the_child_can_open_their_own_record(): void
    {
        ['student' => $student] = $this->consentedStudent();

        Volt::actingAs($student)->test('growth.show', ['student' => $student])
            ->assertOk();
    }

    public function test_career_and_life_skills_records_enforce_the_same_boundary(): void
    {
        ['school' => $school, 'student' => $student] = $this->consentedStudent();
        $officer = $this->makeDistrictOfficer($school);

        Volt::actingAs($officer)->test('career.show', ['student' => $student])->assertForbidden();
        Volt::actingAs($officer)->test('life-skills.show', ['student' => $student])->assertForbidden();
    }

    public function test_outsider_cannot_record_an_observation_about_a_child(): void
    {
        ['school' => $school, 'student' => $student] = $this->consentedStudent();
        $otherSchool = $this->makeSchool();
        $outsideTeacher = $this->makeVerifiedTeacher($otherSchool);

        $this->assertFalse(
            app(DevelopmentAccessService::class)
                ->canRecordObservation($outsideTeacher, $student->id, $school->id)
        );
    }

    public function test_accessible_student_ids_never_cross_school_boundaries(): void
    {
        ['school' => $school, 'student' => $student, 'teacher' => $teacher] = $this->consentedStudent();

        $otherSchool = $this->makeSchool();
        $otherStudent = $this->makeVerifiedStudent($otherSchool);

        $accessible = app(DevelopmentAccessService::class)->accessibleStudentIds($teacher);

        $this->assertContains($student->id, $accessible);
        $this->assertNotContains($otherStudent->id, $accessible);
    }
}
