<?php

use App\Models\AnonymousIdentity;
use App\Models\HealthFollowup;
use App\Models\ParentSchoolRelationship;
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

        $myRefs = AnonymousIdentity::where('user_id', $user->id)->pluck('anonymous_ref');

        $myComplaints = \App\Models\Complaint::whereIn('anonymous_ref', $myRefs)
            ->with('school:id,name')->latest()->get();

        $mySchools = ParentSchoolRelationship::where('user_id', $user->id)
            ->with('school:id,name,city')->get();

        // Children this parent is verified for, with whether growth data is
        // switched on — the consent state is shown here rather than hidden,
        // so a parent always knows what is and isn't being collected.
        $consent = app(ConsentService::class);

        $myChildren = User::whereIn('id', app(DevelopmentAccessService::class)->guardianChildIds($user))
            ->orderBy('name')
            ->get(['id', 'name'])
            ->map(fn (User $child): array => [
                'id' => $child->id,
                'name' => $child->name,
                'growth_consent' => $consent->hasConsent($child->id, 'capability_growth'),
                'health_consent' => $consent->hasConsent($child->id, 'physical_health'),
                // Open follow-ups are surfaced on the dashboard rather than
                // only inside the record: a screening finding nobody acted on
                // is exactly what a parent needs pushed at them.
                'open_followups' => HealthFollowup::where('student_user_id', $child->id)
                    ->whereNotIn('status', ['completed', 'closed'])->count(),
            ]);

        return compact('myComplaints', 'mySchools', 'myChildren');
    }
}; ?>

<div>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">Parent Dashboard</h2>
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
                <p class="text-sm text-gray-400">No linked schools yet. Use "Find School" to link one.</p>
            @endforelse
        </div>

        <div class="bg-white rounded-lg shadow p-6">
            <div class="flex justify-between items-center mb-4">
                <h3 class="font-semibold text-gray-900">My Children</h3>
                <a href="{{ route('consent.manage') }}" wire:navigate class="text-sm text-indigo-600 hover:underline">Consent settings</a>
            </div>
            @forelse ($myChildren as $child)
                <div class="flex flex-wrap items-center justify-between gap-2 py-3 border-b last:border-0">
                    <div>
                        <div class="text-sm font-medium text-gray-900">{{ $child['name'] }}</div>
                        @if (! $child['growth_consent'])
                            <div class="text-xs text-amber-700">
                                Growth tracking is off — nothing is being collected.
                            </div>
                        @endif
                        @if ($child['health_consent'] && $child['open_followups'] > 0)
                            <div class="text-xs text-amber-700">
                                {{ $child['open_followups'] }} health
                                {{ Str::plural('follow-up', $child['open_followups']) }} still open.
                            </div>
                        @endif
                    </div>
                    <div class="flex gap-2">
                        @if ($child['health_consent'])
                            <a href="{{ route('health.show', $child['id']) }}" wire:navigate
                                class="px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50">Health record</a>
                        @endif
                        @if ($child['growth_consent'])
                            <a href="{{ route('growth.show', $child['id']) }}" wire:navigate
                                class="px-3 py-1.5 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700">View growth</a>
                        @else
                            <a href="{{ route('consent.manage') }}" wire:navigate
                                class="px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50">Review consent</a>
                        @endif
                    </div>
                </div>
            @empty
                <p class="text-sm text-gray-400">
                    No child linked to your account yet. Once a school verifies your link to your child,
                    their growth record appears here.
                </p>
            @endforelse
        </div>

        <div class="bg-white rounded-lg shadow p-6">
            <a href="{{ route('retaliation.create') }}" wire:navigate class="inline-flex items-center px-3 py-1.5 bg-gray-800 text-white text-sm rounded-md hover:bg-gray-700">Report Retaliation</a>
        </div>

        <div class="bg-white rounded-lg shadow p-6">
            <h3 class="font-semibold text-gray-900 mb-4">My Complaints</h3>
            @forelse ($myComplaints as $complaint)
                <a href="{{ route('complaints.show', $complaint) }}" wire:navigate class="flex justify-between py-2 border-b last:border-0 text-sm hover:bg-gray-50 -mx-2 px-2 rounded">
                    <span>{{ $complaint->complaint_number }} — {{ $complaint->subject }}</span>
                    <span class="text-gray-400">{{ str_replace('_', ' ', $complaint->status) }}</span>
                </a>
            @empty
                <p class="text-sm text-gray-400">You haven't submitted any complaints.</p>
            @endforelse
        </div>
    </div>
</div>
