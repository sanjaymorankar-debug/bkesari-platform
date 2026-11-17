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
use Illuminate\Support\Str;
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

        // One next step, and with it the screen's one primary action: what
        // this parent most needs to do now, in the order the platform
        // unlocks things (link a school, wait for it, follow a complaint).
        $openComplaint = $myComplaints->first(fn ($c) => ! in_array($c->status, ['resolved', 'closed'], true));
        $next = match (true) {
            $mySchools->isEmpty() => ['title' => __('Link your school'), 'text' => __('Your school approves the link. Then you can rate it, raise a concern and, with your consent, follow your child’s growth.'), 'href' => route('onboarding'), 'action' => __('Link my school')],
            ! $mySchools->contains('status', 'verified') => ['title' => __('Waiting for your school'), 'text' => __('Your school has not approved your link yet. You can still look around.'), 'href' => route('schools.index'), 'action' => __('Find a school')],
            $openComplaint !== null => ['title' => __('Your complaint :number', ['number' => $openComplaint->complaint_number]), 'text' => __('Status: :status. See what has happened since.', ['status' => __(ucfirst(str_replace('_', ' ', $openComplaint->status)))]), 'href' => route('complaints.show', $openComplaint), 'action' => __('Open complaint')],
            default => ['title' => __('Something not right at school?'), 'text' => __('Raise it privately. The school sees that a verified parent raised it, never who.'), 'href' => route('complaints.create'), 'action' => __('Report a problem')],
        };

        return [
            'myComplaints' => $myComplaints,
            'mySchools' => $mySchools,
            'myChildren' => $myChildren,
            'next' => $next,
            'openCount' => $myComplaints->whereNotIn('status', ['resolved', 'closed'])->count(),
            'firstName' => Str::before(trim($user->name), ' ') ?: $user->name,
            'today' => now('Asia/Kolkata')->format('j M Y'),
        ];
    }

    public function rendering($view): void
    {
        $view->title(__('Parent Dashboard'));
    }
}; ?>

<div>
    <x-slot name="header">
        <p class="k-eyebrow"><x-k-icon name="users" /> {{ __('Parent Dashboard') }}</p>
        <h1>{{ __('Namaste, :name', ['name' => $firstName]) }}</h1>
        <p class="edu-page-head__lead">{{ $today }}</p>
    </x-slot>

    <div class="edu-dash">
        <section class="k-card edu-next" aria-labelledby="next-title">
            <p class="k-chip k-chip--accent k-chip--plain">{{ __('Next step') }}</p>
            <h2 id="next-title">{{ $next['title'] }}</h2>
            <p>{{ $next['text'] }}</p>
            <a href="{{ $next['href'] }}" wire:navigate class="k-btn">{{ $next['action'] }} <x-k-icon name="arrow-right" /></a>
        </section>

        <ul class="k-stats edu-stats" role="list" aria-label="{{ __('At a glance') }}">
            <li class="k-stat">
                <span class="k-stat__value">{{ $myChildren->count() }}</span>
                <span class="k-stat__label">{{ __('Children linked') }}</span>
            </li>
            <li class="k-stat">
                <span class="k-stat__value">{{ $mySchools->where('status', 'verified')->count() }}</span>
                <span class="k-stat__label">{{ __('Schools approved') }}</span>
            </li>
            <li class="k-stat">
                <span class="k-stat__value">{{ $openCount }}</span>
                <span class="k-stat__label">{{ __('Complaints still open') }}</span>
            </li>
        </ul>

        <section aria-labelledby="children-title">
            <div class="edu-section-bar">
                <h2 id="children-title">{{ __('My Children') }}</h2>
                <a href="{{ route('consent.manage') }}" wire:navigate class="k-link-arrow">{{ __('Consent settings') }} <x-k-icon name="arrow-right" /></a>
            </div>
            @if ($myChildren->isEmpty())
                <div class="k-card k-empty edu-empty--compact">
                    <span class="k-picon"><x-k-icon name="users" /></span>
                    <p>{{ __('No child linked to your account yet. Once a school verifies your link to your child, their growth record appears here.') }}</p>
                </div>
            @else
                <ul class="k-statuslist" role="list">
                    @foreach ($myChildren as $child)
                        <li class="k-statusrow" wire:key="child-{{ $child['id'] }}">
                            <span class="k-avatar" aria-hidden="true">{{ mb_strtoupper(mb_substr($child['name'], 0, 1)) }}</span>
                            <div class="min-w-0">
                                <h3>{{ $child['name'] }}</h3>
                                <div class="k-statusrow__meta">
                                    @if ($child['growth_consent'])
                                        <span class="k-chip k-chip--success">{{ __('Growth tracking on') }}</span>
                                    @else
                                        <span class="k-chip k-chip--warning">{{ __('Growth tracking off') }}</span>
                                    @endif
                                    @if ($child['health_consent'] && $child['open_followups'] > 0)
                                        <span class="k-chip k-chip--warning">{{ trans_choice(':count health follow-up still open.|:count health follow-ups still open.', $child['open_followups']) }}</span>
                                    @endif
                                </div>
                                @unless ($child['growth_consent'])
                                    <p class="mt-1">{{ __('Growth tracking is off — nothing is being collected.') }}</p>
                                @endunless
                            </div>
                            <div class="k-statusrow__action edu-actions">
                                @if ($child['growth_consent'])
                                    <a href="{{ route('growth.show', $child['id']) }}" wire:navigate class="k-btn k-btn--soft" aria-label="{{ __('View growth record of :name', ['name' => $child['name']]) }}">{{ __('View growth') }}</a>
                                @else
                                    <a href="{{ route('consent.manage') }}" wire:navigate class="k-btn k-btn--secondary">{{ __('Review consent') }}</a>
                                @endif
                                @if ($child['health_consent'])
                                    <a href="{{ route('health.show', $child['id']) }}" wire:navigate class="k-btn k-btn--secondary" aria-label="{{ __('Health record of :name', ['name' => $child['name']]) }}">{{ __('Health record') }}</a>
                                @endif
                            </div>

                            @if ($child['growth_consent'])
                                <div class="edu-goals">
                                    @if (count($child['goals']))
                                        <h4>{{ __('This term’s goals') }}</h4>
                                        <ul role="list">
                                            @foreach ($child['goals'] as $goal)
                                                <li>
                                                    <span>{{ $goal['statement'] }}</span>
                                                    <span class="k-chip {{ match ($goal['status']) { 'achieved' => 'k-chip--success', 'in_progress' => 'k-chip--info', 'continuing' => 'k-chip--warning', default => '' } }}">{{ $goal['label'] }}</span>
                                                </li>
                                            @endforeach
                                        </ul>
                                    @else
                                        <p class="edu-none">{{ __('No growth plan has been shared with you yet this term.') }}</p>
                                    @endif
                                </div>
                            @endif
                        </li>
                    @endforeach
                </ul>
            @endif
        </section>

        <div class="edu-dash__split">
            <section class="k-card edu-panel" aria-labelledby="schools-title">
                <div class="edu-panel__head">
                    <h2 id="schools-title">{{ __('My Schools') }}</h2>
                    <a href="{{ route('schools.index') }}" wire:navigate class="k-link-arrow">{{ __('Find School') }} <x-k-icon name="arrow-right" /></a>
                </div>
                @if ($mySchools->isEmpty())
                    <p class="edu-none">{{ __('No linked schools yet. Use "Find School" to link one.') }}</p>
                @else
                    <ul class="edu-rows" role="list">
                        @foreach ($mySchools as $rel)
                            <li>
                                <div class="edu-rows__main">
                                    <a href="{{ route('schools.show', $rel->school_id) }}" wire:navigate class="edu-rows__title k-link">{{ $rel->school->name }}</a>
                                    <p class="edu-rows__sub">{{ $rel->school->city }}</p>
                                </div>
                                <span class="k-chip {{ $rel->status === 'verified' ? 'k-chip--success' : ($rel->status === 'rejected' ? 'k-chip--danger' : 'k-chip--warning') }}">{{ __(ucfirst($rel->status)) }}</span>
                            </li>
                        @endforeach
                    </ul>
                @endif
            </section>

            <section class="k-card edu-panel edu-panel--quiet" aria-labelledby="retaliation-title">
                <span class="k-picon k-picon--sm"><x-k-icon name="shield" /></span>
                <h2 id="retaliation-title" class="edu-panel__title mt-3">{{ __('Facing pressure after a complaint?') }}</h2>
                <p>{{ __('Facing pressure or unfair treatment after raising a concern? Report it separately; it is reviewed first.') }}</p>
                <a href="{{ route('retaliation.create') }}" wire:navigate class="k-btn k-btn--secondary">{{ __('Report Retaliation') }}</a>
            </section>
        </div>

        <section class="k-card edu-panel" aria-labelledby="complaints-title">
            <div class="edu-panel__head">
                <h2 id="complaints-title">{{ __('My Complaints') }}</h2>
                <a href="{{ route('complaints.create') }}" wire:navigate class="k-link-arrow">{{ __('Report a problem') }} <x-k-icon name="arrow-right" /></a>
            </div>
            @if ($myComplaints->isEmpty())
                <p class="edu-none">{{ __("You haven't submitted any complaints.") }}</p>
            @else
                <ul class="edu-rows" role="list">
                    @foreach ($myComplaints as $complaint)
                        <li class="edu-rows__item--link">
                            <div class="edu-rows__main">
                                <a href="{{ route('complaints.show', $complaint) }}" wire:navigate class="edu-stretch edu-rows__title">{{ $complaint->subject }}</a>
                                <p class="edu-rows__sub">{{ $complaint->complaint_number }} &middot; {{ $complaint->school?->name }} &middot; {{ $complaint->created_at->format('j M Y') }}</p>
                            </div>
                            <x-complaint-status :status="$complaint->status" />
                        </li>
                    @endforeach
                </ul>
            @endif
        </section>
    </div>
</div>
