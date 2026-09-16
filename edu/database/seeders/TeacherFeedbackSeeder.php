<?php

namespace Database\Seeders;

use App\Models\TeacherFeedback;
use App\Models\TeacherRatingComponent;
use App\Models\TeacherSchoolRelationship;
use App\Services\TeacherEffectivenessIndexService;
use Illuminate\Database\Seeder;

class TeacherFeedbackSeeder extends Seeder
{
    public function run(): void
    {
        $componentKeys = TeacherRatingComponent::pluck('key');
        $teacherRelations = TeacherSchoolRelationship::where('status', 'verified')->with(['user', 'school'])->get();

        // Reuse a handful of already-verified parents/students as raters —
        // simplest way to get a legitimately anonymized rater for each
        // teacher without inventing a parallel population.
        $raters = \App\Models\ParentSchoolRelationship::where('status', 'verified')->with('user')->get();

        if ($raters->isEmpty() || $teacherRelations->isEmpty()) {
            return;
        }

        foreach ($teacherRelations as $relation) {
            foreach ($raters->random(min(15, $raters->count())) as $rater) {
                $anonymousRef = $rater->user->anonymousRefFor($relation->school, 'parent');

                $scores = [];
                foreach ($componentKeys as $key) {
                    $scores[$key] = fake()->numberBetween(2, 5);
                }

                TeacherFeedback::create([
                    'teacher_user_id' => $relation->user_id,
                    'school_id' => $relation->school_id,
                    'anonymous_ref' => $anonymousRef,
                    'rater_role' => 'parent',
                    'dimension_scores' => $scores,
                    'overall_comment' => fake()->boolean(40) ? fake()->sentence(12) : null,
                    'submitted_at' => now()->subDays(fake()->numberBetween(0, 200)),
                ]);
            }
        }

        $service = app(TeacherEffectivenessIndexService::class);
        foreach ($teacherRelations->pluck('user')->unique('id') as $teacher) {
            $service->recalculate($teacher);
        }
    }
}
