<?php

use App\Models\AnalyticsSnapshot;
use App\Services\HealthAggregateService;
use Illuminate\Support\Facades\Artisan;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

/**
 * Reads from the analytics_snapshots rollup (see RecalculateAnalyticsSnapshots
 * and the hourly schedule in routes/console.php) instead of live-querying the
 * whole platform on every page load. Falls back to computing + saving a fresh
 * snapshot on the spot if none exists yet (first run, or before cron is wired
 * up on the host) so the dashboard is never empty.
 */
new #[Layout('layouts.app')] class extends Component
{
    public function recalculateNow(): void
    {
        Artisan::call('analytics:recalculate');
    }

    public function with(): array
    {
        $snapshot = AnalyticsSnapshot::latestNational();

        if (! $snapshot) {
            Artisan::call('analytics:recalculate');
            $snapshot = AnalyticsSnapshot::latestNational();
        }

        $metrics = $snapshot->metrics;

        return [
            'stats' => [
                'total_schools' => $metrics['total_schools'],
                'verified_schools' => $metrics['verified_schools'],
                'total_complaints' => $metrics['total_complaints'],
                'unresolved' => $metrics['unresolved'],
                'escalated' => $metrics['escalated'],
                'child_safety' => $metrics['child_safety'],
            ],
            'byState' => collect($metrics['by_state']),
            'openRetaliation' => $metrics['open_retaliation'],
            'calculatedAt' => $snapshot->calculated_at,
            // Spec sections 20, 32 — anonymised aggregates only. Computed live
            // rather than from the snapshot, since the small-cell suppression
            // has to be applied at read time to stay correct.
            'healthSummary' => app(HealthAggregateService::class)->summary('national'),
        ];
    }
}; ?>

<div>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">National Admin Dashboard</h2>
    </x-slot>

    <div class="py-8 max-w-6xl mx-auto sm:px-6 lg:px-8 space-y-6">
        <div class="flex justify-between items-center text-xs text-gray-400">
            <span>Figures as of {{ $calculatedAt?->diffForHumans() }}{{ $calculatedAt ? ' ('.$calculatedAt->format('M j, Y H:i').')' : '' }}</span>
            <button wire:click="recalculateNow" wire:loading.attr="disabled" class="text-indigo-600 hover:underline disabled:opacity-50">
                <span wire:loading.remove wire:target="recalculateNow">Recalculate now</span>
                <span wire:loading wire:target="recalculateNow">Recalculating…</span>
            </button>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-6 gap-4">
            <div class="bg-white rounded-lg shadow p-4">
                <div class="text-2xl font-bold text-gray-900">{{ $stats['total_schools'] }}</div>
                <div class="text-xs text-gray-500">Total Schools</div>
            </div>
            <div class="bg-white rounded-lg shadow p-4">
                <div class="text-2xl font-bold text-green-600">{{ $stats['verified_schools'] }}</div>
                <div class="text-xs text-gray-500">Verified</div>
            </div>
            <div class="bg-white rounded-lg shadow p-4">
                <div class="text-2xl font-bold text-gray-900">{{ $stats['total_complaints'] }}</div>
                <div class="text-xs text-gray-500">Complaints</div>
            </div>
            <div class="bg-white rounded-lg shadow p-4">
                <div class="text-2xl font-bold text-orange-600">{{ $stats['unresolved'] }}</div>
                <div class="text-xs text-gray-500">Unresolved</div>
            </div>
            <div class="bg-white rounded-lg shadow p-4">
                <div class="text-2xl font-bold text-red-700">{{ $stats['child_safety'] }}</div>
                <div class="text-xs text-gray-500">Child-Safety</div>
            </div>
            <div class="bg-white rounded-lg shadow p-4">
                <div class="text-2xl font-bold text-red-600">{{ $openRetaliation }}</div>
                <div class="text-xs text-gray-500">Open Retaliation Reports</div>
            </div>
        </div>

        <x-health-aggregate-panel :summary="$healthSummary" scope-label="the country" />

        <div class="bg-white rounded-lg shadow p-6">
            <div class="flex justify-between items-center mb-4">
                <h3 class="font-semibold text-gray-900">Complaints by State</h3>
                <a href="{{ route('admin.audit-log') }}" wire:navigate class="text-sm text-indigo-600 hover:underline">View Audit Log</a>
            </div>
            @forelse ($byState as $stateName => $row)
                <div class="flex justify-between py-2 border-b last:border-0 text-sm">
                    <span>{{ $stateName }}</span>
                    <span class="text-gray-500">{{ $row['total'] }} total &middot; {{ $row['unresolved'] }} unresolved</span>
                </div>
            @empty
                <p class="text-sm text-gray-400">No complaints recorded yet.</p>
            @endforelse
        </div>
    </div>
</div>
