<?php

use App\Models\CapabilityObservation;
use App\Models\GrowthPlan;
use App\Models\User;
use App\Services\ConsentService;
use App\Services\DevelopmentAccessService;
use Illuminate\Support\Facades\Auth;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

/**
 * Spec section 15's "what parents and teachers see", and the visible half of
 * section 16's loop.
 *
 * The page is organised as: where things are going well right now → where
 * support would help → what we are doing about it. That ordering is
 * deliberate. It is also why observations are grouped by domain and always
 * carry their date: the moment this page can be read as a summary judgement
 * of the child rather than a record of specific moments, it has failed the
 * rule it exists to enforce.
 */
new #[Layout('layouts.app')] class extends Component
{
    public User $student;

    /**
     * True when the viewer is entitled to this record but the guardian has
     * switched growth tracking off. That is a different situation from "not
     * your child", and telling a guardian they have no access to their own
     * child's record — when they are the one who turned it off — would be
     * both wrong and alarming. So this case explains itself instead of 403ing.
     */
    public bool $consentOff = false;

    public function mount(User $student): void
    {
        $this->student = $student;

        $access = app(DevelopmentAccessService::class);

        if ($access->canView(Auth::user(), $student->id, 'capability_growth')) {
            return;
        }

        abort_unless(
            $access->isVerifiedGuardian(Auth::user(), $student->id),
            403,
            'You do not have access to this child\'s growth record.'
        );

        $this->consentOff = true;
    }

    public function with(): array
    {
        if ($this->consentOff) {
            return [
                'strengths' => collect(), 'growthAreas' => collect(), 'plan' => null,
                'isGuardian' => true, 'isSelf' => false, 'hasCareerConsent' => false,
                'manageableSchoolId' => null, 'domains' => CapabilityObservation::DOMAINS,
            ];
        }

        $viewer = Auth::user();
        $access = app(DevelopmentAccessService::class);

        $observations = CapabilityObservation::query()
            ->where('student_user_id', $this->student->id)
            ->visible()
            ->with('observer:id,name')
            ->orderByDesc('observed_on')
            ->get();

        $plan = GrowthPlan::query()
            ->where('student_user_id', $this->student->id)
            ->whereNotNull('shared_with_parent_at')
            ->with('goals')
            ->latest('academic_term')
            ->first();

        // Staff see their own draft too, so they can keep working on it.
        if ($plan === null) {
            $plan = GrowthPlan::query()
                ->where('student_user_id', $this->student->id)
                ->whereIn('school_id', $this->schoolIdsViewerManages($viewer))
                ->with('goals')
                ->latest('academic_term')
                ->first();
        }

        // The school (if any) where this viewer may author the growth plan.
        // Staff need a way in; guardians and the child do not get one, since
        // the plan is authored school-side.
        $manageableSchoolId = \App\Models\StudentSchoolRelationship::query()
            ->where('user_id', $this->student->id)
            ->where('status', 'verified')
            ->pluck('school_id')
            ->first(fn (int $schoolId): bool => $access->canManageGrowthPlan($viewer, $this->student->id, $schoolId));

        return [
            'strengths' => $observations->where('observation_type', 'strength')->groupBy('domain'),
            'growthAreas' => $observations->where('observation_type', 'growth_area')->groupBy('domain'),
            'plan' => $plan,
            'manageableSchoolId' => $manageableSchoolId,
            'isGuardian' => $access->isVerifiedGuardian($viewer, $this->student->id),
            'isSelf' => $viewer->id === $this->student->id,
            'hasCareerConsent' => app(ConsentService::class)->hasConsent($this->student->id, 'career_pathway'),
            'domains' => CapabilityObservation::DOMAINS,
        ];
    }

    private function schoolIdsViewerManages(User $viewer): array
    {
        return \App\Models\TeacherSchoolRelationship::where('user_id', $viewer->id)
            ->where('status', 'verified')->pluck('school_id')
            ->merge(\App\Models\SchoolStaff::where('user_id', $viewer->id)->pluck('school_id'))
            ->unique()->values()->all();
    }
}; ?>

<div>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">
            {{ $isSelf ? 'My Growth' : $student->name . "'s Growth" }}
        </h2>
    </x-slot>

    <div class="py-8 max-w-4xl mx-auto sm:px-6 lg:px-8 space-y-6">

        @if ($consentOff)
            <div class="bg-white rounded-lg shadow p-6">
                <h3 class="font-semibold text-gray-900 mb-2">Growth tracking is turned off</h3>
                <p class="text-sm text-gray-600 mb-4">
                    You turned off growth and capability observations for {{ $student->name }}, so nothing is
                    being collected and nothing is shown here — to you or to the school. You can turn it back
                    on at any time, and you don't have to give a reason either way.
                </p>
                <a href="{{ route('consent.manage') }}" wire:navigate
                    class="inline-block px-4 py-2 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700">
                    Consent settings
                </a>
            </div>
        @else

        <div class="bg-indigo-50 border border-indigo-100 rounded-lg p-4">
            <p class="text-sm text-indigo-900">
                <strong>This is a picture of right now, not a label.</strong>
                These are specific things people noticed on specific days. They describe moments, not
                {{ $isSelf ? 'who you are' : 'who ' . $student->name . ' is' }}, and they are expected to change.
                Nothing here is a grade, a rank, or used to place
                {{ $isSelf ? 'you' : $student->name }} in an ability group.
            </p>
        </div>

        <div class="bg-white rounded-lg shadow p-6">
            <h3 class="font-semibold text-gray-900 mb-4">
                {{ $isSelf ? 'What you are doing well right now' : 'Where ' . $student->name . ' is doing well right now' }}
            </h3>

            @forelse ($strengths as $domain => $items)
                <div class="mb-5 last:mb-0">
                    <h4 class="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                        {{ $domains[$domain] ?? $domain }}
                    </h4>
                    @foreach ($items as $observation)
                        <div class="border-l-2 border-green-400 pl-3 py-1.5 mb-2">
                            <p class="text-sm text-gray-800">{{ $observation->observation }}</p>
                            @if ($observation->evidence_context)
                                <p class="text-xs text-gray-500 mt-0.5">{{ $observation->evidence_context }}</p>
                            @endif
                            <p class="text-xs text-gray-400 mt-1">
                                {{ ucfirst($observation->observer_role) }} &middot;
                                {{ $observation->observed_on->format('j M Y') }} &middot;
                                {{ $observation->strand }}
                            </p>
                        </div>
                    @endforeach
                </div>
            @empty
                <p class="text-sm text-gray-400">Nothing recorded yet this term.</p>
            @endforelse
        </div>

        <div class="bg-white rounded-lg shadow p-6">
            <h3 class="font-semibold text-gray-900 mb-1">
                {{ $isSelf ? 'What you could use support with' : 'What ' . $student->name . ' could use support with' }}
            </h3>
            <p class="text-xs text-gray-500 mb-4">Each of these should have a plan attached below — never a gap with no next step.</p>

            @forelse ($growthAreas as $domain => $items)
                <div class="mb-5 last:mb-0">
                    <h4 class="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                        {{ $domains[$domain] ?? $domain }}
                    </h4>
                    @foreach ($items as $observation)
                        <div class="border-l-2 border-amber-400 pl-3 py-1.5 mb-2">
                            <p class="text-sm text-gray-800">{{ $observation->observation }}</p>
                            @if ($observation->evidence_context)
                                <p class="text-xs text-gray-500 mt-0.5">{{ $observation->evidence_context }}</p>
                            @endif
                            <p class="text-xs text-gray-400 mt-1">
                                {{ ucfirst($observation->observer_role) }} &middot;
                                {{ $observation->observed_on->format('j M Y') }} &middot;
                                {{ $observation->strand }}
                            </p>
                        </div>
                    @endforeach
                </div>
            @empty
                <p class="text-sm text-gray-400">Nothing recorded yet this term.</p>
            @endforelse
        </div>

        <div class="bg-white rounded-lg shadow p-6">
            <div class="flex items-center justify-between mb-4">
                <h3 class="font-semibold text-gray-900">What we're doing about it</h3>
                @if ($plan)
                    <span class="text-xs text-gray-400">{{ $plan->academic_term }}</span>
                @endif
            </div>

            @if ($plan && $plan->goals->isNotEmpty())
                @if ($plan->summary_for_parent)
                    <p class="text-sm text-gray-700 mb-4">{{ $plan->summary_for_parent }}</p>
                @endif

                @foreach ($plan->goals as $goal)
                    <div class="border border-gray-200 rounded-lg p-4 mb-3 last:mb-0">
                        <div class="flex items-start justify-between gap-3 mb-3">
                            <p class="text-sm font-medium text-gray-900">{{ $goal->goal_statement }}</p>
                            <span class="shrink-0 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                                {{ $goal->statusLabel() }}
                            </span>
                        </div>
                        <div class="grid sm:grid-cols-2 gap-3 text-sm">
                            <div class="bg-gray-50 rounded p-3">
                                <div class="text-xs font-semibold text-gray-500 mb-1">At school</div>
                                <p class="text-gray-700">{{ $goal->support_at_school }}</p>
                            </div>
                            <div class="bg-gray-50 rounded p-3">
                                <div class="text-xs font-semibold text-gray-500 mb-1">At home</div>
                                <p class="text-gray-700">{{ $goal->support_at_home }}</p>
                            </div>
                        </div>
                        @if ($goal->student_voice)
                            <div class="mt-3 text-sm">
                                <span class="text-xs font-semibold text-gray-500">In {{ $isSelf ? 'your' : $student->name . "'s" }} own words:</span>
                                <p class="text-gray-700 italic">{{ $goal->student_voice }}</p>
                            </div>
                        @endif
                    </div>
                @endforeach

                @if ($isGuardian && $plan->isSharedWithParent() && ! $plan->parent_acknowledged_at)
                    <p class="text-xs text-amber-700 mt-3">
                        Your teacher has shared this plan with you.
                        <a href="{{ route('growth.plan', [$student->id, $plan->school_id]) }}" wire:navigate class="underline">Review and respond &rarr;</a>
                    </p>
                @endif
            @else
                <p class="text-sm text-gray-400">No growth plan set for this term yet.</p>
            @endif
        </div>

        <div class="flex flex-wrap gap-3">
            <a href="{{ route('growth.observe', $student->id) }}" wire:navigate
                class="px-4 py-2 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700">
                Add an observation
            </a>
            @if ($manageableSchoolId)
                <a href="{{ route('growth.plan', [$student->id, $manageableSchoolId]) }}" wire:navigate
                    class="px-4 py-2 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50">
                    {{ $plan ? 'Manage growth plan' : 'Start a growth plan' }}
                </a>
            @endif
            @if ($hasCareerConsent)
                <a href="{{ route('career.show', $student->id) }}" wire:navigate
                    class="px-4 py-2 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50">
                    Career &amp; interests
                </a>
            @endif
            <a href="{{ route('life-skills.show', $student->id) }}" wire:navigate
                class="px-4 py-2 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50">
                Life skills
            </a>
        </div>

        @endif
    </div>
</div>
