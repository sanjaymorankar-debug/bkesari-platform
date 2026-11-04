<?php

use App\Models\AnonymousIdentity;
use App\Models\StudentSchoolRelationship;
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
        ];
    }
}; ?>

<div>
    <x-slot name="header">
        <h2>{{ __('My Dashboard') }}</h2>
    </x-slot>

    <div class="max-w-5xl space-y-6">
        <div class="grid gap-4 md:grid-cols-3">
            <section class="k-card md:col-span-2" aria-labelledby="continue-title">
                <p class="k-chip k-chip--accent k-chip--plain">{{ __('Continue') }}</p>
                <h3 id="continue-title" class="mt-2 text-lg font-bold text-gray-900">{{ $continue['title'] }}</h3>
                <p class="text-gray-600 mt-1">{{ $continue['text'] }}</p>
                <a href="{{ $continue['href'] }}" wire:navigate class="k-btn mt-4">{{ $continue['action'] }}</a>
            </section>

            <section class="k-card flex items-center gap-4" aria-labelledby="setup-title">
                <div class="k-ring shrink-0" style="--p: {{ (int) round($stepsDone / count($steps) * 100) }}" role="img"
                    aria-label="{{ __('Getting started: :done of :total steps done', ['done' => $stepsDone, 'total' => count($steps)]) }}">
                    <span aria-hidden="true">{{ $stepsDone }}/{{ count($steps) }}</span>
                </div>
                <div>
                    <h3 id="setup-title" class="font-bold text-gray-900">{{ __('Getting started') }}</h3>
                    <ul class="mt-1 space-y-1 text-sm">
                        @foreach ($steps as $step)
                            <li class="{{ $step['done'] ? 'text-green-700' : 'text-gray-600' }}">
                                <span aria-hidden="true">{{ $step['done'] ? '✓' : '○' }}</span>
                                {{ $step['label'] }}<span class="sr-only">: {{ $step['done'] ? __('done') : __('not yet') }}</span>
                            </li>
                        @endforeach
                    </ul>
                </div>
            </section>
        </div>

        <section class="k-card" aria-labelledby="today-title">
            <div class="flex flex-wrap items-baseline justify-between gap-2">
                <h3 id="today-title" class="font-bold text-gray-900">{{ __('Today') }}</h3>
                <span class="text-sm text-gray-600">{{ $today }}</span>
            </div>
            <ul class="mt-2 space-y-2">
                <li>
                    <a href="{{ route('notifications.index') }}" wire:navigate class="k-link">
                        {{ trans_choice(':count new notification|:count new notifications', $unread) }}
                    </a>
                </li>
                <li class="text-gray-700">
                    {{ trans_choice(':count report still open|:count reports still open', $myComplaints->whereNotIn('status', ['resolved', 'closed'])->count()) }}
                </li>
            </ul>
        </section>

        <div class="k-card">
            <div class="flex justify-between items-center mb-4">
                <h3 class="font-semibold text-gray-900">{{ __('My School') }}</h3>
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
            <h3 class="font-semibold text-gray-900 mb-2">{{ __('My Growth') }}</h3>
            <p class="text-sm text-gray-600 mb-3">
                {{ __("What you're doing well, what you're working on, and what you're interested in. This is yours — it isn't a grade, and nobody is ranked by it.") }}
            </p>
            <div class="flex flex-wrap gap-3">
                <a href="{{ route('growth.show', Auth::id()) }}" wire:navigate class="k-btn">{{ __('My Growth') }}</a>
                <a href="{{ route('career.show', Auth::id()) }}" wire:navigate class="k-btn k-btn--secondary">{{ __('My Interests') }}</a>
            </div>
        </div>

        <div class="k-card">
            <h3 class="font-semibold text-gray-900 mb-2">{{ __('Report a Problem') }}</h3>
            <p class="text-sm text-gray-600 mb-3">
                {{ __("If something isn't right at school — teaching, safety, bullying, anything — you can report it privately. The school never sees your name, only that a verified student reported it.") }}
            </p>
            <div class="flex flex-wrap gap-3">
                <a href="{{ route('complaints.create') }}" wire:navigate class="k-btn k-btn--danger">{{ __('Report a Problem') }}</a>
                <a href="{{ route('retaliation.create') }}" wire:navigate class="k-btn k-btn--secondary">{{ __('Report Retaliation') }}</a>
            </div>
        </div>

        <div class="k-card">
            <h3 class="font-semibold text-gray-900 mb-4">{{ __('My Reports') }}</h3>
            @forelse ($myComplaints as $complaint)
                <a href="{{ route('complaints.show', $complaint) }}" wire:navigate class="flex flex-wrap justify-between gap-2 min-h-12 items-center py-2 border-b border-gray-200 last:border-0 text-sm hover:bg-gray-100 -mx-2 px-2 rounded-md">
                    <span>{{ $complaint->complaint_number }} — {{ $complaint->subject }}</span>
                    <span class="text-gray-600">{{ str_replace('_', ' ', $complaint->status) }}</span>
                </a>
            @empty
                <p class="text-sm text-gray-600">{{ __("You haven't submitted any reports.") }}</p>
            @endforelse
        </div>
    </div>
</div>
