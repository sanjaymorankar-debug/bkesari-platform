<?php

namespace App\Services;

use App\Models\CounsellingSession;
use App\Models\HealthFollowup;
use App\Models\PhysicalHealthRecord;
use App\Models\School;
use App\Models\StudentSchoolRelationship;
use App\Models\WellbeingConcern;

/**
 * Spec sections 20 and 32 — what government may see about health and
 * wellbeing: aggregated, anonymised statistics, and nothing else.
 *
 * This class is the counterpart to HealthAccessService's deliberate refusal to
 * give officers any individual access. Without it that refusal would leave
 * officers with nothing at all, which is not what the spec asks for — section
 * 32 explicitly wants screening coverage, follow-up rates and wellbeing
 * trends at district/state/national level so resourcing decisions can be made.
 *
 * Two safeguards make "anonymised" mean something:
 *
 * 1. **Small-cell suppression.** A district where three children have seen a
 *    counsellor is not anonymous — anyone locally can work out who. Any figure
 *    computed from a population below `MIN_CELL_SIZE` is withheld with a
 *    stated reason rather than published. This is the standard practice for
 *    releasing health statistics and it matters more here than usual, because
 *    the underlying records are about children.
 *
 * 2. **Counts only, never rows.** Every method returns numbers. There is no
 *    method on this class that returns a record, a student id, or anything
 *    that could be joined back to a child, and a test asserts the returned
 *    structures contain no identifiers.
 */
class HealthAggregateService
{
    /**
     * Minimum population before a derived statistic is published.
     *
     * Ten is a common floor for small-cell suppression in published health
     * statistics. It is deliberately applied to the *denominator* (how many
     * children the figure was computed from), not the numerator, since a 0%
     * or 100% figure from a tiny group is just as identifying as a raw count.
     */
    public const MIN_CELL_SIZE = 10;

    /**
     * @param  string  $scope  'national', 'state' or 'district'
     * @return array<string, array{
     *     label: string, value: float|int|null, unit: string,
     *     suppressed: bool, note: string, population: int
     * }>
     */
    public function summary(string $scope = 'national', ?int $scopeId = null): array
    {
        $schoolIds = $this->schoolIdsFor($scope, $scopeId);

        $studentCount = StudentSchoolRelationship::whereIn('school_id', $schoolIds)
            ->where('status', 'verified')
            ->distinct('user_id')
            ->count('user_id');

        $academicYear = $this->currentAcademicYear();

        return [
            'screening_coverage' => $this->screeningCoverage($schoolIds, $studentCount, $academicYear),
            'followup_completion' => $this->followupCompletion($schoolIds),
            'overdue_followups' => $this->overdueFollowups($schoolIds),
            'wellbeing_support' => $this->wellbeingSupport($schoolIds, $studentCount),
            'unaddressed_concerns' => $this->unaddressedConcerns($schoolIds),
        ];
    }

    /**
     * Share of enrolled students with a screening recorded this academic year.
     * The number the spec's "screening completion" line asks for.
     */
    private function screeningCoverage(array $schoolIds, int $studentCount, string $academicYear): array
    {
        if ($studentCount < self::MIN_CELL_SIZE) {
            return $this->suppressed('Students screened this year', '%', $studentCount);
        }

        $screened = PhysicalHealthRecord::whereIn('school_id', $schoolIds)
            ->where('academic_year', $academicYear)
            ->distinct('student_user_id')
            ->count('student_user_id');

        return [
            'label' => 'Students screened this year',
            'value' => round(($screened / $studentCount) * 100, 1),
            'unit' => '%',
            'suppressed' => false,
            'note' => 'Of '.$studentCount.' enrolled students, for '.$academicYear.'.',
            'population' => $studentCount,
        ];
    }

    /**
     * Follow-ups that reached completion. The measure that says whether
     * screening actually leads anywhere — a high screening rate with a low
     * follow-up rate is a worse result than screening fewer children well.
     */
    private function followupCompletion(array $schoolIds): array
    {
        $total = HealthFollowup::whereIn('school_id', $schoolIds)->count();

        if ($total < self::MIN_CELL_SIZE) {
            return $this->suppressed('Follow-ups completed', '%', $total);
        }

        $completed = HealthFollowup::whereIn('school_id', $schoolIds)
            ->whereIn('status', ['completed', 'closed'])
            ->count();

        return [
            'label' => 'Follow-ups completed',
            'value' => round(($completed / $total) * 100, 1),
            'unit' => '%',
            'suppressed' => false,
            'note' => 'Of '.$total.' follow-ups opened.',
            'population' => $total,
        ];
    }

    /**
     * Overdue follow-ups as a raw count.
     *
     * Not suppressed: this is a count of *cases needing action*, not a
     * statistic about a population, and an officer being unable to see that
     * eight follow-ups are overdue would defeat the point of recording them.
     * It names no child and cannot be narrowed to one.
     */
    private function overdueFollowups(array $schoolIds): array
    {
        $count = HealthFollowup::whereIn('school_id', $schoolIds)
            ->whereNotIn('status', ['completed', 'closed'])
            ->whereNotNull('due_on')
            ->whereDate('due_on', '<', now())
            ->count();

        return [
            'label' => 'Overdue follow-ups',
            'value' => $count,
            'unit' => '',
            'suppressed' => false,
            'note' => 'Open past their due date. Needs action, not analysis.',
            'population' => $count,
        ];
    }

    private function wellbeingSupport(array $schoolIds, int $studentCount): array
    {
        if ($studentCount < self::MIN_CELL_SIZE) {
            return $this->suppressed('Students who saw a counsellor', '%', $studentCount);
        }

        $supported = CounsellingSession::whereIn('school_id', $schoolIds)
            ->distinct('student_user_id')
            ->count('student_user_id');

        return [
            'label' => 'Students who saw a counsellor',
            'value' => round(($supported / $studentCount) * 100, 1),
            'unit' => '%',
            'suppressed' => false,
            'note' => 'Of '.$studentCount.' enrolled students. A higher figure is not a worse outcome — '
                .'it may mean support is reaching people.',
            'population' => $studentCount,
        ];
    }

    /**
     * Observations raised by staff that no counsellor has picked up. Like
     * overdue follow-ups, this is a queue depth rather than a statistic about
     * children, so it is reported as a count.
     */
    private function unaddressedConcerns(array $schoolIds): array
    {
        $count = WellbeingConcern::whereIn('school_id', $schoolIds)
            ->where('referral_status', 'raised')
            ->count();

        return [
            'label' => 'Observations awaiting a counsellor',
            'value' => $count,
            'unit' => '',
            'suppressed' => false,
            'note' => 'Raised by staff and not yet picked up.',
            'population' => $count,
        ];
    }

    private function suppressed(string $label, string $unit, int $population): array
    {
        return [
            'label' => $label,
            'value' => null,
            'unit' => $unit,
            'suppressed' => true,
            'note' => 'Withheld: fewer than '.self::MIN_CELL_SIZE.' records, which is too few to report '
                .'without risking identifying a child.',
            'population' => $population,
        ];
    }

    /** @return list<int> */
    private function schoolIdsFor(string $scope, ?int $scopeId): array
    {
        $query = School::query();

        if ($scope === 'district' && $scopeId !== null) {
            $query->where('district_id', $scopeId);
        } elseif ($scope === 'state' && $scopeId !== null) {
            $query->where('state_id', $scopeId);
        }

        return $query->pluck('id')->all();
    }

    private function currentAcademicYear(): string
    {
        $now = now();
        $startYear = $now->month >= 4 ? $now->year : $now->year - 1;

        return $startYear.'-'.substr((string) ($startYear + 1), 2);
    }
}
