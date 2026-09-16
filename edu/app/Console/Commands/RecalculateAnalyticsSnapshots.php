<?php

namespace App\Console\Commands;

use App\Models\AnalyticsSnapshot;
use App\Models\Complaint;
use App\Models\RetaliationReport;
use App\Models\School;
use App\Models\SchoolQualityScore;
use App\Models\State;
use Illuminate\Console\Command;

/**
 * Populates analytics_snapshots for the National and Researcher dashboards
 * (spec: national/state analytics rollups as real infrastructure, not
 * live-query-per-page-load). State Officer dashboards intentionally stay
 * live-query — that's an actionable per-officer queue, not an aggregate
 * report, and must reflect the current complaint list exactly.
 */
class RecalculateAnalyticsSnapshots extends Command
{
    protected $signature = 'analytics:recalculate';

    protected $description = 'Recalculate national and per-state analytics snapshots';

    public function handle(): int
    {
        $this->recalculateNational();

        foreach (State::all() as $state) {
            $this->recalculateState($state);
        }

        $this->info('Analytics snapshots recalculated.');

        return self::SUCCESS;
    }

    private function recalculateNational(): void
    {
        $complaints = Complaint::with('state:id,name')->get(['id', 'state_id', 'status', 'is_child_safety_flag']);

        $byState = $complaints->groupBy(fn ($c) => $c->state->name ?? 'Unknown')
            ->map(fn ($group) => [
                'total' => $group->count(),
                'unresolved' => $group->whereNotIn('status', ['resolved', 'closed'])->count(),
            ])
            ->sortByDesc(fn ($row) => $row['total']);

        $schoolsByBoard = School::selectRaw('board, count(*) as total')->groupBy('board')->pluck('total', 'board');
        $schoolsByManagement = School::selectRaw('management_type, count(*) as total')->groupBy('management_type')->pluck('total', 'management_type');

        $complaintsByCategory = Complaint::join('complaint_categories', 'complaints.complaint_category_id', '=', 'complaint_categories.id')
            ->selectRaw('complaint_categories.name, count(*) as total')
            ->groupBy('complaint_categories.name')
            ->orderByDesc('total')
            ->pluck('total', 'name');

        $avgSqiByState = SchoolQualityScore::join('schools', 'school_quality_scores.school_id', '=', 'schools.id')
            ->join('states', 'schools.state_id', '=', 'states.id')
            ->selectRaw('states.name, avg(school_quality_scores.score) as avg_score, count(distinct schools.id) as school_count')
            ->groupBy('states.name')
            ->get()
            ->map(fn ($row) => ['name' => $row->name, 'avg_score' => round((float) $row->avg_score, 1), 'school_count' => (int) $row->school_count]);

        AnalyticsSnapshot::create([
            'scope' => 'national',
            'scope_id' => null,
            'metrics' => [
                'total_schools' => School::count(),
                'verified_schools' => School::where('recognition_status', 'verified')->count(),
                'total_complaints' => $complaints->count(),
                'unresolved' => $complaints->whereNotIn('status', ['resolved', 'closed'])->count(),
                'escalated' => $complaints->where('status', 'escalated')->count(),
                'child_safety' => $complaints->where('is_child_safety_flag', true)->count(),
                'open_retaliation' => RetaliationReport::whereNotIn('status', ['resolved', 'closed'])->count(),
                'by_state' => $byState,
                'schools_by_board' => $schoolsByBoard,
                'schools_by_management' => $schoolsByManagement,
                'complaints_by_category' => $complaintsByCategory,
                'avg_sqi_by_state' => $avgSqiByState,
            ],
            'calculated_at' => now(),
        ]);
    }

    private function recalculateState(State $state): void
    {
        $complaints = Complaint::where('state_id', $state->id)->with('district:id,name')->get(['id', 'district_id', 'status', 'is_child_safety_flag']);

        $byDistrict = $complaints->groupBy(fn ($c) => $c->district->name ?? 'Unknown')
            ->map(fn ($group) => [
                'total' => $group->count(),
                'unresolved' => $group->whereNotIn('status', ['resolved', 'closed'])->count(),
            ])
            ->sortByDesc(fn ($row) => $row['total']);

        AnalyticsSnapshot::create([
            'scope' => 'state',
            'scope_id' => $state->id,
            'metrics' => [
                'total' => $complaints->count(),
                'unresolved' => $complaints->whereNotIn('status', ['resolved', 'closed'])->count(),
                'escalated' => $complaints->where('status', 'escalated')->count(),
                'child_safety' => $complaints->where('is_child_safety_flag', true)->count(),
                'pending_schools' => School::where('state_id', $state->id)->whereIn('recognition_status', ['pending', 'under_review'])->count(),
                'by_district' => $byDistrict,
            ],
            'calculated_at' => now(),
        ]);
    }
}
