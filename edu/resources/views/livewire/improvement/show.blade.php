<?php

use App\Models\School;
use App\Services\SchoolImprovementService;
use Illuminate\Support\Facades\Auth;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

/**
 * Spec section 31 — the School Improvement Dashboard.
 *
 * Public on purpose. A trend view visible only to the school would let it
 * track its own progress while families still saw nothing but the current
 * snapshot, and the section's whole point is that improvement should be as
 * visible as criticism.
 */
new #[Layout('layouts.app')] class extends Component
{
    public School $school;

    public function mount(School $school): void
    {
        $this->school = $school;
    }

    public function with(): array
    {
        return [
            'trends' => app(SchoolImprovementService::class)->trends($this->school->id),
            'isOwnSchool' => Auth::user()?->schoolStaffAssignments()
                ->where('school_id', $this->school->id)->exists() ?? false,
        ];
    }
}; ?>

<div>
    <x-slot name="title">Improvement over time — {{ $school->name }}</x-slot>

    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">
            Improvement over time — {{ $school->name }}
        </h2>
    </x-slot>

    <div class="py-8 max-w-4xl mx-auto sm:px-6 lg:px-8 space-y-6">

        <div class="bg-white rounded-lg shadow p-6">
            <p class="text-sm text-gray-700">
                This page compares a school against <strong>its own history</strong>, not against other
                schools. A school that started badly and improved is doing something a school that has always
                coasted is not, and a snapshot cannot show the difference.
            </p>
            <p class="text-xs text-gray-500 mt-2">
                A direction is only shown where there are at least two years of data and enough responses
                behind each. Where there aren't, the page says so rather than drawing an arrow.
            </p>
        </div>

        @foreach ($trends as $key => $trend)
            <div class="bg-white rounded-lg shadow p-6">
                <div class="flex flex-wrap items-baseline justify-between gap-2 mb-1">
                    <h3 class="font-semibold text-gray-900">{{ $trend['label'] }}</h3>
                    <span class="text-xs px-2 py-0.5 rounded-full
                        @if ($trend['direction'] === 'up') bg-green-100 text-green-800
                        @elseif ($trend['direction'] === 'down') bg-amber-100 text-amber-900
                        @elseif ($trend['direction'] === 'flat') bg-gray-100 text-gray-700
                        @else bg-gray-100 text-gray-500 @endif">
                        {{ $trend['direction_label'] }}
                    </span>
                </div>

                <p class="text-xs text-gray-500 mb-4">{{ $trend['interpretation'] }}</p>

                @if (count($trend['points']) === 0)
                    <p class="text-sm text-gray-400">Nothing recorded yet.</p>
                @else
                    <div class="space-y-1">
                        @foreach ($trend['points'] as $point)
                            <div class="flex flex-wrap items-center justify-between gap-2 py-1 border-b last:border-0">
                                <span class="text-sm text-gray-600">{{ $point['year'] }}</span>
                                <span class="text-sm text-gray-900">
                                    @if ($point['value'] === null)
                                        <span class="text-gray-400">no data</span>
                                    @elseif ($trend['unit'] === '₹')
                                        ₹{{ number_format($point['value']) }}
                                    @else
                                        {{ $point['value'] }}{{ $trend['unit'] }}
                                    @endif
                                    <span class="text-xs text-gray-400">
                                        &middot; {{ $point['responses'] }} {{ Str::plural('record', $point['responses']) }}
                                    </span>
                                </span>
                            </div>
                        @endforeach
                    </div>
                @endif
            </div>
        @endforeach

        <div class="bg-white rounded-lg shadow p-6">
            <a href="{{ route('schools.show', $school) }}" wire:navigate class="text-sm text-indigo-600 hover:underline">
                Back to {{ $school->name }}
            </a>
        </div>
    </div>
</div>
