<?php

namespace Database\Seeders;

use App\Models\District;
use App\Models\School;
use App\Models\SchoolProfile;
use Illuminate\Database\Seeder;
use Illuminate\Support\Str;

class SchoolSeeder extends Seeder
{
    public function run(): void
    {
        $boards = ['CBSE', 'ICSE', 'STATE', 'IB'];
        $management = ['government', 'aided', 'private', 'international'];
        $districts = District::with('state')->get();

        $namePrefixes = ['Sunrise', 'Greenwood', 'National', 'St. Xavier', 'Delhi Public', 'Modern',
            'Bright Future', 'Kendriya Vidyalaya', 'Ryan International', 'City'];
        $nameSuffixes = ['Public School', 'High School', 'International School', 'Academy', "Children's School"];

        $count = 0;
        foreach ($districts as $district) {
            for ($i = 0; $i < 4; $i++) {
                $count++;
                $name = $namePrefixes[array_rand($namePrefixes)].' '.$nameSuffixes[array_rand($nameSuffixes)];

                $school = School::create([
                    'school_code' => 'SCH-'.strtoupper($district->code).'-'.str_pad((string) $i + 1, 3, '0', STR_PAD_LEFT),
                    'name' => $name,
                    'board' => $boards[array_rand($boards)],
                    'management_type' => $management[array_rand($management)],
                    'state_id' => $district->state_id,
                    'district_id' => $district->id,
                    'address' => fake()->streetAddress(),
                    'city' => $district->name,
                    'pincode' => (string) fake()->numberBetween(100000, 999999),
                    'phone' => fake()->numerify('##########'),
                    'email' => Str::slug($name).$count.'@example-schools.test',
                    'recognition_status' => fake()->randomElement(['verified', 'verified', 'verified', 'pending', 'under_review']),
                    'classes_from' => 'Nursery',
                    'classes_to' => 'Class 12',
                    'student_count' => fake()->numberBetween(200, 2000),
                    'teacher_count' => fake()->numberBetween(15, 120),
                    'established_year' => fake()->numberBetween(1960, 2018),
                ]);

                SchoolProfile::create([
                    'school_id' => $school->id,
                    'about' => fake()->paragraph(4),
                    'facilities' => fake()->randomElements(
                        ['Library', 'Science Labs', 'Computer Lab', 'Auditorium', 'Playground', 'Swimming Pool', 'Medical Room'],
                        fake()->numberBetween(3, 6)
                    ),
                    'sports' => fake()->randomElements(
                        ['Cricket', 'Football', 'Basketball', 'Athletics', 'Badminton', 'Swimming'],
                        fake()->numberBetween(2, 5)
                    ),
                    'fees' => ['annual_min' => fake()->numberBetween(15000, 40000), 'annual_max' => fake()->numberBetween(60000, 250000)],
                    'has_transport' => fake()->boolean(70),
                    'has_hostel' => fake()->boolean(20),
                ]);
            }
        }
    }
}
