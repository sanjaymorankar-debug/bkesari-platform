<?php

namespace Database\Seeders;

use App\Models\ComplaintCategory;
use Illuminate\Database\Seeder;
use Illuminate\Support\Str;

class ComplaintCategorySeeder extends Seeder
{
    public function run(): void
    {
        $categories = [
            'Teaching', 'Teacher Behaviour', 'Fees', 'Books', 'Uniform', 'Stationery',
            'Transport', 'Infrastructure', 'Safety', 'Bullying', 'Harassment',
            'Discrimination', 'Food', 'Hygiene', 'Sports', 'Counselling',
            'Special Needs', 'Attendance', 'Communication', 'Management',
            'Career Guidance', 'Other',
        ];

        $childSafety = ['Safety', 'Bullying', 'Harassment', 'Discrimination'];

        foreach ($categories as $name) {
            ComplaintCategory::firstOrCreate(
                ['slug' => Str::slug($name)],
                ['name' => $name, 'is_child_safety' => in_array($name, $childSafety, true)]
            );
        }
    }
}
