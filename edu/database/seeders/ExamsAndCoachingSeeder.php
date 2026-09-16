<?php

namespace Database\Seeders;

use App\Models\CoachingProgramme;
use App\Models\ExternalExam;
use App\Models\School;
use App\Models\SchoolStaff;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

/**
 * Demo exams and coaching (spec section 10).
 *
 * The first school gets one compulsory, separately-billed coaching programme
 * so the "not included in the figures above" panel on the public profile has
 * something real to show — that interaction between sections 9 and 10 is the
 * whole reason this module is worth having.
 */
class ExamsAndCoachingSeeder extends Seeder
{
    use WithoutModelEvents;

    private const YEAR = '2026-27';

    public function run(): void
    {
        $schools = School::orderBy('id')->limit(4)->get();

        foreach ($schools as $index => $school) {
            $recorder = SchoolStaff::where('school_id', $school->id)->value('user_id');

            if (! $recorder) {
                continue;
            }

            foreach ([
                ['National Science Olympiad', 'Science Olympiad Foundation', 'olympiad', 250, true, 1500, false],
                ['National Talent Search Exam', 'NCERT', 'scholarship', 300, false, null, false],
                ['Cambridge English: Key', 'Cambridge Assessment', 'language', 3500, true, 4000, false],
            ] as $i => [$name, $body, $type, $fee, $prep, $prepFee, $mandatory]) {
                if ($i > $index) {
                    continue;
                }

                ExternalExam::create([
                    'school_id' => $school->id,
                    'academic_year' => self::YEAR,
                    'exam_name' => $name,
                    'conducting_body' => $body,
                    'exam_type' => $type,
                    'applicable_classes' => '6-10',
                    'through_school' => true,
                    'exam_fee' => $fee,
                    'preparation_offered' => $prep,
                    'preparation_fee' => $prepFee,
                    'is_mandatory' => $mandatory,
                    'recorded_by_user_id' => $recorder,
                ]);
            }

            if ($index === 0) {
                // The case the module exists for: compulsory, and billed
                // outside the published fees.
                CoachingProgramme::create([
                    'school_id' => $school->id,
                    'academic_year' => self::YEAR,
                    'programme_name' => 'JEE/NEET Foundation (Classes 11-12)',
                    'programme_type' => 'jee',
                    'provider_type' => 'external_partner',
                    'provider_name' => 'Partner coaching institute',
                    'applicable_classes' => '11-12',
                    'timing' => '2:30-4:30pm, Mon-Fri',
                    'during_school_hours' => true,
                    'fee' => 48000,
                    'bundled_into_school_fees' => false,
                    'is_mandatory' => true,
                    'recorded_by_user_id' => $recorder,
                ]);
            }

            CoachingProgramme::create([
                'school_id' => $school->id,
                'academic_year' => self::YEAR,
                'programme_name' => 'Coding & robotics club',
                'programme_type' => 'coding',
                'provider_type' => 'school',
                'applicable_classes' => '6-10',
                'timing' => 'After school, twice a week',
                'fee' => 6000,
                'bundled_into_school_fees' => false,
                'is_mandatory' => false,
                'certification_offered' => true,
                'recorded_by_user_id' => $recorder,
            ]);
        }
    }
}
