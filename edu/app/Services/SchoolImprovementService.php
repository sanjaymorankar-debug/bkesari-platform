<?php

namespace App\Services;

use App\Models\Complaint;
use App\Models\CourseRating;
use App\Models\FacilityRating;
use App\Models\Fee;
use App\Models\GrowthGoal;
use App\Models\GrowthPlan;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

/**
 * Spec section 31 — "Trend, not just snapshot… The platform's purpose is to
 * measure improvement, not only surface criticism."
 *
 * Everything here is computed across consecutive academic years from data the
 * platform already holds, rather than from a separate stored metric that could
 * drift out of step with the records it summarises.
 *
 * Three rules keep the trends honest, and they matter more than the arithmetic:
 *
 * 1. **A trend needs at least two years.** One year is a snapshot, and
 *    presenting it with an arrow would invent a direction that isn't in the
 *    data.
 * 2. **A direction is only claimed when the underlying counts support it.**
 *    Each series carries the response count behind every point, and a movement
 *    from a handful of responses is reported as "not enough to call".
 * 3. **Direction is not the same as good or bad.** Rising complaint volume is
 *    the clearest case: it may mean quality fell, or it may mean families
 *    finally believe reporting is safe. This service labels the *direction* of
 *    a series and refuses to label complaint volume as an improvement or a
 *    decline at all — see `interpretation` on that series.
 */
class SchoolImprovementService
{
    /** Below this many responses behind a point, a movement is not called. */
    public const MIN_RESPONSES_TO_CALL = 5;

    /** A movement smaller than this is treated as noise, not a direction. */
    public const MEANINGFUL_DELTA = 0.2;

    /**
     * @return array<string, array{
     *     label: string, unit: string, points: list<array{year: string, value: float|null, responses: int}>,
     *     direction: string, direction_label: string, interpretation: string
     * }>
     */
    public function trends(int $schoolId): array
    {
        return [
            'facility_availability' => $this->facilityAvailability($schoolId),
            'course_quality' => $this->courseQuality($schoolId),
            'complaint_resolution' => $this->complaintResolution($schoolId),
            'complaint_volume' => $this->complaintVolume($schoolId),
            'growth_goals' => $this->growthGoalCompletion($schoolId),
            'annual_cost' => $this->annualCost($schoolId),
        ];
    }

    /**
     * Share of facility reports saying a listed facility is actually
     * available, per year. The clearest single measure of whether a school is
     * closing the gap between what it claims and what families find.
     */
    private function facilityAvailability(int $schoolId): array
    {
        $byYear = FacilityRating::where('school_id', $schoolId)
            ->get()
            ->groupBy('academic_year');

        $points = $this->pointsFrom($byYear, function (Collection $ratings): ?float {
            $total = $ratings->count();

            if ($total === 0) {
                return null;
            }

            $available = $ratings->where('availability_report', 'available')->count();
            $partial = $ratings->where('availability_report', 'partially_available')->count();

            return round((($available + ($partial * 0.5)) / $total) * 100, 1);
        });

        return $this->series(
            'Facilities families can actually use',
            '%',
            $points,
            'Higher is better: more of what the school lists is reachable in practice.',
        );
    }

    private function courseQuality(int $schoolId): array
    {
        $byYear = CourseRating::where('school_id', $schoolId)
            ->get()
            ->groupBy('academic_year');

        $points = $this->pointsFrom($byYear, function (Collection $ratings): ?float {
            $scores = $ratings->pluck('course_quality')->filter(fn ($v): bool => $v !== null);

            return $scores->isEmpty() ? null : round($scores->avg(), 2);
        });

        return $this->series(
            'Course quality, as rated',
            '/5',
            $points,
            'Higher is better. Averaged across every course rated that year.',
        );
    }

    private function complaintResolution(int $schoolId): array
    {
        $byYear = Complaint::where('school_id', $schoolId)
            ->get()
            ->groupBy(fn (Complaint $c): string => $this->academicYearOf($c->created_at));

        $points = $this->pointsFrom($byYear, function (Collection $complaints): ?float {
            $total = $complaints->count();

            if ($total === 0) {
                return null;
            }

            $resolved = $complaints->whereIn('status', ['resolved', 'closed'])->count();

            return round(($resolved / $total) * 100, 1);
        });

        return $this->series(
            'Complaints reaching a resolution',
            '%',
            $points,
            'Higher is better: more of what families raised was actually dealt with.',
        );
    }

    /**
     * Complaint volume, reported without a good/bad reading.
     *
     * A school whose complaint count rises may be getting worse, or may be one
     * where families have finally decided reporting is safe — and the platform
     * cannot tell those apart from the count. Presenting a rise as a decline
     * in quality would punish exactly the schools that built enough trust for
     * people to speak up.
     */
    private function complaintVolume(int $schoolId): array
    {
        $byYear = Complaint::where('school_id', $schoolId)
            ->get()
            ->groupBy(fn (Complaint $c): string => $this->academicYearOf($c->created_at));

        $points = $this->pointsFrom($byYear, fn (Collection $c): ?float => (float) $c->count());

        $series = $this->series(
            'Complaints raised',
            '',
            $points,
            'Neither good nor bad on its own. More complaints can mean falling quality — or that '
                .'families now trust the process enough to use it. Read it alongside the resolution rate.',
        );

        // Direction is still shown, but never translated into better/worse.
        $series['direction_label'] = match ($series['direction']) {
            'up' => 'More than last year',
            'down' => 'Fewer than last year',
            'flat' => 'About the same',
            default => $series['direction_label'],
        };

        return $series;
    }

    /**
     * Spec section 16's growth goals, aggregated. Never per child — this is a
     * school-level count of how many agreed goals were actually reached.
     */
    private function growthGoalCompletion(int $schoolId): array
    {
        $planIds = GrowthPlan::where('school_id', $schoolId)->pluck('id', 'id');

        $byYear = GrowthGoal::whereIn('growth_plan_id', $planIds->keys())
            ->get()
            ->groupBy(fn (GrowthGoal $g): string => $this->academicYearOf($g->created_at));

        $points = $this->pointsFrom($byYear, function (Collection $goals): ?float {
            $total = $goals->count();

            if ($total === 0) {
                return null;
            }

            return round(($goals->where('status', 'achieved')->count() / $total) * 100, 1);
        });

        return $this->series(
            'Growth goals reached',
            '%',
            $points,
            'Higher is better, but a low figure is not a failure — a goal carried into the next term '
                .'is a normal outcome, not a missed target.',
        );
    }

    private function annualCost(int $schoolId): array
    {
        $calculator = app(AnnualCostCalculator::class);

        $byYear = Fee::where('school_id', $schoolId)->get()->groupBy('academic_year');

        $points = $this->pointsFrom(
            $byYear,
            fn (Collection $fees): ?float => $calculator->summarise($fees)['continuing_year_total'],
        );

        return $this->series(
            'Recurring annual cost',
            '₹',
            $points,
            'Not a quality measure. Shown so year-on-year fee movement is visible next to everything else.',
        );
    }

    /**
     * @param  Collection<string, Collection<int, mixed>>  $byYear
     * @return list<array{year: string, value: float|null, responses: int}>
     */
    private function pointsFrom(Collection $byYear, callable $compute): array
    {
        return $byYear
            ->sortKeys()
            ->map(fn (Collection $rows, string $year): array => [
                'year' => $year,
                'value' => $compute($rows),
                'responses' => $rows->count(),
            ])
            ->values()
            ->all();
    }

    /**
     * Assemble a series and work out whether a direction can honestly be
     * claimed from it.
     */
    private function series(string $label, string $unit, array $points, string $interpretation): array
    {
        [$direction, $directionLabel] = $this->direction($points);

        return [
            'label' => $label,
            'unit' => $unit,
            'points' => $points,
            'direction' => $direction,
            'direction_label' => $directionLabel,
            'interpretation' => $interpretation,
        ];
    }

    /** @return array{0: string, 1: string} */
    private function direction(array $points): array
    {
        $usable = array_values(array_filter($points, fn (array $p): bool => $p['value'] !== null));

        if (count($usable) < 2) {
            return ['insufficient', 'Not enough years yet to show a trend'];
        }

        $latest = $usable[count($usable) - 1];
        $previous = $usable[count($usable) - 2];

        if ($latest['responses'] < self::MIN_RESPONSES_TO_CALL
            || $previous['responses'] < self::MIN_RESPONSES_TO_CALL) {
            return ['uncertain', 'Too few responses to call a direction'];
        }

        $delta = $latest['value'] - $previous['value'];

        if (abs($delta) < self::MEANINGFUL_DELTA) {
            return ['flat', 'About the same as last year'];
        }

        return $delta > 0
            ? ['up', 'Up on last year']
            : ['down', 'Down on last year'];
    }

    /** April-start academic year, matching the rest of the platform. */
    private function academicYearOf(?\DateTimeInterface $date): string
    {
        $date ??= now();
        $carbon = Carbon::instance($date);
        $startYear = $carbon->month >= 4 ? $carbon->year : $carbon->year - 1;

        return $startYear.'-'.substr((string) ($startYear + 1), 2);
    }
}
