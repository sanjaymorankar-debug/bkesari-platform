<?php

namespace App\Services;

use App\Models\BenchmarkReference;
use App\Models\CapabilityObservation;
use App\Models\Complaint;
use App\Models\GrowthPlan;
use App\Models\School;
use Illuminate\Support\Collection;

/**
 * Spec section 3 — the "How India Compares" layer.
 *
 * The spec is blunt about the failure mode here, and so is this class. India
 * is not currently a PISA participant, so there is no Indian PISA score to
 * show, and rule 44 forbids inventing one. What the platform can honestly put
 * side by side is:
 *
 *   - **Domestic measured data** — numbers this platform actually computed
 *     from its own records, clearly labelled as platform-derived and carrying
 *     the coverage they were computed from. A percentage drawn from twenty
 *     schools is not a national statistic and is never presented as one.
 *   - **Structural practice comparison** — sourced, dated descriptions of what
 *     high-performing systems do, held in `benchmark_references`, which has no
 *     numeric column at all.
 *
 * These two are never merged into a single score, and the service returns them
 * as separately typed structures so a view cannot accidentally render one as
 * the other.
 */
class BenchmarkService
{
    /**
     * Below this many schools, a platform-derived percentage is reported with
     * its coverage foregrounded rather than as a headline figure. The number
     * is a judgement call, deliberately conservative.
     */
    public const MEANINGFUL_COVERAGE = 50;

    /**
     * India's position on international assessments, stated plainly so no
     * page has to imply otherwise.
     *
     * This is a sourced claim, not a platform assertion, and it is dated. If
     * India's participation changes, this constant changes — the platform must
     * never quietly keep showing a stale position.
     */
    public const INTERNATIONAL_ASSESSMENT_POSITION = [
        'participates_in_pisa' => false,
        'statement' => 'India does not currently participate in PISA, so this platform shows no Indian '
            .'PISA score or rank. Comparisons below are structural — what high-performing systems do — '
            .'alongside India\'s own domestically measured data.',
        'source_name' => 'Platform policy note, from the build specification (section 3)',
        'source_year' => 2026,
    ];

    /**
     * Numbers this platform actually computed from its own data.
     *
     * @return list<array{
     *     dimension: string, label: string, value: float|int|null, unit: string,
     *     description: string, coverage: string, provenance: string, meaningful: bool
     * }>
     */
    public function domesticMeasures(): array
    {
        $schoolCount = School::count();
        $meaningful = $schoolCount >= self::MEANINGFUL_COVERAGE;
        $coverage = $schoolCount.' '.($schoolCount === 1 ? 'school' : 'schools').' on the platform';

        $measures = [];

        // Grievance resolution — one of the few things the platform measures
        // directly and completely, because it owns the whole workflow.
        $totalComplaints = Complaint::count();
        $resolved = Complaint::whereIn('status', ['resolved', 'closed'])->count();

        $measures[] = [
            'dimension' => 'grievance_and_accountability',
            'label' => 'Complaints reaching a resolution',
            'value' => $totalComplaints > 0 ? round(($resolved / $totalComplaints) * 100, 1) : null,
            'unit' => '%',
            'description' => 'Share of complaints on this platform that reached a resolved or closed state.',
            'coverage' => $totalComplaints.' '.($totalComplaints === 1 ? 'complaint' : 'complaints'),
            'provenance' => 'platform_measured',
            'meaningful' => $totalComplaints >= 20,
        ];

        // Holistic assessment adoption — the NEP 2020 / PARAKH direction, and
        // something this platform can see directly through growth plans.
        $schoolsWithPlans = GrowthPlan::distinct('school_id')->count('school_id');

        $measures[] = [
            'dimension' => 'holistic_assessment',
            'label' => 'Schools using holistic growth plans',
            'value' => $schoolCount > 0 ? round(($schoolsWithPlans / $schoolCount) * 100, 1) : null,
            'unit' => '%',
            'description' => 'Schools with at least one NEP 2020-aligned growth plan recorded, as a proxy for '
                .'holistic-assessment adoption.',
            'coverage' => $coverage,
            'provenance' => 'platform_measured',
            'meaningful' => $meaningful,
        ];

        $measures[] = [
            'dimension' => 'holistic_assessment',
            'label' => 'Capability observations recorded',
            'value' => CapabilityObservation::count(),
            'unit' => '',
            'description' => 'Dated, multi-source observations of children\'s strengths and growth areas.',
            'coverage' => $coverage,
            'provenance' => 'platform_measured',
            'meaningful' => true,
        ];

        // Teacher-student ratio, from what schools have reported about
        // themselves — school-reported, not independently verified, and
        // labelled as such.
        $totalStudents = School::sum('student_count');
        $totalTeachers = School::sum('teacher_count');

        $measures[] = [
            'dimension' => 'teaching_quality',
            'label' => 'Students per teacher',
            'value' => $totalTeachers > 0 ? round($totalStudents / $totalTeachers, 1) : null,
            'unit' => ':1',
            'description' => 'Across schools on the platform, from figures the schools reported themselves.',
            'coverage' => $coverage,
            'provenance' => 'school_reported',
            'meaningful' => $meaningful,
        ];

        return $measures;
    }

    /**
     * Sourced structural practice, grouped by dimension.
     *
     * @return Collection<string, Collection<int, BenchmarkReference>>
     */
    public function structuralReferences(): Collection
    {
        return BenchmarkReference::orderBy('dimension')
            ->orderBy('system_name')
            ->get()
            ->groupBy('dimension');
    }

    /**
     * Dimensions that have something to show, in a stable display order.
     *
     * @return list<string>
     */
    public function dimensionsInOrder(): array
    {
        return array_keys(BenchmarkReference::DIMENSIONS);
    }

    /**
     * Whether any citation still needs a human to check it. Surfaced on the
     * page rather than hidden, because a government platform citing another
     * country's practice should be honest about which references have been
     * verified.
     */
    public function hasUnverifiedSources(): bool
    {
        return BenchmarkReference::where('source_verified', false)->exists();
    }
}
