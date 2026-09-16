<?php

namespace Database\Seeders;

use App\Models\ParentSchoolRelationship;
use App\Models\School;
use App\Models\SchoolFeedback;
use App\Models\SchoolRatingComponent;
use App\Models\StudentSchoolRelationship;
use App\Services\SchoolQualityIndexService;
use Illuminate\Database\Seeder;

class FeedbackSeeder extends Seeder
{
    public function run(): void
    {
        $componentKeys = SchoolRatingComponent::pluck('key');
        $parentRelations = ParentSchoolRelationship::where('status', 'verified')->with(['user', 'school'])->get();
        $studentRelations = StudentSchoolRelationship::where('status', 'verified')->with(['user', 'school'])->get();

        foreach ($parentRelations as $relation) {
            $this->createFeedback($relation->user, $relation->school, 'parent', $componentKeys);
        }

        foreach ($studentRelations->random(min(60, $studentRelations->count())) as $relation) {
            $this->createFeedback($relation->user, $relation->school, 'student', $componentKeys);
        }

        $sqiService = app(SchoolQualityIndexService::class);
        foreach (School::all() as $school) {
            $sqiService->recalculate($school);
        }
    }

    private function createFeedback($user, School $school, string $role, $componentKeys): void
    {
        $anonymousRef = $user->anonymousRefFor($school, $role);

        $scores = [];
        foreach ($componentKeys as $key) {
            $scores[$key] = fake()->numberBetween(2, 5);
        }

        SchoolFeedback::create([
            'school_id' => $school->id,
            'anonymous_ref' => $anonymousRef,
            'rater_role' => $role,
            'dimension_scores' => $scores,
            'overall_comment' => fake()->boolean(50) ? fake()->sentence(15) : null,
            'submitted_at' => now()->subDays(fake()->numberBetween(0, 365)),
        ]);
    }
}
