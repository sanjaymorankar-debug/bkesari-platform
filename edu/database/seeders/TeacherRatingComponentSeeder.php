<?php

namespace Database\Seeders;

use App\Models\TeacherRatingComponent;
use Illuminate\Database\Seeder;

class TeacherRatingComponentSeeder extends Seeder
{
    public function run(): void
    {
        $dimensions = [
            'subject_knowledge' => 'Subject Knowledge',
            'explanation' => 'Explanation',
            'communication' => 'Communication',
            'engagement' => 'Engagement',
            'fairness' => 'Fairness',
            'classroom_management' => 'Classroom Management',
            'individual_attention' => 'Individual Attention',
            'practical_learning' => 'Practical Learning',
            'feedback' => 'Feedback',
            'homework' => 'Homework',
            'student_support' => 'Student Support',
            'punctuality' => 'Punctuality',
        ];

        foreach ($dimensions as $key => $label) {
            TeacherRatingComponent::firstOrCreate(['key' => $key], ['label' => $label, 'weight' => 8.33]);
        }
    }
}
