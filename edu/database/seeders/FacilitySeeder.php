<?php

namespace Database\Seeders;

use App\Models\AnonymousIdentity;
use App\Models\FacilityClaim;
use App\Models\FacilityRating;
use App\Models\School;
use App\Models\SchoolStaff;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

/**
 * Demo facility claims and experience reports (spec sections 8, 11, 12).
 *
 * The first school is seeded so that every comparison state is visible at
 * once — a well-confirmed claim, a partly-confirmed one, a genuine reported
 * discrepancy, one with too few reports to call, and one with none — because
 * a demo where everything reads "consistent" hides exactly the case this
 * module exists for.
 */
class FacilitySeeder extends Seeder
{
    use WithoutModelEvents;

    private const YEAR = '2026-27';

    private const CLAIMS = [
        ['science_laboratory', 'Two equipped science labs used from Class 6 upward.', 'all_students'],
        ['computer_laboratory', '40-seat computer lab with broadband.', 'all_students'],
        ['library', 'Reference and lending library.', 'all_students'],
        ['swimming', 'On-site 25m pool.', 'selected_classes'],
        ['robotics', 'Robotics lab run with an external partner.', 'optional_enrolment'],
        ['football', 'Full-size ground and coaching.', 'all_students'],
        ['counselling', 'Visiting counsellor twice a week.', 'all_students'],
        ['transport', 'Bus routes across the city.', 'optional_enrolment'],
    ];

    /**
     * facility => list of availability reports to seed. Deliberately mixed.
     */
    private const REPORTS = [
        'science_laboratory' => ['available', 'available', 'available', 'available', 'partially_available'],
        'computer_laboratory' => ['available', 'available', 'available', 'available'],
        'library' => ['available', 'available', 'available'],
        // The case that matters: listed, but families say they cannot get to it.
        'swimming' => ['not_available', 'not_available', 'not_available', 'partially_available', 'not_available'],
        'robotics' => ['partially_available', 'partially_available', 'available', 'not_available'],
        // Too few to call either way.
        'football' => ['available', 'not_available'],
        // No reports at all.
        'counselling' => [],
        'transport' => ['available', 'available', 'partially_available'],
    ];

    public function run(): void
    {
        $school = School::orderBy('id')->first();

        if (! $school) {
            return;
        }

        $recorder = SchoolStaff::where('school_id', $school->id)->value('user_id');

        if (! $recorder) {
            return;
        }

        foreach (self::CLAIMS as [$key, $description, $availability]) {
            FacilityClaim::create([
                'school_id' => $school->id,
                'facility_key' => $key,
                'academic_year' => self::YEAR,
                'is_offered' => true,
                'description' => $description,
                'availability' => $availability,
                'recorded_by_user_id' => $recorder,
                // Only some claims have been through an evidence check — the
                // rest sit unverified, which is the honest default.
                'verification_status' => in_array($key, ['science_laboratory', 'library'], true)
                    ? 'verified'
                    : 'unverified',
            ]);
        }

        // Spec section 29 — the school's answer to the swimming discrepancy,
        // so the demo shows both sides rather than only the reports.
        \App\Models\SchoolReply::create([
            'school_id' => $school->id,
            'context_type' => 'facility_discrepancy',
            'context_key' => 'swimming',
            'academic_year' => self::YEAR,
            'body' => 'The pool closed in June for resurfacing after a leak and reopens in November. '
                .'Swimming lessons have moved to the municipal pool in the meantime, with transport provided. '
                .'We should have told families sooner and are sorry we did not.',
            'author_user_id' => $recorder,
        ]);

        // Reports come from synthetic pseudonyms rather than real accounts:
        // the ratings table only ever holds an anonymous_ref anyway, and this
        // keeps the demo from implying particular seeded families said these
        // things.
        // A previous year, deliberately worse, so the improvement dashboard
        // (spec section 31) has an actual trend to show rather than reading
        // "not enough years yet" everywhere. A school that started badly and
        // improved is the case that section exists to make visible.
        foreach (self::REPORTS as $facilityKey => $reports) {
            foreach ($reports as $index => $report) {
                FacilityRating::create([
                    'school_id' => $school->id,
                    'facility_key' => $facilityKey,
                    'academic_year' => '2025-26',
                    'anonymous_ref' => AnonymousIdentity::generateRef(),
                    'rater_role' => $index % 3 === 0 ? 'student' : 'parent',
                    // Downgrade last year's picture by one step.
                    'availability_report' => match ($report) {
                        'available' => 'partially_available',
                        'partially_available' => 'not_available',
                        default => 'not_available',
                    },
                    'quality' => random_int(1, 3),
                    'submitted_at' => now()->subYear(),
                ]);
            }
        }

        foreach (self::REPORTS as $facilityKey => $reports) {
            foreach ($reports as $index => $report) {
                FacilityRating::create([
                    'school_id' => $school->id,
                    'facility_key' => $facilityKey,
                    'academic_year' => self::YEAR,
                    'anonymous_ref' => AnonymousIdentity::generateRef(),
                    'rater_role' => $index % 3 === 0 ? 'student' : 'parent',
                    'availability_report' => $report,
                    'quality' => $report === 'not_available' ? null : random_int(3, 5),
                    'equipment' => $report === 'not_available' ? null : random_int(2, 5),
                    'usage_frequency' => $report === 'not_available' ? 1 : random_int(2, 5),
                    'staff_support' => $report === 'not_available' ? null : random_int(3, 5),
                    'overall_usefulness' => $report === 'not_available' ? null : random_int(3, 5),
                    'comment' => $facilityKey === 'swimming' && $report === 'not_available'
                        ? 'The pool has been closed for maintenance for most of the year.'
                        : null,
                    'submitted_at' => now()->subDays(random_int(5, 120)),
                ]);
            }
        }
    }
}
