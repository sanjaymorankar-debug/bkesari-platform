<?php

namespace Database\Seeders;

use App\Models\Fee;
use App\Models\FeeRevision;
use App\Models\School;
use App\Models\SchoolStaff;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

/**
 * Demo fee registers (spec section 9).
 *
 * Two years are seeded for each school so the year-on-year comparison has
 * something to show, and one mid-year increase is recorded through a
 * `fee_revisions` row so the change history isn't an empty panel.
 */
class FeeSeeder extends Seeder
{
    use WithoutModelEvents;

    /** [category, label, amount, frequency, mandatory] */
    private const TEMPLATE = [
        ['admission', 'Admission fee (one time)', 25000, 'one_time', true],
        ['registration', 'Registration', 2000, 'one_time', true],
        ['tuition', 'Tuition', 4500, 'monthly', true],
        ['annual', 'Annual charges', 12000, 'annual', true],
        ['development', 'Development fund', 8000, 'annual', true],
        ['examination', 'Examination fee', 1500, 'term', true],
        ['laboratory', 'Laboratory', 3000, 'annual', true],
        ['library', 'Library', 1200, 'annual', true],
        ['transport', 'School bus', 1800, 'monthly', false],
        ['meals', 'Midday meal plan', 1200, 'monthly', false],
        ['activity', 'Activity & clubs', 2500, 'annual', false],
        ['uniform', 'Uniform set', 3500, 'one_time', false],
        ['field_trips', 'Field trips', 2000, 'annual', false],
    ];

    public function run(): void
    {
        // A handful of schools, not all of them — a platform where every
        // school has complete fee data would misrepresent how this looks in
        // practice, where publication is patchy.
        $schools = School::orderBy('id')->limit(6)->get();

        foreach ($schools as $index => $school) {
            $recorder = SchoolStaff::where('school_id', $school->id)->value('user_id');

            if (! $recorder) {
                continue;
            }

            // Schools differ in how expensive they are; scale the template.
            $scale = [1.0, 0.55, 1.4, 0.8, 1.15, 0.65][$index] ?? 1.0;

            $lastYear = $this->createYear($school, $recorder, '2025-26', $scale * 0.92);
            $this->createYear($school, $recorder, '2026-27', $scale);

            // One recorded increase, so the change-history panel is real.
            if ($index === 0) {
                $tuition = Fee::where('school_id', $school->id)
                    ->where('academic_year', '2026-27')
                    ->where('category', 'tuition')
                    ->first();

                if ($tuition) {
                    $previous = (float) $tuition->amount;
                    $increased = round($previous * 1.12, 2);

                    FeeRevision::create([
                        'fee_id' => $tuition->id,
                        'school_id' => $school->id,
                        'changed_by_user_id' => $recorder,
                        'previous_amount' => $previous,
                        'new_amount' => $increased,
                        'previous_snapshot' => $tuition->only([
                            'category', 'label', 'amount', 'frequency', 'class_grade',
                            'is_mandatory', 'is_refundable', 'academic_year', 'state_cap_status',
                        ]),
                        'reason' => 'Revised mid-year following the management committee meeting.',
                        'changed_at' => now()->subDays(45),
                    ]);

                    $tuition->update(['amount' => $increased]);
                }
            }

            unset($lastYear);
        }
    }

    private function createYear(School $school, int $recorderId, string $year, float $scale): void
    {
        foreach (self::TEMPLATE as [$category, $label, $amount, $frequency, $mandatory]) {
            Fee::create([
                'school_id' => $school->id,
                'academic_year' => $year,
                'class_grade' => null,
                'category' => $category,
                'label' => $label,
                'amount' => round($amount * $scale, 2),
                'frequency' => $frequency,
                'is_mandatory' => $mandatory,
                'is_refundable' => $category === 'admission',
                'effective_from' => substr($year, 0, 4).'-04-01',
                // Only some charges have been through a state committee — the
                // rest sit as "no cap recorded", which is the honest default.
                'state_cap_status' => in_array($category, ['tuition', 'development'], true)
                    ? 'within_cap'
                    : 'not_applicable',
                'recorded_by_user_id' => $recorderId,
            ]);
        }
    }
}
