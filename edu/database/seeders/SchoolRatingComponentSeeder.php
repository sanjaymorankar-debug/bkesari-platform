<?php

namespace Database\Seeders;

use App\Models\SchoolRatingComponent;
use Illuminate\Database\Seeder;

class SchoolRatingComponentSeeder extends Seeder
{
    public function run(): void
    {
        $dimensions = [
            'teaching_learning' => 'Teaching & Learning',
            'teacher_quality' => 'Teacher Quality',
            'student_development' => 'Student Development',
            'safety_wellbeing' => 'Safety & Wellbeing',
            'parent_experience' => 'Parent Experience',
            'transparency' => 'Transparency',
            'infrastructure' => 'Infrastructure',
            'sports_activities' => 'Sports & Activities',
            'career_guidance' => 'Career Guidance',
            'complaint_resolution' => 'Complaint Resolution',
        ];

        foreach ($dimensions as $key => $label) {
            SchoolRatingComponent::firstOrCreate(['key' => $key], ['label' => $label, 'weight' => 10.00]);
        }
    }
}
