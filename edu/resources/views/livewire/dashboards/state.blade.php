<?php

use App\Models\AnalyticsSnapshot;
use App\Models\Complaint;
use App\Models\District;
use App\Models\OfficerJurisdiction;
use App\Models\RetaliationReport;
use App\Models\School;
use App\Services\HealthAggregateService;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Auth;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

/**
 * Top-line stats/by-district breakdown come from the analytics_snapshots
 * rollup (see RecalculateAnalyticsSnapshots) instead of a live aggregate
 * query. The complaint list and retaliation queue below stay live-query —
 * this is an officer's actionable queue, not a report, and must reflect the
 * current record set exactly.
 */
new #[Layout('layouts.app')] class extends Component
{
    public function recalculateNow(): void
    {
        Artisan::call('analytics:recalculate');
    }

    public function with(): array
    {
        $stateIds = OfficerJurisdiction::where('user_id', Auth::id())
            ->where('level', 'state')->pluck('state_id');

        $complaints = Complaint::whereIn('state_id', $stateIds)
            ->with(['school:id,name,district_id', 'district:id,name'])
            ->orderByRaw("CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END")
            ->latest()
            ->limit(200)
            ->get();

        // Most state officers cover exactly one state, but jurisdiction supports
        // more than one — merge each state's snapshot rather than assuming one.
        $snapshots = $stateIds->map(function (int $stateId) {
            $snapshot = AnalyticsSnapshot::latestForState($stateId);

            if (! $snapshot) {
                Artisan::call('analytics:recalculate');
                $snapshot = AnalyticsSnapshot::latestForState($stateId);
            }

            return $snapshot;
        })->filter();

        $stats = [
            'total' => $snapshots->sum(fn ($s) => $s->metrics['total'] ?? 0),
            'escalated' => $snapshots->sum(fn ($s) => $s->metrics['escalated'] ?? 0),
            'child_safety' => $snapshots->sum(fn ($s) => $s->metrics['child_safety'] ?? 0),
            'unresolved' => $snapshots->sum(fn ($s) => $s->metrics['unresolved'] ?? 0),
        ];

        $byDistrict = $snapshots
            ->flatMap(fn ($s) => collect($s->metrics['by_district'] ?? []))
            ->sortByDesc(fn ($row) => $row['total']);

        $pendingSchools = $snapshots->sum(fn ($s) => $s->metrics['pending_schools'] ?? 0);
        $calculatedAt = $snapshots->max(fn ($s) => $s->calculated_at);

        $retaliationReports = RetaliationReport::whereIn('state_id', $stateIds)
            ->with('school:id,name')
            ->whereNotIn('status', ['resolved', 'closed'])
            ->latest()
            ->limit(20)
            ->get();

        // Spec sections 20, 32 — anonymised aggregates, suppressed below the
        // small-cell floor inside the service.
        $healthSummary = app(HealthAggregateService::class)->summary('state', $stateIds->first());

        return compact('complaints', 'stats', 'byDistrict', 'retaliationReports', 'pendingSchools', 'calculatedAt', 'healthSummary');
    }
}; ?>

<div>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">State Officer Dashboard</h2>
    </x-slot>

    <div class="py-8 max-w-6xl mx-auto sm:px-6 lg:px-8 space-y-6">
        <div class="flex justify-between items-center text-xs text-gray-400">
            <span>Summary figures as of {{ $calculatedAt?->diffForHumans() }}{{ $calculatedAt ? ' ('.$calculatedAt->format('M j, Y H:i').')' : '' }} — complaint list below is always live.</span>
            <button wire:click="recalculateNow" wire:loading.attr="disabled" class="text-indigo-600 hover:underline disabled:opacity-50">
                <span wire:loading.remove wire:target="recalculateNow">Recalculate now</span>
                <span wire:loading wire:target="recalculateNow">Recalculating…</span>
            </button>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div class="bg-white rounded-lg shadow p-4">
                <div class="text-2xl font-bold text-gray-900">{{ $stats['total'] }}</div>
                <div class="text-xs text-gray-500">Complaints (state-wide)</div>
            </div>
            <div class="bg-white rounded-lg shadow p-4">
                <div class="text-2xl font-bold text-orange-600">{{ $stats['unresolved'] }}</div>
                <div class="text-xs text-gray-500">Unresolved</div>
            </div>
            <div class="bg-white rounded-lg shadow p-4">
                <div class="text-2xl font-bold text-red-600">{{ $stats['escalated'] }}</div>
                <div class="text-xs text-gray-500">Escalated</div>
            </div>
            <div class="bg-white rounded-lg shadow p-4">
                <div class="text-2xl font-bold text-red-700">{{ $stats['child_safety'] }}</div>
                <div class="text-xs text-gray-500">Child-Safety Flagged</div>
            </div>
            <div class="bg-white rounded-lg shadow p-4">
                <div class="text-2xl font-bold text-yellow-600">{{ $pendingSchools }}</div>
                <div class="text-xs text-gray-500">Schools Pending Verification</div>
            </div>
        </div>

        <x-health-aggregate-panel :summary="$healthSummary" scope-label="your state" />

        <div class="bg-white rounded-lg shadow p-6">
            <h3 class="font-semibold text-gray-900 mb-4">Complaints by District</h3>
            @forelse ($byDistrict as $districtName => $row)
                <div class="flex justify-between py-2 border-b last:border-0 text-sm">
                    <span>{{ $districtName }}</span>
                    <span class="text-gray-500">{{ $row['total'] }} total &middot; {{ $row['unresolved'] }} unresolved</span>
                </div>
            @empty
                <p class="text-sm text-gray-400">No complaints in this state yet.</p>
            @endforelse
        </div>

        @if ($retaliationReports->isNotEmpty())
            <div class="bg-white rounded-lg shadow p-6">
                <h3 class="font-semibold text-gray-900 mb-4">Open Retaliation Reports</h3>
                @foreach ($retaliationReports as $report)
                    <a href="{{ route('retaliation.show', $report) }}" wire:navigate class="flex justify-between py-2 border-b last:border-0 text-sm hover:bg-gray-50 -mx-2 px-2 rounded">
                        <span>{{ $report->school->name }} — {{ str_replace('_', ' ', $report->category) }}</span>
                        <span class="text-gray-400">{{ str_replace('_', ' ', $report->status) }}</span>
                    </a>
                @endforeach
            </div>
        @endif

        <div class="bg-white rounded-lg shadow p-6">
            <h3 class="font-semibold text-gray-900 mb-4">Complaints (highest severity first)</h3>
            @forelse ($complaints->take(30) as $complaint)
                <a href="{{ route('complaints.show', $complaint) }}" wire:navigate class="flex justify-between items-center py-2 border-b last:border-0 text-sm hover:bg-gray-50 -mx-2 px-2 rounded">
                    <span>
                        {{ $complaint->complaint_number }} — {{ $complaint->school->name }} ({{ $complaint->district->name }})
                        @if ($complaint->is_child_safety_flag)
                            <span class="ml-2 text-xs px-1.5 py-0.5 bg-red-100 text-red-700 rounded">child safety</span>
                        @endif
                    </span>
                    <span class="text-gray-400">{{ str_replace('_', ' ', $complaint->status) }}</span>
                </a>
            @empty
                <p class="text-sm text-gray-400">No complaints in your state.</p>
            @endforelse
        </div>
    </div>
</div>
