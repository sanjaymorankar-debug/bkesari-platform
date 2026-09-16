<?php

namespace Database\Seeders;

use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    public function run(): void
    {
        // Wrapped in one transaction: on SQLite each statement otherwise
        // fsyncs individually, which turns ~1,500 seed inserts into
        // several minutes of wall-clock time.
        DB::transaction(function () {
            $this->call([
                RolesAndPermissionsSeeder::class,
                LocationSeeder::class,
                ComplaintCategorySeeder::class,
                SchoolRatingComponentSeeder::class,
                TeacherRatingComponentSeeder::class,
                SchoolSeeder::class,
                UserSeeder::class,
                ComplaintSeeder::class,
                FeedbackSeeder::class,
                TeacherFeedbackSeeder::class,
                RetaliationReportSeeder::class,
                StudentGrowthSeeder::class,
                FeeSeeder::class,
                FacilitySeeder::class,
                SafeguardingSeeder::class,
                ExamsAndCoachingSeeder::class,
                CourseSeeder::class,
                HealthSeeder::class,
                BenchmarkReferenceSeeder::class,
            ]);
        });
    }
}
