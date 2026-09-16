<?php

use App\Models\SafeguardingReport;
use App\Models\SchoolStaff;
use App\Services\SafeguardingService;
use Illuminate\Support\Facades\Auth;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

/**
 * Spec section 25 — the Child Safety Officer's queue.
 *
 * Scoped by the same rules as SafeguardingService::canView(), so a school's
 * ordinary administration never sees this list even if it reaches the URL.
 */
new #[Layout('layouts.app')] class extends Component
{
    public string $filter = 'open';

    public function mount(): void
    {
        abort_unless(Auth::user()?->can('handle-safeguarding-cases'), 403);
    }

    public function with(): array
    {
        $user = Auth::user();

        $query = SafeguardingReport::query()->with('school:id,name');

        if ($user->hasRole('system_admin') || $user->hasRole('national_admin')) {
            // No additional scope.
        } elseif ($user->hasRole('child_safety_officer')) {
            $query->whereIn('school_id', SchoolStaff::where('user_id', $user->id)->pluck('school_id'));
        } elseif ($user->hasRole('district_officer')) {
            $query->whereIn('district_id', $user->officerJurisdictions()->pluck('district_id')->filter());
        } elseif ($user->hasRole('state_officer')) {
            $query->whereIn('state_id', $user->officerJurisdictions()->pluck('state_id')->filter());
        } else {
            $query->whereRaw('1 = 0');
        }

        if ($this->filter === 'open') {
            $query->where('status', '!=', 'closed');
        } elseif ($this->filter === 'awaiting_external') {
            $query->whereNull('external_report_acknowledged_at')->where('status', '!=', 'closed');
        }

        $reports = $query
            // Immediate-danger cases first, then oldest — a queue ordered by
            // newest would bury the case that has been waiting longest.
            ->orderByDesc('immediate_danger')
            ->orderBy('created_at')
            ->limit(100)
            ->get();

        return ['reports' => $reports];
    }
}; ?>

<div>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">Safeguarding cases</h2>
    </x-slot>

    <div class="py-8 max-w-5xl mx-auto sm:px-6 lg:px-8 space-y-6">

        <div class="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900">
            These records are restricted. Every time one is opened it is logged. They never appear on a school's
            public profile and never affect any rating or score.
        </div>

        <div class="flex flex-wrap gap-2">
            @foreach (['open' => 'Open', 'awaiting_external' => 'No external report recorded', 'all' => 'All'] as $key => $label)
                <button wire:click="$set('filter', '{{ $key }}')"
                    class="px-3 py-1.5 text-sm rounded {{ $filter === $key ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-300 text-gray-700' }}">
                    {{ $label }}
                </button>
            @endforeach
        </div>

        <div class="bg-white rounded-lg shadow divide-y">
            @forelse ($reports as $report)
                <a href="{{ route('safeguarding.show', $report) }}" wire:navigate class="block p-4 hover:bg-gray-50">
                    <div class="flex flex-wrap items-start justify-between gap-3">
                        <div class="flex-1 min-w-64">
                            <div class="flex flex-wrap items-center gap-2">
                                <span class="font-mono text-xs text-gray-500">{{ $report->reference }}</span>
                                @if ($report->immediate_danger)
                                    <span class="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-800 font-medium">Immediate danger</span>
                                @endif
                                @if ($report->engagesPocsoDuty())
                                    <span class="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-700">POCSO</span>
                                @endif
                                @unless ($report->hasExternalReport())
                                    <span class="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-900">No external report recorded</span>
                                @endunless
                            </div>
                            <div class="text-sm text-gray-900 mt-1">{{ $report->categoryLabel() }}</div>
                            <div class="text-xs text-gray-400 mt-0.5">
                                {{ $report->school?->name }} &middot; reported {{ $report->created_at->diffForHumans() }}
                            </div>
                        </div>
                        <span class="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">{{ $report->statusLabel() }}</span>
                    </div>
                </a>
            @empty
                <p class="p-6 text-sm text-gray-400">No cases in this view.</p>
            @endforelse
        </div>
    </div>
</div>
