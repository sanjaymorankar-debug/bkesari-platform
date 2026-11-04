<?php

use App\Models\TeacherEffectivenessScore;
use App\Models\TeacherSchoolRelationship;
use App\Models\User;
use App\Services\ConsentService;
use App\Services\DevelopmentAccessService;
use Illuminate\Support\Facades\Auth;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

new #[Layout('layouts.app')] class extends Component
{
    public function with(): array
    {
        $user = Auth::user();

        $mySchools = TeacherSchoolRelationship::where('user_id', $user->id)
            ->with('school:id,name,city')->get();

        // Privacy-restricted: only the teacher themself sees this — never
        // public, never the school (spec section AI).
        $myEffectivenessScore = TeacherEffectivenessScore::where('teacher_user_id', $user->id)
            ->latest('calculated_at')->first();

        // Only students whose guardian has switched growth tracking on appear
        // here. A child with consent off is not listed at all — the teacher
        // has no view of them to open, which is the point.
        $consent = app(ConsentService::class);

        $myStudents = User::whereIn('id', app(DevelopmentAccessService::class)->accessibleStudentIds($user))
            ->orderBy('name')
            ->get(['id', 'name'])
            ->filter(fn (User $student): bool => $consent->hasConsent($student->id, 'capability_growth'))
            ->values();

        return compact('mySchools', 'myEffectivenessScore', 'myStudents');
    }
}; ?>

<div>
    <x-slot name="header">
        <h2>{{ __('Teacher Dashboard') }}</h2>
    </x-slot>

    <div class="max-w-5xl space-y-6">
        <div class="grid gap-4 sm:grid-cols-2">
            <div class="k-card">
                <p class="text-sm text-gray-600 mb-0">{{ __('My Schools') }}</p>
                <p class="text-3xl font-bold text-gray-900 mb-0">{{ $mySchools->where('status', 'verified')->count() }}</p>
                <p class="text-sm text-gray-600 mb-0">{{ trans_choice(':count link waiting for approval|:count links waiting for approval', $mySchools->where('status', 'pending')->count()) }}</p>
            </div>
            <div class="k-card">
                <p class="text-sm text-gray-600 mb-0">{{ __('Students with growth tracking on') }}</p>
                <p class="text-3xl font-bold text-gray-900 mb-0">{{ $myStudents->count() }}</p>
                <p class="text-sm text-gray-600 mb-0">{{ __('Only where a guardian has agreed.') }}</p>
            </div>
        </div>

        <div class="k-card">
            <div class="flex justify-between items-center mb-4">
                <h3 class="font-semibold text-gray-900">{{ __('My Schools') }}</h3>
                <a href="{{ route('schools.index') }}" wire:navigate class="k-link text-sm">{{ __('Find School') }}</a>
            </div>
            @forelse ($mySchools as $rel)
                <div class="flex justify-between py-2 border-b border-gray-200 last:border-0 text-sm">
                    <a href="{{ route('schools.show', $rel->school_id) }}" wire:navigate class="k-link">{{ $rel->school->name }}</a>
                    <span class="k-chip {{ $rel->status === 'verified' ? 'k-chip--success' : ($rel->status === 'rejected' ? 'k-chip--danger' : 'k-chip--warning') }}">{{ __(ucfirst($rel->status)) }}</span>
                </div>
            @empty
                <p class="text-sm text-gray-600">{{ __('No linked school yet. Use "Find School" to link one.') }}</p>
            @endforelse
        </div>

        <div class="k-card">
            <h3 class="font-semibold text-gray-900 mb-1">{{ __('Student Growth') }}</h3>
            <p class="text-sm text-gray-600 mb-4">
                {{ __('Students whose guardian has agreed to growth tracking. A child whose family has not agreed does not appear here, and no record exists for them.') }}
            </p>
            @forelse ($myStudents as $student)
                <div class="flex flex-wrap items-center justify-between gap-2 py-2 border-b border-gray-200 last:border-0">
                    <span class="flex items-center gap-3 text-gray-800">
                        <span class="k-avatar" aria-hidden="true">{{ mb_strtoupper(mb_substr($student->name, 0, 1)) }}</span>
                        {{ $student->name }}
                    </span>
                    <div class="flex flex-wrap gap-2">
                        <a href="{{ route('growth.show', $student->id) }}" wire:navigate class="k-btn k-btn--secondary" aria-label="{{ __('View growth record of :name', ['name' => $student->name]) }}">{{ __('View') }}</a>
                        <a href="{{ route('growth.observe', $student->id) }}" wire:navigate class="k-btn" aria-label="{{ __('Add an observation for :name', ['name' => $student->name]) }}">{{ __('Add observation') }}</a>
                    </div>
                </div>
            @empty
                <p class="text-sm text-gray-600">{{ __('No students with growth tracking enabled yet.') }}</p>
            @endforelse
        </div>

        <div class="k-card">
            <h3 class="font-semibold text-gray-900 mb-2">{{ __('My Teacher Effectiveness Index') }}</h3>
            <p class="text-sm text-gray-600 mb-4">{{ __('Private to you — never shown publicly, to the school, or to parents/students. See spec section AI.') }}</p>
            @if ($myEffectivenessScore)
                <div class="flex flex-wrap items-center gap-6">
                    <div>
                        <div class="text-3xl font-bold text-indigo-700">{{ $myEffectivenessScore->score }}</div>
                        <div class="text-sm text-gray-600">{{ str_replace('_', ' ', $myEffectivenessScore->confidence) }} {{ __('confidence') }} &middot; {{ trans_choice(':count response|:count responses', $myEffectivenessScore->response_count) }}</div>
                    </div>
                    <div class="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
                        @foreach (($myEffectivenessScore->component_breakdown ?? []) as $key => $dimension)
                            <div class="bg-gray-100 rounded-md p-2">
                                <div class="text-gray-600">{{ $dimension['label'] }}</div>
                                <div class="font-semibold text-gray-800">{{ $dimension['average'] ?? '—' }} / 5</div>
                            </div>
                        @endforeach
                    </div>
                </div>
            @else
                <p class="text-sm text-gray-600">{{ __('Not enough feedback yet to calculate a score.') }}</p>
            @endif
        </div>
    </div>
</div>
