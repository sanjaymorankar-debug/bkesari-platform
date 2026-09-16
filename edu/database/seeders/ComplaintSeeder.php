<?php

namespace Database\Seeders;

use App\Models\Complaint;
use App\Models\ComplaintCategory;
use App\Models\ComplaintResolution;
use App\Models\ComplaintResponse;
use App\Models\ParentSchoolRelationship;
use App\Models\StudentSchoolRelationship;
use Illuminate\Database\Seeder;

/**
 * Every complaint is created via the same anonymization path the real
 * submission flow uses (User::anonymousRefFor) — no user_id is ever stored
 * on the complaint itself.
 */
class ComplaintSeeder extends Seeder
{
    public function run(): void
    {
        $categories = ComplaintCategory::all();
        $parentRelations = ParentSchoolRelationship::where('status', 'verified')->with(['user', 'school.state', 'school.district'])->get();
        $studentRelations = StudentSchoolRelationship::where('status', 'verified')->with(['user', 'school.state', 'school.district'])->get();

        $subjects = [
            'Fee receipt not issued after payment',
            'Teacher frequently absent without substitute',
            'Playground equipment unsafe',
            'Uniform vendor overcharging',
            'Bus arrives consistently late',
            'Classroom overcrowding affecting learning',
            'Canteen food quality concerns',
            'Homework load excessive for grade level',
            'Communication from school delayed/unclear',
            'Sports facilities in poor condition',
        ];

        for ($i = 0; $i < 100; $i++) {
            $useParent = fake()->boolean(60) && $parentRelations->isNotEmpty();
            $relation = $useParent ? $parentRelations->random() : $studentRelations->random();
            $school = $relation->school;
            $category = $categories->random();

            $anonymousRef = $relation->user->anonymousRefFor($school, $useParent ? 'parent' : 'student');

            $status = fake()->randomElement([
                'submitted', 'under_review', 'school_responded', 'investigating',
                'action_taken', 'resolved', 'resolved', 'closed',
            ]);

            $complaint = Complaint::create([
                'complaint_number' => Complaint::generateComplaintNumber($school->state, $school->district),
                'school_id' => $school->id,
                'complaint_category_id' => $category->id,
                'district_id' => $school->district_id,
                'state_id' => $school->state_id,
                'anonymous_ref' => $anonymousRef,
                'submitted_role' => $useParent ? 'parent' : 'student',
                'subject' => fake()->randomElement($subjects),
                'description' => fake()->paragraph(3),
                'severity' => fake()->randomElement(['low', 'medium', 'medium', 'high', 'critical']),
                'status' => $status,
                'is_child_safety_flag' => $category->is_child_safety && fake()->boolean(30),
                'resolved_at' => in_array($status, ['resolved', 'closed'], true) ? now()->subDays(fake()->numberBetween(1, 60)) : null,
            ]);

            $complaint->statusHistory()->create([
                'from_status' => null,
                'to_status' => 'submitted',
                'changed_by_user_id' => null,
                'note' => 'Complaint submitted.',
            ]);

            if (in_array($status, ['school_responded', 'investigating', 'action_taken', 'resolved', 'closed'], true)) {
                $schoolAdmin = $school->staff()->first();
                ComplaintResponse::create([
                    'complaint_id' => $complaint->id,
                    'responder_type' => 'school',
                    'responder_user_id' => $schoolAdmin?->user_id,
                    'message' => fake()->paragraph(2),
                ]);
                $complaint->statusHistory()->create([
                    'from_status' => 'submitted',
                    'to_status' => 'school_responded',
                    'changed_by_user_id' => $schoolAdmin?->user_id,
                ]);
            }

            if (in_array($status, ['resolved', 'closed'], true)) {
                ComplaintResolution::create([
                    'complaint_id' => $complaint->id,
                    'resolution_summary' => fake()->sentence(12),
                    'confirmed_by_submitter' => fake()->randomElement(['yes', 'yes', 'partially', 'no']),
                    'confirmed_at' => now()->subDays(fake()->numberBetween(1, 30)),
                ]);
            }
        }
    }
}
