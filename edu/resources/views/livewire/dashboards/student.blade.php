<?php

use App\Models\AnonymousIdentity;
use App\Models\StudentSchoolRelationship;
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

        $mySchools = StudentSchoolRelationship::where('user_id', $user->id)
            ->with('school:id,name,city')->get();

        $openReport = $myComplaints->first(fn ($c) => ! in_array($c->status, ['resolved', 'closed'], true));

        // "Getting started" is about the account, never about the student:
        // the growth framework forbids turning a child's record into a
        // figure (STUDENT_GROWTH_FRAMEWORK.md, rule 1), so the ring counts
        // setup steps and nothing else.
        $steps = [
            ['label' => __('Account created'), 'done' => true],
            ['label' => __('School link requested'), 'done' => $mySchools->isNotEmpty()],
            ['label' => __('School approved your link'), 'done' => $mySchools->contains('status', 'verified')],
        ];
        $stepsDone = collect($steps)->where('done', true)->count();

        $continue = match (true) {
            $mySchools->isEmpty() => ['title' => __('Link your school'), 'text' => __('Your school approves the link, then your growth record and reports open up.'), 'href' => route('onboarding'), 'action' => __('Link my school')],
            ! $mySchools->contains('status', 'verified') => ['title' => __('Waiting for your school'), 'text' => __('Your school has not approved your link yet. You can still look around.'), 'href' => route('schools.index'), 'action' => __('Find a school')],
            $openReport !== null => ['title' => __('Your report :number', ['number' => $openReport->complaint_number]), 'text' => __('Status: :status. See what has happened since.', ['status' => str_replace('_', ' ', $openReport->status)]), 'href' => route('complaints.show', $openReport), 'action' => __('Open report')],
            default => ['title' => __('My growth'), 'text' => __('What you are doing well, and what you are working on this term.'), 'href' => route('growth.show', $user->id), 'action' => __('Open my growth')],
        };

        return [
            'myComplaints' => $myComplaints,
            'mySchools' => $mySchools,
            'steps' => $steps,
            'stepsDone' => $stepsDone,
            'continue' => $continue,
            'unread' => $user->unreadNotifications()->count(),
            'today' => now('Asia/Kolkata')->format('j M Y'),
            'firstName' => Str::before(trim($user->name), ' ') ?: $user->name,
        ];
    }

    public function rendering($view): void
    {
        $view->title(__('My Dashboard'));
    }
}; ?>

<div>
    <x-slot name="header">
        <p class="k-eyebrow"><x-k-icon name="education" /> {{ __('My Dashboard') }}</p>
        <h1>{{ __('Namaste, :name', ['name' => $firstName]) }}</h1>
        <p class="edu-page-head__lead">{{ $today }}</p>
    </x-slot>

    <div class="edu-dash">
        <div class="edu-dash__split edu-dash__split--wide">
            <section class="k-card edu-next" aria-labelledby="continue-title">
                <p class="k-chip k-chip--accent k-chip--plain">{{ __('Continue') }}</p>
                <h2 id="continue-title">{{ $continue['title'] }}</h2>
                <p>{{ $continue['text'] }}</p>
                <a href="{{ $continue['href'] }}" wire:navigate class="k-btn">{{ $continue['action'] }} <x-k-icon name="arrow-right" /></a>
            </section>

            <section class="k-card edu-setup" aria-labelledby="setup-title">
                <div class="k-ring shrink-0" style="--p: {{ (int) round($stepsDone / count($steps) * 100) }}" role="img"
                    aria-label="{{ __('Getting started: :done of :total steps done', ['done' => $stepsDone, 'total' => count($steps)]) }}">
                    <span aria-hidden="true">{{ $stepsDone }}/{{ count($steps) }}</span>
                </div>
                <div>
                    <h2 id="setup-title" class="edu-panel__title">{{ __('Getting started') }}</h2>
                    <ul class="edu-checklist" role="list">
                        @foreach ($steps as $step)
                            <li class="{{ $step['done'] ? 'is-done' : '' }}">
                                <x-k-icon :name="$step['done'] ? 'check' : 'pending'" class="k-icon--sm" />
                                <span>{{ $step['label'] }}<span class="k-sr-only">: {{ $step['done'] ? __('done') : __('not yet') }}</span></span>
                            </li>
                        @endforeach
                    </ul>
                </div>
            </section>
        </div>

        <ul class="k-stats edu-stats" role="list" aria-label="{{ __('Today') }}">
            <li class="k-stat relative">
                <span class="k-stat__value">{{ $unread }}</span>
                <span class="k-stat__label"><a href="{{ route('notifications.index') }}" wire:navigate class="k-link edu-cover">{{ trans_choice(':count new notification|:count new notifications', $unread) }}</a></span>
            </li>
            <li class="k-stat">
                <span class="k-stat__value">{{ $myComplaints->whereNotIn('status', ['resolved', 'closed'])->count() }}</span>
                <span class="k-stat__label">{{ trans_choice(':count report still open|:count reports still open', $myComplaints->whereNotIn('status', ['resolved', 'closed'])->count()) }}</span>
            </li>
        </ul>

        <div class="edu-dash__split">
            <section class="k-card edu-panel" aria-labelledby="growth-title">
                <span class="k-picon k-picon--sm"><x-k-icon name="sprout" /></span>
                <h2 id="growth-title" class="edu-panel__title mt-3">{{ __('My Growth') }}</h2>
                <p>{{ __("What you're doing well, what you're working on, and what you're interested in. This is yours — it isn't a grade, and nobody is ranked by it.") }}</p>
                <div class="edu-actions">
                    <a href="{{ route('growth.show', Auth::id()) }}" wire:navigate class="k-btn k-btn--soft">{{ __('My Growth') }}</a>
                    <a href="{{ route('career.show', Auth::id()) }}" wire:navigate class="k-btn k-btn--secondary">{{ __('My Interests') }}</a>
                </div>
            </section>

            <section class="k-card edu-panel" aria-labelledby="report-title">
                <span class="k-picon k-picon--sm"><x-k-icon name="shield" /></span>
                <h2 id="report-title" class="edu-panel__title mt-3">{{ __('Report a Problem') }}</h2>
                <p>{{ __("If something isn't right at school — teaching, safety, bullying, anything — you can report it privately. The school never sees your name, only that a verified student reported it.") }}</p>
                <div class="edu-actions">
                    <a href="{{ route('complaints.create') }}" wire:navigate class="k-btn k-btn--soft">{{ __('Report a Problem') }}</a>
                    <a href="{{ route('retaliation.create') }}" wire:navigate class="k-btn k-btn--secondary">{{ __('Report Retaliation') }}</a>
                </div>
            </section>
        </div>

        <section class="k-card edu-panel" aria-labelledby="school-title">
            <div class="edu-panel__head">
                <h2 id="school-title">{{ __('My School') }}</h2>
                <a href="{{ route('schools.index') }}" wire:navigate class="k-link-arrow">{{ __('Find School') }} <x-k-icon name="arrow-right" /></a>
            </div>
            @if ($mySchools->isEmpty())
                <p class="edu-none">{{ __('No linked school yet. Use "Find School" to link one.') }}</p>
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

        <section class="k-card edu-panel" aria-labelledby="reports-title">
            <h2 id="reports-title" class="edu-panel__title">{{ __('My Reports') }}</h2>
            @if ($myComplaints->isEmpty())
                <p class="edu-none">{{ __("You haven't submitted any reports.") }}</p>
            @else
                <ul class="edu-rows" role="list">
                    @foreach ($myComplaints as $complaint)
                        <li class="edu-rows__item--link">
                            <div class="edu-rows__main">
                                <a href="{{ route('complaints.show', $complaint) }}" wire:navigate class="edu-stretch edu-rows__title">{{ $complaint->subject }}</a>
                                <p class="edu-rows__sub">{{ $complaint->complaint_number }} &middot; {{ $complaint->created_at->format('j M Y') }}</p>
                            </div>
                            <x-complaint-status :status="$complaint->status" />
                        </li>
                    @endforeach
                </ul>
            @endif
        </section>
    </div>
</div>
