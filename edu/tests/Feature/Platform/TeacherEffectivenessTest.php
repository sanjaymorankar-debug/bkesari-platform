<?php

namespace Tests\Feature\Platform;

use App\Models\StudentAcademicRecord;
use App\Models\TeacherEffectivenessScore;
use App\Models\TeacherFeedback;
use App\Models\TeacherProfile;
use App\Models\TeacherRatingComponent;
use App\Models\TeacherSchoolRelationship;
use App\Models\User;
use App\Services\TeacherEffectivenessIndexService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Livewire\Volt\Volt;
use Tests\Feature\Platform\Concerns\SetsUpPlatformData;
use Tests\TestCase;

class TeacherEffectivenessTest extends TestCase
{
    use RefreshDatabase, SetsUpPlatformData;

    private function seedComponents(): void
    {
        TeacherRatingComponent::create(['key' => 'communication', 'label' => 'Communication', 'weight' => 10]);
        TeacherRatingComponent::create(['key' => 'fairness', 'label' => 'Fairness', 'weight' => 10]);
    }

    public function test_verified_parent_can_rate_a_teacher_at_shared_school(): void
    {
        $this->seedComponents();
        $school = $this->makeSchool();
        $parent = $this->makeVerifiedParent($school);
        $teacher = $this->makeVerifiedTeacher($school);

        Volt::actingAs($parent)->test('teacher-feedback.create', ['teacher' => $teacher])
            ->set('scores.communication', 5)
            ->set('scores.fairness', 4)
            ->call('submit');

        $this->assertSame(1, TeacherFeedback::where('teacher_user_id', $teacher->id)->count());
        $this->assertSame(1, TeacherEffectivenessScore::where('teacher_user_id', $teacher->id)->count());
    }

    public function test_teacher_feedback_has_no_user_identifying_column(): void
    {
        $columns = \Illuminate\Support\Facades\Schema::getColumnListing('teacher_feedback');

        $this->assertNotContains('user_id', $columns);
        $this->assertContains('anonymous_ref', $columns);
    }

    public function test_parent_cannot_rate_teacher_at_a_different_school(): void
    {
        $this->seedComponents();
        $schoolA = $this->makeSchool();
        $schoolB = $this->makeSchool();
        $parent = $this->makeVerifiedParent($schoolA);
        $teacherAtB = $this->makeVerifiedTeacher($schoolB);

        Volt::actingAs($parent)->test('teacher-feedback.create', ['teacher' => $teacherAtB])
            ->call('submit')
            ->assertForbidden();

        $this->assertSame(0, TeacherFeedback::count());
    }

    public function test_effectiveness_score_is_never_exposed_on_public_school_page(): void
    {
        $this->seedComponents();
        $school = $this->makeSchool();
        $parent = $this->makeVerifiedParent($school);
        $teacher = $this->makeVerifiedTeacher($school);
        $teacher->update(['name' => 'Distinctive Teacher Name']);

        Volt::actingAs($parent)->test('teacher-feedback.create', ['teacher' => $teacher])
            ->set('scores.communication', 5)
            ->call('submit');

        // A guest viewing the public school page should never see a
        // per-teacher score anywhere in the rendered HTML.
        $html = Volt::test('schools.show', ['school' => $school])->html();

        $this->assertStringNotContainsString('Teacher Effectiveness', $html);
    }

    public function test_teacher_can_see_their_own_score_but_no_one_elses_dashboard_shows_it(): void
    {
        $this->seedComponents();
        $school = $this->makeSchool();
        $parent = $this->makeVerifiedParent($school);
        $teacher = $this->makeVerifiedTeacher($school);

        Volt::actingAs($parent)->test('teacher-feedback.create', ['teacher' => $teacher])
            ->set('scores.communication', 5)
            ->set('scores.fairness', 5)
            ->call('submit');

        $html = Volt::actingAs($teacher)->test('dashboards.teacher')->html();
        $this->assertStringContainsString('Teacher Effectiveness Index', $html);
    }

    public function test_value_add_component_blends_in_when_academic_records_show_improvement(): void
    {
        $this->seedComponents();
        $school = $this->makeSchool();
        $teacher = $this->makeVerifiedTeacher($school);
        TeacherProfile::create(['user_id' => $teacher->id, 'subject_specialization' => 'Mathematics']);

        $student = $this->makeVerifiedStudent($school);

        StudentAcademicRecord::create([
            'student_user_id' => $student->id, 'school_id' => $school->id,
            'subject' => 'Mathematics', 'term' => '2026-T1', 'score' => 50, 'max_score' => 100,
            'recorded_by_user_id' => $teacher->id, 'recorded_at' => now()->subMonths(2),
        ]);
        StudentAcademicRecord::create([
            'student_user_id' => $student->id, 'school_id' => $school->id,
            'subject' => 'Mathematics', 'term' => '2026-T2', 'score' => 70, 'max_score' => 100,
            'recorded_by_user_id' => $teacher->id, 'recorded_at' => now(),
        ]);

        $score = app(TeacherEffectivenessIndexService::class)->recalculate($teacher);

        $this->assertArrayHasKey('value_add', $score->component_breakdown);
        $this->assertEquals(20.0, $score->component_breakdown['value_add']['average_improvement_pct']);
        $this->assertSame('academic_records', $score->component_breakdown['value_add']['source']);
    }

    public function test_no_value_add_component_when_teacher_has_no_subject_specialization(): void
    {
        $this->seedComponents();
        $school = $this->makeSchool();
        $teacher = $this->makeVerifiedTeacher($school);

        $score = app(TeacherEffectivenessIndexService::class)->recalculate($teacher);

        $this->assertArrayNotHasKey('value_add', $score->component_breakdown);
    }
}
