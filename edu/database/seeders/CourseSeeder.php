<?php

namespace Database\Seeders;

use App\Models\AnonymousIdentity;
use App\Models\Course;
use App\Models\CourseRating;
use App\Models\School;
use App\Models\SchoolStaff;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

/**
 * Demo courses and ratings (spec section 12).
 *
 * Ratings are seeded unevenly on purpose: some dimensions get many responses
 * and some get few, because that unevenness is the thing the per-dimension
 * response count exists to show. A demo where every dimension has the same
 * count would make the count look decorative.
 */
class CourseSeeder extends Seeder
{
    use WithoutModelEvents;

    private const YEAR = '2026-27';

    private const COURSES = [
        ['Physics', 'core_subject', '11-12', 'Science'],
        ['Mathematics', 'core_subject', '9-12', null],
        ['English', 'core_subject', '6-12', null],
        ['Computer Science', 'elective', '9-12', 'Science'],
        ['Commerce Stream', 'stream', '11-12', 'Commerce'],
    ];

    public function run(): void
    {
        $school = School::orderBy('id')->first();

        if (! $school) {
            return;
        }

        $recorder = SchoolStaff::where('school_id', $school->id)->value('user_id');

        if (! $recorder) {
            return;
        }

        foreach (self::COURSES as $index => [$name, $type, $classes, $stream]) {
            $course = Course::create([
                'school_id' => $school->id,
                'academic_year' => self::YEAR,
                'name' => $name,
                'course_type' => $type,
                'applicable_classes' => $classes,
                'stream' => $stream,
                'recorded_by_user_id' => $recorder,
            ]);

            // The last course gets none, so the "no ratings yet" state is
            // visible in the demo too.
            if ($index === count(self::COURSES) - 1) {
                continue;
            }

            $studentCount = [8, 6, 5, 3][$index] ?? 3;
            $parentCount = [4, 3, 2, 1][$index] ?? 1;

            for ($i = 0; $i < $studentCount; $i++) {
                CourseRating::create([
                    'course_id' => $course->id,
                    'school_id' => $school->id,
                    'academic_year' => self::YEAR,
                    'anonymous_ref' => AnonymousIdentity::generateRef(),
                    'rater_role' => 'student',
                    'curriculum_relevance' => random_int(3, 5),
                    'course_quality' => random_int(3, 5),
                    'conceptual_learning' => random_int(3, 5),
                    // Practical learning deliberately rates lower on Physics —
                    // a realistic pattern, and the kind of gap a single
                    // blended score would bury.
                    'practical_learning' => $index === 0 ? random_int(1, 3) : random_int(3, 5),
                    'project_work' => random_int(2, 5),
                    'learning_resources' => random_int(3, 5),
                    'teaching_quality' => random_int(3, 5),
                    'course_organisation' => random_int(3, 5),
                    'engagement' => random_int(2, 5),
                    'career_relevance' => random_int(3, 5),
                    'submitted_at' => now()->subDays(random_int(5, 120)),
                ]);
            }

            // Parents answer only the subset they can judge, so those
            // dimensions carry a higher response count than the rest.
            for ($i = 0; $i < $parentCount; $i++) {
                CourseRating::create([
                    'course_id' => $course->id,
                    'school_id' => $school->id,
                    'academic_year' => self::YEAR,
                    'anonymous_ref' => AnonymousIdentity::generateRef(),
                    'rater_role' => 'parent',
                    'curriculum_relevance' => random_int(3, 5),
                    'course_quality' => random_int(3, 5),
                    'teaching_quality' => random_int(3, 5),
                    'course_organisation' => random_int(3, 5),
                    'engagement' => random_int(3, 5),
                    'career_relevance' => random_int(3, 5),
                    'submitted_at' => now()->subDays(random_int(5, 120)),
                ]);
            }
        }
    }
}
