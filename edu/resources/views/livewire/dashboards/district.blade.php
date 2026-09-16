<?php

use App\Models\Complaint;
use App\Models\OfficerJurisdiction;
use App\Models\School;
use App\Services\HealthAggregateService;
use Illuminate\Support\Facades\Auth;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

new #[Layout('layouts.app')] class extends Component
{
    /**
     * Every approve action re-checks the school's district_id against this
     * officer's own jurisdiction — an officer must never be able to verify
     * a school outside the district they were assigned.
     */
    public function approveSchool(int $schoolId): void
    {
        $districtIds = OfficerJurisdiction::where('user_id', Auth::id())
            ->where('level', 'district')->pluck('district_id');

        $school = School::findOrFail($schoolId);
        abort_unless($districtIds->contains($school->district_id), 403);

        $school->update(['recognition_status' => 'verified']);
    }

    public function with(): array
    {
        $districtIds = OfficerJurisdiction::where('user_id', Auth::id())
            ->where('level', 'district')->pluck('district_id');

        $complaints = Complaint::whereIn('district_id', $districtIds)
            ->with(['school:id,name', 'category:id,name'])
            ->orderByRaw("CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END")
            ->latest()
            ->limit(50)
            ->get();

        $stats = [
            'total' => $complaints->count(),
            'escalated' => $complaints->where('status', 'escalated')->count(),
            'child_safety' => $complaints->where('is_child_safety_flag', true)->count(),
            'unresolved' => $complaints->whereNotIn('status', ['resolved', 'closed'])->count(),
        ];

        $pendingSchools = School::whereIn('district_id', $districtIds)
            ->whereIn('recognition_status', ['pending', 'under_review'])
            ->get();

        // Aggregate health figures for the officer's first district. Scoped
        // the same way everything else on this dashboard is, and anonymised
        // with small-cell suppression inside the service (spec sections 20, 32).
        $healthSummary = app(HealthAggregateService::class)
            ->summary('district', $districtIds->first());

        return compact('complaints', 'stats', 'pendingSchools', 'healthSummary');
    }
}; ?>

<div>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">District Officer Dashboard</h2>
    </x-slot>

    <div class="py-8 max-w-6xl mx-auto sm:px-6 lg:px-8 space-y-6">
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div class="bg-white rounded-lg shadow p-4">
                <div class="text-2xl font-bold text-gray-900">{{ $stats['total'] }}</div>
                <div class="text-xs text-gray-500">Complaints in Jurisdiction</div>
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
        </div>

        <x-health-aggregate-panel :summary="$healthSummary" scope-label="your district" />

        <div class="bg-white rounded-lg shadow p-6">
            <h3 class="font-semibold text-gray-900 mb-1">Verification queue</h3>
            <p class="text-xs text-gray-500 mb-3">
                UDISE codes and facility evidence waiting to be checked. Nothing is verified until someone here does it.
            </p>
            <a href="{{ route('verification.queue') }}" wire:navigate
                class="inline-block px-4 py-2 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700">Open the verification queue</a>
        </div>

        @can('handle-safeguarding-cases')
            <div class="bg-white rounded-lg shadow p-6">
                <h3 class="font-semibold text-gray-900 mb-1">Safeguarding cases</h3>
                <p class="text-xs text-gray-500 mb-3">
                    Held separately from complaints, restricted, and never part of any rating.
                </p>
                <a href="{{ route('safeguarding.queue') }}" wire:navigate
                    class="inline-block px-4 py-2 text-sm rounded bg-red-600 text-white hover:bg-red-700">Open the safeguarding queue</a>
            </div>
        @endcan

        @if ($pendingSchools->count() > 0)
            <div class="bg-white rounded-lg shadow p-6">
                <h3 class="font-semibold text-gray-900 mb-4">Pending School Registrations ({{ $pendingSchools->count() }})</h3>
                @foreach ($pendingSchools as $school)
                    <div class="flex justify-between items-center py-2 border-b last:border-0 text-sm">
                        <span>{{ $school->name }} — {{ $school->city }} ({{ $school->board }})</span>
                        <button wire:click="approveSchool({{ $school->id }})" class="text-xs px-2 py-1 bg-green-600 text-white rounded">Verify</button>
                    </div>
                @endforeach
            </div>
        @endif

        <div class="bg-white rounded-lg shadow p-6">
            <h3 class="font-semibold text-gray-900 mb-4">Complaints (highest severity first)</h3>
            @forelse ($complaints as $complaint)
                <a href="{{ route('complaints.show', $complaint) }}" wire:navigate class="flex justify-between items-center py-2 border-b last:border-0 text-sm hover:bg-gray-50 -mx-2 px-2 rounded">
                    <span>
                        {{ $complaint->complaint_number }} — {{ $complaint->school->name }} — {{ $complaint->category->name }}
                        @if ($complaint->is_child_safety_flag)
                            <span class="ml-2 text-xs px-1.5 py-0.5 bg-red-100 text-red-700 rounded">child safety</span>
                        @endif
                    </span>
                    <span class="text-gray-400">{{ str_replace('_', ' ', $complaint->status) }}</span>
                </a>
            @empty
                <p class="text-sm text-gray-400">No complaints in your jurisdiction.</p>
            @endforelse
        </div>
    </div>
</div>
