<?php

namespace Database\Seeders;

use App\Models\ParentSchoolRelationship;
use App\Models\RetaliationReport;
use App\Models\StudentSchoolRelationship;
use Illuminate\Database\Seeder;

class RetaliationReportSeeder extends Seeder
{
    public function run(): void
    {
        $parentRelations = ParentSchoolRelationship::where('status', 'verified')->with(['user', 'school'])->get();
        $studentRelations = StudentSchoolRelationship::where('status', 'verified')->with(['user', 'school'])->get();

        if ($parentRelations->isEmpty()) {
            return;
        }

        $categories = ['intimidation', 'harassment', 'discrimination', 'punishment', 'academic_retaliation', 'threats', 'withdrawal_of_facilities', 'other'];
        $statuses = ['submitted', 'under_review', 'investigating', 'action_taken', 'resolved'];

        for ($i = 0; $i < 8; $i++) {
            $useParent = fake()->boolean(60);
            $relation = $useParent ? $parentRelations->random() : $studentRelations->random();
            $school = $relation->school;

            $anonymousRef = $relation->user->anonymousRefFor($school, $useParent ? 'parent' : 'student');
            $status = fake()->randomElement($statuses);

            RetaliationReport::create([
                'school_id' => $school->id,
                'district_id' => $school->district_id,
                'state_id' => $school->state_id,
                'anonymous_ref' => $anonymousRef,
                'submitted_role' => $useParent ? 'parent' : 'student',
                'category' => fake()->randomElement($categories),
                'description' => fake()->paragraph(3),
                'status' => $status,
                'resolved_at' => $status === 'resolved' ? now()->subDays(fake()->numberBetween(1, 20)) : null,
            ]);
        }
    }
}
