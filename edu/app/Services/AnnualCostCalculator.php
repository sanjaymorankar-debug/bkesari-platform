<?php

namespace App\Services;

use App\Models\Fee;
use Illuminate\Support\Collection;

/**
 * Spec section 9 — turns a school's fee register into the number a parent
 * actually needs, for real school-to-school comparison.
 *
 * Two deliberate departures from "just add everything up":
 *
 * 1. **One-time charges are reported separately from recurring ones.** Rolling
 *    admission and registration fees into a single "annual cost" makes a school
 *    look permanently more expensive than it is, and makes year one look the
 *    same as year two when they are very different numbers. Parents are asked
 *    to compare both a first-year figure and a continuing-year figure.
 *
 * 2. **Mandatory and optional are never merged.** Section 9 asks for both, and
 *    a school with heavy optional add-ons should not be able to hide them
 *    inside one total, nor be penalised as though everyone pays them.
 *
 * Every figure this returns is an estimate computed from what the school itself
 * reported, and the UI must say so — it is not a quotation and not verified.
 */
class AnnualCostCalculator
{
    /**
     * Terms per academic year, used to annualise per-term charges.
     *
     * This is an assumption, not a fact: term structure varies by state and
     * board. It is held here as a named constant rather than scattered as a
     * literal so it can become a per-school or per-state setting later without
     * hunting through the codebase.
     */
    public const TERMS_PER_YEAR = 3;

    private const MULTIPLIERS = [
        'monthly' => 12,
        'quarterly' => 4,
        'term' => self::TERMS_PER_YEAR,
        'annual' => 1,
    ];

    /**
     * @param  Collection<int, Fee>  $fees  fees for one school, year and class
     * @return array{
     *     mandatory_recurring: float, optional_recurring: float,
     *     mandatory_one_time: float, optional_one_time: float,
     *     recurring_annual: float, one_time_total: float,
     *     first_year_total: float, continuing_year_total: float,
     *     has_data: bool, fee_count: int
     * }
     */
    public function summarise(Collection $fees): array
    {
        $totals = [
            'mandatory_recurring' => 0.0,
            'optional_recurring' => 0.0,
            'mandatory_one_time' => 0.0,
            'optional_one_time' => 0.0,
        ];

        foreach ($fees as $fee) {
            $bucket = ($fee->is_mandatory ? 'mandatory' : 'optional')
                .($fee->frequency === 'one_time' ? '_one_time' : '_recurring');

            $totals[$bucket] += $this->annualise($fee);
        }

        $recurring = $totals['mandatory_recurring'] + $totals['optional_recurring'];
        $oneTime = $totals['mandatory_one_time'] + $totals['optional_one_time'];

        return [
            ...$totals,
            'recurring_annual' => $recurring,
            'one_time_total' => $oneTime,
            // What a family joining this year pays, versus what they pay every
            // year after. Both are shown; neither alone is honest.
            'first_year_total' => $recurring + $oneTime,
            'continuing_year_total' => $recurring,
            'has_data' => $fees->isNotEmpty(),
            'fee_count' => $fees->count(),
        ];
    }

    /**
     * One fee's contribution to a single year. A one-time charge contributes
     * its face value once — it is the caller's job to keep it in the one-time
     * bucket rather than the recurring one.
     */
    public function annualise(Fee $fee): float
    {
        $amount = (float) $fee->amount;

        return $amount * (self::MULTIPLIERS[$fee->frequency] ?? 1);
    }

    /**
     * Fees applying to a given class: those recorded specifically for it, plus
     * the school-wide ones (`class_grade` null) that apply to everybody.
     *
     * @param  Collection<int, Fee>  $fees
     * @return Collection<int, Fee>
     */
    public function forClass(Collection $fees, ?string $classGrade): Collection
    {
        if ($classGrade === null || $classGrade === '') {
            return $fees;
        }

        return $fees->filter(
            fn (Fee $fee): bool => $fee->class_grade === null || $fee->class_grade === $classGrade
        )->values();
    }

    /**
     * Per-category breakdown for display, largest first — this is what shows a
     * parent *where* the money goes, which the headline total cannot.
     *
     * @param  Collection<int, Fee>  $fees
     * @return list<array{category: string, label: string, annual: float, mandatory: bool}>
     */
    public function breakdownByCategory(Collection $fees): array
    {
        $rows = [];

        foreach ($fees as $fee) {
            $key = $fee->category.($fee->is_mandatory ? ':m' : ':o');

            $rows[$key] ??= [
                'category' => $fee->category,
                'label' => $fee->categoryLabel(),
                'annual' => 0.0,
                'mandatory' => (bool) $fee->is_mandatory,
            ];

            $rows[$key]['annual'] += $this->annualise($fee);
        }

        $rows = array_values($rows);

        usort($rows, fn (array $a, array $b): int => $b['annual'] <=> $a['annual']);

        return $rows;
    }
}
