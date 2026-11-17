<?php

use App\Models\TeacherEffectivenessScore;
use App\Models\TeacherSchoolRelationship;
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

        return [
            'mySchools' => $mySchools,
            'myEffectivenessScore' => $myEffectivenessScore,
            'myStudents' => $myStudents,
            'firstName' => Str::before(trim($user->name), ' ') ?: $user->name,
            'today' => now('Asia/Kolkata')->format('j M Y'),
        ];
    }

    public function rendering($view): void
    {
        $view->title(__('Teacher Dashboard'));
    }
}; ?>

<div>
    <x-slot name="header">
        <p class="k-eyebrow"><x-k-icon name="book" /> {{ __('Teacher Dashboard') }}</p>
        <h1>{{ __('Namaste, :name', ['name' => $firstName]) }}</h1>
        <p class="edu-page-head__lead">{{ $today }}</p>
    </x-slot>

    <div class="edu-dash">
        <ul class="k-stats edu-stats" role="list" aria-label="{{ __('At a glance') }}">
            <li class="k-stat">
                <span class="k-stat__value">{{ $mySchools->where('status', 'verified')->count() }}</span>
                <span class="k-stat__label">{{ __('My Schools') }}</span>
                <span class="k-stat__source">{{ trans_choice(':count link waiting for approval|:count links waiting for approval', $mySchools->where('status', 'pending')->count()) }}</span>
            </li>
            <li class="k-stat">
                <span class="k-stat__value">{{ $myStudents->count() }}</span>
                <span class="k-stat__label">{{ __('Students with growth tracking on') }}</span>
                <span class="k-stat__source">{{ __('Only where a guardian has agreed.') }}</span>
            </li>
        </ul>

        <section class="k-card edu-panel" aria-labelledby="students-title">
            <h2 id="students-title" class="edu-panel__title">{{ __('Student Growth') }}</h2>
            <p class="edu-panel__intro">
                {{ __('Students whose guardian has agreed to growth tracking. A child whose family has not agreed does not appear here, and no record exists for them.') }}
            </p>
            @if ($myStudents->isEmpty())
                <p class="edu-none">{{ __('No students with growth tracking enabled yet.') }}</p>
            @else
                <ul class="edu-rows" role="list">
                    @foreach ($myStudents as $student)
                        <li wire:key="student-{{ $student->id }}">
                            <span class="edu-rows__main flex items-center gap-3">
                                <span class="k-avatar" aria-hidden="true">{{ mb_strtoupper(mb_substr($student->name, 0, 1)) }}</span>
                                <span class="edu-rows__title">{{ $student->name }}</span>
                            </span>
                            <div class="edu-actions">
                                <a href="{{ route('growth.show', $student->id) }}" wire:navigate class="k-btn k-btn--secondary" aria-label="{{ __('View growth record of :name', ['name' => $student->name]) }}">{{ __('View') }}</a>
                                <a href="{{ route('growth.observe', $student->id) }}" wire:navigate class="k-btn k-btn--soft" aria-label="{{ __('Add an observation for :name', ['name' => $student->name]) }}"><x-k-icon name="plus" /> {{ __('Add observation') }}</a>
                            </div>
                        </li>
                    @endforeach
                </ul>
            @endif
        </section>

        <section class="k-card edu-panel" aria-labelledby="schools-title">
            <div class="edu-panel__head">
                <h2 id="schools-title">{{ __('My Schools') }}</h2>
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

        <section class="k-card edu-panel" aria-labelledby="tei-title">
            <div class="edu-panel__head">
                <h2 id="tei-title">{{ __('My Teacher Effectiveness Index') }}</h2>
                <span class="k-chip k-chip--plain"><x-k-icon name="lock" class="k-icon--sm" /> {{ __('Only you') }}</span>
            </div>
            <p class="edu-panel__intro">{{ __('Private to you — never shown publicly, to the school, or to parents/students. See spec section AI.') }}</p>
            @if ($myEffectivenessScore)
                <div class="edu-tei">
                    <div>
                        <p class="edu-score__value">{{ $myEffectivenessScore->score }}</p>
                        <p class="edu-rows__sub">{{ __(':level confidence', ['level' => __(ucfirst(str_replace('_', ' ', $myEffectivenessScore->confidence)))]) }} &middot; {{ trans_choice(':count response|:count responses', $myEffectivenessScore->response_count) }}</p>
                    </div>
                    <ul class="k-bars edu-bars--grid" role="list">
                        @foreach (($myEffectivenessScore->component_breakdown ?? []) as $key => $dimension)
                            <li>
                                <span class="k-bars__label">{{ $dimension['label'] }}</span>
                                <span class="k-bars__value">{{ $dimension['average'] ?? '—' }}<span class="edu-of">/5</span></span>
                                <span class="k-bars__track" aria-hidden="true"><span class="k-bars__fill" style="--v: {{ isset($dimension['average']) ? round((float) $dimension['average'] / 5 * 100) : 0 }}"></span></span>
                            </li>
                        @endforeach
                    </ul>
                </div>
            @else
                <p class="edu-none">{{ __('Not enough feedback yet to calculate a score.') }}</p>
            @endif
        </section>
    </div>
</div>
