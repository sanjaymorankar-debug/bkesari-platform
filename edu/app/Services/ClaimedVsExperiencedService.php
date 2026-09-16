<?php

namespace App\Services;

use App\Models\FacilityClaim;
use App\Models\FacilityRating;
use App\Support\FacilityTaxonomy;
use Illuminate\Support\Collection;

/**
 * Spec section 11 — comparing what a school says it offers against what
 * families report experiencing.
 *
 * The framing rules matter more than the arithmetic here:
 *
 * - The output is a **reported** status, never a finding. "Significant
 *   discrepancy reported" says families reported something different; it does
 *   not say the school lied. A facility can be genuinely present and still
 *   rated unavailable because it is perpetually locked, and both facts are
 *   worth surfacing without either being an accusation.
 * - Below `MIN_REPORTS` responses nothing is labelled at all. One annoyed
 *   family must never be able to brand a school's claim as false, and section
 *   14's confidence rule applies here as much as to the quality index.
 * - A school with no ratings is reported as "no reports yet", never as
 *   consistent. Silence is not agreement.
 */
class ClaimedVsExperiencedService
{
    /**
     * Minimum independent reports before any status is shown. A judgement
     * call, deliberately conservative: the cost of wrongly flagging a school
     * is higher than the cost of showing "not enough reports yet" for longer.
     */
    public const MIN_REPORTS = 3;

    /** Share of "available" reports at or above which a claim reads as consistent. */
    public const CONSISTENT_THRESHOLD = 0.70;

    /** Below this, the gap is reported as significant. */
    public const PARTIAL_THRESHOLD = 0.40;

    public const STATUS_LABELS = [
        'consistent' => 'Consistent',
        'partially_consistent' => 'Partially consistent',
        'significant_discrepancy' => 'Significant discrepancy reported',
        'insufficient_reports' => 'Not enough reports yet',
        'no_reports' => 'No reports yet',
    ];

    /**
     * Compare every claim a school has made for a year.
     *
     * @return list<array{
     *     facility_key: string, label: string, group: string,
     *     claimed: bool, verification_status: string,
     *     report_count: int, available: int, partially: int, not_available: int,
     *     available_share: float|null, status: string, status_label: string,
     *     confidence: string
     * }>
     */
    public function compareSchool(int $schoolId, string $academicYear): array
    {
        $claims = FacilityClaim::query()
            ->where('school_id', $schoolId)
            ->where('academic_year', $academicYear)
            ->where('is_offered', true)
            ->get();

        if ($claims->isEmpty()) {
            return [];
        }

        $ratings = FacilityRating::query()
            ->where('school_id', $schoolId)
            ->where('academic_year', $academicYear)
            ->get()
            ->groupBy('facility_key');

        $rows = [];

        foreach ($claims as $claim) {
            $rows[] = $this->compareOne($claim, $ratings->get($claim->facility_key, collect()));
        }

        // Biggest reported gaps first — that is what a school needs to look at
        // and what a parent is scanning for.
        usort($rows, fn (array $a, array $b): int => $this->severity($b['status']) <=> $this->severity($a['status']));

        return $rows;
    }

    /**
     * @param  Collection<int, FacilityRating>  $ratings
     */
    public function compareOne(FacilityClaim $claim, Collection $ratings): array
    {
        $available = $ratings->where('availability_report', 'available')->count();
        $partially = $ratings->where('availability_report', 'partially_available')->count();
        $notAvailable = $ratings->where('availability_report', 'not_available')->count();
        $total = $available + $partially + $notAvailable;

        // "Partly available" counts as half agreement — it is neither a
        // confirmation nor a contradiction of the claim.
        $share = $total > 0 ? ($available + ($partially * 0.5)) / $total : null;

        $status = match (true) {
            $total === 0 => 'no_reports',
            $total < self::MIN_REPORTS => 'insufficient_reports',
            $share >= self::CONSISTENT_THRESHOLD => 'consistent',
            $share >= self::PARTIAL_THRESHOLD => 'partially_consistent',
            default => 'significant_discrepancy',
        };

        return [
            'facility_key' => $claim->facility_key,
            'label' => FacilityTaxonomy::label($claim->facility_key),
            'group' => FacilityTaxonomy::groupLabel($claim->facility_key),
            'claimed' => true,
            'verification_status' => $claim->verification_status,
            'report_count' => $total,
            'available' => $available,
            'partially' => $partially,
            'not_available' => $notAvailable,
            'available_share' => $share,
            'status' => $status,
            'status_label' => self::STATUS_LABELS[$status],
            'confidence' => $this->confidence($total),
        ];
    }

    /**
     * Facilities where the reported gap is big enough that the school should
     * be invited to respond (spec section 29's right of reply). Returning them
     * is the trigger; the school always gets to answer before anything is
     * treated as settled.
     *
     * @return list<array<string, mixed>>
     */
    public function discrepanciesNeedingReply(int $schoolId, string $academicYear): array
    {
        return array_values(array_filter(
            $this->compareSchool($schoolId, $academicYear),
            fn (array $row): bool => $row['status'] === 'significant_discrepancy'
        ));
    }

    private function confidence(int $reportCount): string
    {
        return match (true) {
            $reportCount >= 20 => 'high',
            $reportCount >= 8 => 'medium',
            $reportCount >= self::MIN_REPORTS => 'low',
            default => 'insufficient',
        };
    }

    private function severity(string $status): int
    {
        return match ($status) {
            'significant_discrepancy' => 4,
            'partially_consistent' => 3,
            'insufficient_reports' => 2,
            'no_reports' => 1,
            default => 0,
        };
    }

    /**
     * Average of the structured quality dimensions for one facility. Kept
     * separate from the availability comparison above: "is it there?" and
     * "is it any good?" are different questions and are never merged into one
     * number.
     *
     * @param  Collection<int, FacilityRating>  $ratings
     * @return array<string, float|null>
     */
    public function qualityAverages(Collection $ratings): array
    {
        $averages = [];

        foreach (array_keys(FacilityRating::DIMENSIONS) as $dimension) {
            $scores = $ratings->pluck($dimension)->filter(fn ($value): bool => $value !== null);

            $averages[$dimension] = $scores->isEmpty() ? null : round($scores->avg(), 2);
        }

        return $averages;
    }
}
