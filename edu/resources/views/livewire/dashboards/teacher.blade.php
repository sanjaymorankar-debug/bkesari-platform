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
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">Teacher Dashboard</h2>
    </x-slot>

    <div class="py-8 max-w-5xl mx-auto sm:px-6 lg:px-8 space-y-6">
        <div class="bg-white rounded-lg shadow p-6">
            <div class="flex justify-between items-center mb-4">
                <h3 class="font-semibold text-gray-900">My Schools</h3>
                <a href="{{ route('schools.index') }}" wire:navigate class="text-sm text-indigo-600 hover:underline">Find School</a>
            </div>
            @forelse ($mySchools as $rel)
                <div class="flex justify-between py-2 border-b last:border-0 text-sm">
                    <a href="{{ route('schools.show', $rel->school_id) }}" wire:navigate class="text-indigo-600 hover:underline">{{ $rel->school->name }}</a>
                    <span class="text-gray-400">{{ ucfirst($rel->status) }}</span>
                </div>
            @empty
                <p class="text-sm text-gray-400">No linked school yet. Use "Find School" to link one.</p>
            @endforelse
        </div>

        <div class="bg-white rounded-lg shadow p-6">
            <h3 class="font-semibold text-gray-900 mb-1">Student Growth</h3>
            <p class="text-xs text-gray-400 mb-4">
                Students whose guardian has agreed to growth tracking. A child whose family has not
                agreed does not appear here, and no record exists for them.
            </p>
            @forelse ($myStudents as $student)
                <div class="flex items-center justify-between py-2 border-b last:border-0 text-sm">
                    <span class="text-gray-800">{{ $student->name }}</span>
                    <div class="flex gap-3">
                        <a href="{{ route('growth.show', $student->id) }}" wire:navigate class="text-indigo-600 hover:underline">View</a>
                        <a href="{{ route('growth.observe', $student->id) }}" wire:navigate class="text-indigo-600 hover:underline">Add observation</a>
                    </div>
                </div>
            @empty
                <p class="text-sm text-gray-400">No students with growth tracking enabled yet.</p>
            @endforelse
        </div>

        <div class="bg-white rounded-lg shadow p-6">
            <h3 class="font-semibold text-gray-900 mb-2">My Teacher Effectiveness Index</h3>
            <p class="text-xs text-gray-400 mb-4">Private to you — never shown publicly, to the school, or to parents/students. See spec section AI.</p>
            @if ($myEffectivenessScore)
                <div class="flex items-center gap-6">
                    <div>
                        <div class="text-3xl font-bold text-indigo-600">{{ $myEffectivenessScore->score }}</div>
                        <div class="text-xs text-gray-400">{{ str_replace('_', ' ', $myEffectivenessScore->confidence) }} confidence &middot; {{ $myEffectivenessScore->response_count }} responses</div>
                    </div>
                    <div class="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                        @foreach (($myEffectivenessScore->component_breakdown ?? []) as $key => $dimension)
                            <div class="bg-gray-50 rounded p-2">
                                <div class="text-gray-500">{{ $dimension['label'] }}</div>
                                <div class="font-semibold text-gray-800">{{ $dimension['average'] ?? '—' }} / 5</div>
                            </div>
                        @endforeach
                    </div>
                </div>
            @else
                <p class="text-sm text-gray-400">Not enough feedback yet to calculate a score.</p>
            @endif
        </div>
    </div>
</div>
