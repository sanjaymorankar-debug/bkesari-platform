<?php

namespace Tests\Feature\Platform;

use App\Models\Course;
use App\Models\CourseRating;
use App\Models\School;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;
use Livewire\Volt\Volt;
use Tests\Feature\Platform\Concerns\SetsUpPlatformData;
use Tests\TestCase;

/**
 * Spec section 12 — course and curriculum ratings.
 */
class CourseRatingTest extends TestCase
{
    use RefreshDatabase, SetsUpPlatformData;

    private const YEAR = '2026-27';

    private function course(School $school, User $admin, string $name = 'Physics'): Course
    {
        return Course::create([
            'school_id' => $school->id,
            'academic_year' => self::YEAR,
            'name' => $name,
            'course_type' => 'core_subject',
            'recorded_by_user_id' => $admin->id,
        ]);
    }

    public function test_a_student_is_asked_every_dimension(): void
    {
        $school = $this->makeSchool();
        $this->course($school, $this->makeSchoolAdmin($school));
        $student = $this->makeVerifiedStudent($school);

        $component = Volt::actingAs($student)->test('courses.rate', ['school' => $school])->assertOk();

        foreach (CourseRating::DIMENSIONS as $label) {
            $component->assertSee($label);
        }
    }

    /**
     * A parent rarely sees project work or classroom resources first-hand.
     * Asking anyway would manufacture data.
     */
    public function test_a_parent_is_asked_only_what_they_can_judge(): void
    {
        $school = $this->makeSchool();
        $this->course($school, $this->makeSchoolAdmin($school));
        $parent = $this->makeVerifiedParent($school);

        $component = Volt::actingAs($parent)->test('courses.rate', ['school' => $school])->assertOk();

        $component->assertSee(CourseRating::DIMENSIONS['teaching_quality']);
        $component->assertDontSee(CourseRating::DIMENSIONS['project_work']);
        $component->assertDontSee(CourseRating::DIMENSIONS['practical_learning']);
    }

    /** A dimension a parent was never shown must stay null, not become a guess. */
    public function test_dimensions_a_parent_was_not_shown_stay_null(): void
    {
        $school = $this->makeSchool();
        $course = $this->course($school, $this->makeSchoolAdmin($school));
        $parent = $this->makeVerifiedParent($school);

        Volt::actingAs($parent)->test('courses.rate', ['school' => $school])
            ->set('courseId', (string) $course->id)
            ->set('scores.teaching_quality', '4')
            // Even if a value is somehow set for a hidden dimension, it must
            // not be written.
            ->set('scores.project_work', '5')
            ->call('submit');

        $rating = CourseRating::first();

        $this->assertSame(4, $rating->teaching_quality);
        $this->assertNull($rating->project_work);
    }

    public function test_a_student_can_rate_every_dimension(): void
    {
        $school = $this->makeSchool();
        $course = $this->course($school, $this->makeSchoolAdmin($school));
        $student = $this->makeVerifiedStudent($school);

        Volt::actingAs($student)->test('courses.rate', ['school' => $school])
            ->set('courseId', (string) $course->id)
            ->set('scores.project_work', '3')
            ->set('scores.practical_learning', '2')
            ->call('submit');

        $rating = CourseRating::first();

        $this->assertSame(3, $rating->project_work);
        $this->assertSame(2, $rating->practical_learning);
    }

    public function test_blank_dimensions_are_stored_as_null_rather_than_zero(): void
    {
        $school = $this->makeSchool();
        $course = $this->course($school, $this->makeSchoolAdmin($school));
        $student = $this->makeVerifiedStudent($school);

        Volt::actingAs($student)->test('courses.rate', ['school' => $school])
            ->set('courseId', (string) $course->id)
            ->set('scores.course_quality', '5')
            ->call('submit');

        $rating = CourseRating::first();

        $this->assertSame(5, $rating->course_quality);
        $this->assertNull($rating->engagement, 'A blank must not become a zero — it would drag the average down.');
    }

    /**
     * Each dimension carries its own response count, because they differ. A
     * single blended average would hide a thin one.
     */
    public function test_averages_report_a_response_count_per_dimension(): void
    {
        $school = $this->makeSchool();
        $course = $this->course($school, $admin = $this->makeSchoolAdmin($school));

        foreach ([[5, 5], [3, null], [4, null]] as $i => [$quality, $projects]) {
            CourseRating::create([
                'course_id' => $course->id,
                'school_id' => $school->id,
                'academic_year' => self::YEAR,
                'anonymous_ref' => 'ANON-'.$i,
                'rater_role' => 'student',
                'course_quality' => $quality,
                'project_work' => $projects,
                'submitted_at' => now(),
            ]);
        }

        $averages = CourseRating::averages(CourseRating::all());

        $this->assertSame(4.0, $averages['course_quality']['average']);
        $this->assertSame(3, $averages['course_quality']['responses']);

        $this->assertSame(5.0, $averages['project_work']['average']);
        $this->assertSame(1, $averages['project_work']['responses']);

        $this->assertNull($averages['engagement']['average']);
        $this->assertSame(0, $averages['engagement']['responses']);
    }

    public function test_resubmitting_updates_rather_than_stacking(): void
    {
        $school = $this->makeSchool();
        $course = $this->course($school, $this->makeSchoolAdmin($school));
        $student = $this->makeVerifiedStudent($school);

        foreach (['2', '5'] as $score) {
            Volt::actingAs($student)->test('courses.rate', ['school' => $school])
                ->set('courseId', (string) $course->id)
                ->set('scores.course_quality', $score)
                ->call('submit');
        }

        $this->assertSame(1, CourseRating::count());
        $this->assertSame(5, CourseRating::first()->course_quality);
    }

    /** Spec section 26 — the ratings table must not identify anyone. */
    public function test_course_ratings_carry_no_user_identifying_column(): void
    {
        $columns = Schema::getColumnListing('course_ratings');

        foreach (['user_id', 'email', 'name', 'student_user_id'] as $forbidden) {
            $this->assertNotContains($forbidden, $columns);
        }

        $this->assertContains('anonymous_ref', $columns);
    }

    public function test_an_outsider_cannot_rate_this_schools_courses(): void
    {
        $school = $this->makeSchool();
        $outsider = $this->makeVerifiedParent($this->makeSchool());

        Volt::actingAs($outsider)->test('courses.rate', ['school' => $school])
            ->assertForbidden();
    }

    public function test_a_course_the_school_never_listed_cannot_be_rated(): void
    {
        $school = $this->makeSchool();
        $this->course($school, $this->makeSchoolAdmin($school));
        $otherCourse = $this->course($this->makeSchool(), $this->makeSchoolAdmin($this->makeSchool()), 'Chemistry');
        $student = $this->makeVerifiedStudent($school);

        Volt::actingAs($student)->test('courses.rate', ['school' => $school])
            ->set('courseId', (string) $otherCourse->id)
            ->set('scores.course_quality', '5')
            ->call('submit')
            ->assertStatus(422);

        $this->assertSame(0, CourseRating::count());
    }

    public function test_the_school_sees_per_dimension_averages_with_counts(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);
        $course = $this->course($school, $admin);

        CourseRating::create([
            'course_id' => $course->id,
            'school_id' => $school->id,
            'academic_year' => self::YEAR,
            'anonymous_ref' => 'ANON-A',
            'rater_role' => 'student',
            'practical_learning' => 2,
            'submitted_at' => now(),
        ]);

        Volt::actingAs($admin)->test('courses.manage', ['school' => $school])
            ->set('academicYear', self::YEAR)
            ->assertOk()
            ->assertSee('Physics')
            ->assertSee('Practical, hands-on learning')
            // The framing: a count sits beside every average.
            ->assertSee('A low score from three people is a different');
    }

    public function test_the_public_profile_shows_per_dimension_averages_with_counts(): void
    {
        $school = $this->makeSchool();
        $course = $this->course($school, $this->makeSchoolAdmin($school));

        CourseRating::create([
            'course_id' => $course->id,
            'school_id' => $school->id,
            'academic_year' => self::YEAR,
            'anonymous_ref' => 'ANON-A',
            'rater_role' => 'student',
            'teaching_quality' => 4,
            'submitted_at' => now(),
        ]);

        Volt::test('schools.show', ['school' => $school])
            ->assertOk()
            ->assertSee('Courses')
            ->assertSee('Physics')
            ->assertSee('Teaching quality')
            ->assertSee('parents are only asked about things');
    }

    public function test_a_course_with_no_ratings_says_so_on_the_public_profile(): void
    {
        $school = $this->makeSchool();
        $this->course($school, $this->makeSchoolAdmin($school));

        Volt::test('schools.show', ['school' => $school])
            ->assertOk()
            ->assertSee('Physics')
            ->assertSee('No ratings yet');
    }

    public function test_another_schools_admin_cannot_manage_these_courses(): void
    {
        $school = $this->makeSchool();
        $otherAdmin = $this->makeSchoolAdmin($this->makeSchool());

        Volt::actingAs($otherAdmin)->test('courses.manage', ['school' => $school])
            ->assertForbidden();
    }

    public function test_a_duplicate_course_is_not_added_twice(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);

        $component = Volt::actingAs($admin)->test('courses.manage', ['school' => $school])
            ->set('academicYear', self::YEAR);

        $component->set('name', 'Physics')->call('addCourse');
        $component->set('name', 'Physics')->call('addCourse');

        $this->assertSame(1, Course::count());
    }
}
