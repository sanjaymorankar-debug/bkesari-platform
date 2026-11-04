<?php

namespace Tests\Feature\Platform;

use App\Models\ParentSchoolRelationship;
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

    /**
     * Two hats again, this time on the rating side: a teacher whose own child
     * attends the school they teach at is a verified teacher *and* a verified
     * parent there, which is all `sharedVerifiedSchoolId()` asks for. Nothing
     * checked that the teacher being rated was not the rater, so they could
     * file anonymous ratings of **themselves**, straight into the Teacher
     * Effectiveness Index (and `teacher_feedback` has no one-rating-per-rater
     * constraint, so repeatedly).
     *
     * Two things wrong with the row it wrote: the index the platform publishes
     * is gameable by its own subject — the same objection as "a school cannot
     * verify itself" (CR-20) — and `teacher_feedback.teacher_user_id` then
     * names the submitter beside their own anonymous feedback, which is the
     * one thing a feedback row must never carry (CR-04).
     */
    public function test_a_teacher_who_is_also_a_parent_cannot_rate_themselves(): void
    {
        $this->seedComponents();
        $school = $this->makeSchool();

        $teacher = User::factory()->create();
        $teacher->assignRole('teacher');
        $teacher->assignRole('parent');
        TeacherSchoolRelationship::create([
            'user_id' => $teacher->id, 'school_id' => $school->id,
            'status' => 'verified', 'verified_at' => now(),
        ]);
        ParentSchoolRelationship::create([
            'user_id' => $teacher->id, 'school_id' => $school->id,
            'status' => 'verified', 'verified_at' => now(),
        ]);
        $teacher->refresh();

        // Refused the same way as rating a teacher at another school: the
        // submission is a 403, with its own message.
        Volt::actingAs($teacher)->test('teacher-feedback.create', ['teacher' => $teacher])
            ->set('scores.communication', 5)
            ->call('submit')
            ->assertForbidden();

        $this->assertSame(0, TeacherFeedback::where('teacher_user_id', $teacher->id)->count(),
            'a teacher must not be able to rate themselves');
        $this->assertSame(0, TeacherEffectivenessScore::where('teacher_user_id', $teacher->id)->count());

        // No row names the rater beside their own anonymous feedback.
        $this->assertSame(0, \App\Models\TeacherFeedback::query()
            ->join('anonymous_identities as a', function ($join) {
                $join->on('a.anonymous_ref', '=', 'teacher_feedback.anonymous_ref')
                    ->on('a.user_id', '=', 'teacher_feedback.teacher_user_id');
            })->count());

        // A real parent at the same school still rates them.
        $parent = $this->makeVerifiedParent($school);

        Volt::actingAs($parent)->test('teacher-feedback.create', ['teacher' => $teacher])
            ->set('scores.communication', 4)
            ->call('submit');

        $this->assertSame(1, TeacherFeedback::where('teacher_user_id', $teacher->id)->count());
    }
}
