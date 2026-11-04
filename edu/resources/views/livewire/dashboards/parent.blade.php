<?php

use App\Models\AnonymousIdentity;
use App\Models\GrowthGoal;
use App\Models\GrowthPlan;
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
                'growth_consent' => $growth = $consent->hasConsent($child->id, 'capability_growth'),
                // This term's goals and where each one stands: what the
                // growth record itself shows a guardian, from the latest plan
                // shared with them. Statuses only, never a figure: the
                // framework forbids adding a child's record up into a score.
                'goals' => $growth
                    ? (GrowthPlan::where('student_user_id', $child->id)
                        ->whereNotNull('shared_with_parent_at')
                        ->with('goals')
                        ->latest('academic_term')
                        ->first()?->goals ?? collect())
                        ->map(fn (GrowthGoal $goal): array => [
                            'statement' => $goal->goal_statement,
                            'status' => $goal->status,
                            'label' => __($goal->statusLabel()),
                        ])->all()
                    : [],
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
        <h2>{{ __('Parent Dashboard') }}</h2>
    </x-slot>

    <div class="max-w-5xl space-y-6">
        <section class="k-card" aria-labelledby="children-title">
            <div class="flex flex-wrap justify-between items-center gap-2 mb-2">
                <h3 id="children-title" class="text-lg font-bold text-gray-900">{{ __('My Children') }}</h3>
                <a href="{{ route('consent.manage') }}" wire:navigate class="k-link text-sm">{{ __('Consent settings') }}</a>
            </div>
            @forelse ($myChildren as $child)
                <div class="py-4 border-b border-gray-200 last:border-0">
                    <div class="flex flex-wrap items-start justify-between gap-3">
                        <div class="flex items-center gap-3">
                            <span class="k-avatar" aria-hidden="true">{{ mb_strtoupper(mb_substr($child['name'], 0, 1)) }}</span>
                            <div>
                                <div class="font-semibold text-gray-900">{{ $child['name'] }}</div>
                                @if (! $child['growth_consent'])
                                    <div class="text-sm text-amber-700">
                                        {{ __('Growth tracking is off — nothing is being collected.') }}
                                    </div>
                                @endif
                                @if ($child['health_consent'] && $child['open_followups'] > 0)
                                    <div class="text-sm text-amber-700">
                                        {{ trans_choice(':count health follow-up still open.|:count health follow-ups still open.', $child['open_followups']) }}
                                    </div>
                                @endif
                            </div>
                        </div>
                        <div class="flex flex-wrap gap-2">
                            @if ($child['health_consent'])
                                <a href="{{ route('health.show', $child['id']) }}" wire:navigate class="k-btn k-btn--secondary">{{ __('Health record') }}</a>
                            @endif
                            @if ($child['growth_consent'])
                                <a href="{{ route('growth.show', $child['id']) }}" wire:navigate class="k-btn">{{ __('View growth') }}</a>
                            @else
                                <a href="{{ route('consent.manage') }}" wire:navigate class="k-btn k-btn--secondary">{{ __('Review consent') }}</a>
                            @endif
                        </div>
                    </div>

                    @if ($child['growth_consent'])
                        @if (count($child['goals']))
                            <h4 class="mt-4 text-sm font-semibold text-gray-700">{{ __('This term’s goals') }}</h4>
                            <ul class="mt-2 space-y-2">
                                @foreach ($child['goals'] as $goal)
                                    <li class="flex flex-wrap items-start justify-between gap-2 rounded-md bg-gray-100 px-3 py-2">
                                        <span class="text-sm text-gray-800">{{ $goal['statement'] }}</span>
                                        <span class="k-chip {{ match ($goal['status']) { 'achieved' => 'k-chip--success', 'in_progress' => 'k-chip--info', 'continuing' => 'k-chip--warning', default => '' } }}">{{ $goal['label'] }}</span>
                                    </li>
                                @endforeach
                            </ul>
                        @else
                            <p class="mt-3 text-sm text-gray-600">{{ __('No growth plan has been shared with you yet this term.') }}</p>
                        @endif
                    @endif
                </div>
            @empty
                <p class="text-sm text-gray-600">
                    {{ __('No child linked to your account yet. Once a school verifies your link to your child, their growth record appears here.') }}
                </p>
            @endforelse
        </section>

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
                <p class="text-sm text-gray-600">{{ __('No linked schools yet. Use "Find School" to link one.') }}</p>
            @endforelse
        </div>

        <div class="k-card flex flex-wrap items-center justify-between gap-3">
            <p class="text-sm text-gray-700 mb-0">{{ __('Facing pressure or unfair treatment after raising a concern? Report it separately; it is reviewed first.') }}</p>
            <a href="{{ route('retaliation.create') }}" wire:navigate class="k-btn k-btn--secondary">{{ __('Report Retaliation') }}</a>
        </div>

        <div class="k-card">
            <h3 class="font-semibold text-gray-900 mb-4">{{ __('My Complaints') }}</h3>
            @forelse ($myComplaints as $complaint)
                <a href="{{ route('complaints.show', $complaint) }}" wire:navigate class="flex flex-wrap justify-between gap-2 min-h-12 items-center py-2 border-b border-gray-200 last:border-0 text-sm hover:bg-gray-100 -mx-2 px-2 rounded-md">
                    <span>{{ $complaint->complaint_number }} — {{ $complaint->subject }}</span>
                    <span class="text-gray-600">{{ str_replace('_', ' ', $complaint->status) }}</span>
                </a>
            @empty
                <p class="text-sm text-gray-600">{{ __("You haven't submitted any complaints.") }}</p>
            @endforelse
        </div>
    </div>
</div>
