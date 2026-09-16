<?php

use App\Models\CapabilityObservation;
use App\Models\GrowthGoal;
use App\Models\GrowthPlan;
use App\Models\School;
use App\Models\User;
use App\Services\ConsentService;
use App\Services\DevelopmentAccessService;
use Illuminate\Support\Facades\Auth;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

/**
 * Spec section 16 — the growth loop's working surface.
 *
 * Staff draft the plan and share it; the guardian acknowledges it and adds
 * their side. Two constraints are enforced here rather than left to the UI:
 * a plan carries at most three goals per term (GrowthPlan::MAX_GOALS), and a
 * goal cannot be saved without both a school action and a home action, so the
 * spec's "never data with no path forward" rule holds at the point of entry.
 */
new #[Layout('layouts.app')] class extends Component
{
    public User $student;

    public School $school;

    public ?GrowthPlan $plan = null;

    public string $academicTerm = '';

    public string $summaryForParent = '';

    // New-goal form
    public string $goalDomain = '';

    public string $goalStatement = '';

    public string $supportAtSchool = '';

    public string $supportAtHome = '';

    public string $studentVoice = '';

    public string $flash = '';

    public function mount(User $student, School $school): void
    {
        $this->student = $student;
        $this->school = $school;

        abort_unless(
            app(DevelopmentAccessService::class)->canView(Auth::user(), $student->id, 'capability_growth'),
            403,
            'You do not have access to this child\'s growth plan.'
        );

        $this->plan = GrowthPlan::where('student_user_id', $student->id)
            ->where('school_id', $school->id)
            ->latest('academic_term')
            ->first();

        $this->academicTerm = $this->plan?->academic_term ?? $this->currentTerm();
        $this->summaryForParent = $this->plan?->summary_for_parent ?? '';
    }

    private function currentTerm(): string
    {
        $now = now();
        $startYear = $now->month >= 4 ? $now->year : $now->year - 1;

        return $startYear.'-'.substr((string) ($startYear + 1), 2).' Term '.($now->month >= 4 && $now->month <= 9 ? '1' : '2');
    }

    private function canManage(): bool
    {
        return app(DevelopmentAccessService::class)
            ->canManageGrowthPlan(Auth::user(), $this->student->id, $this->school->id);
    }

    public function createPlan(): void
    {
        abort_unless($this->canManage(), 403);
        app(ConsentService::class)->requireConsent($this->student->id, 'capability_growth');

        $validated = $this->validate([
            'academicTerm' => ['required', 'string', 'max:40'],
            'summaryForParent' => ['nullable', 'string', 'max:2000'],
        ]);

        $this->plan = GrowthPlan::firstOrCreate(
            [
                'student_user_id' => $this->student->id,
                'school_id' => $this->school->id,
                'academic_term' => $validated['academicTerm'],
            ],
            [
                'created_by_user_id' => Auth::id(),
                'status' => 'draft',
                'summary_for_parent' => $validated['summaryForParent'] ?: null,
            ]
        );

        $this->flash = 'Plan started. Add up to '.GrowthPlan::MAX_GOALS.' goals, then share it.';
    }

    public function addGoal(): void
    {
        abort_unless($this->canManage(), 403);
        abort_if($this->plan === null, 400, 'Start the plan first.');
        app(ConsentService::class)->requireConsent($this->student->id, 'capability_growth');

        if (! $this->plan->hasGoalCapacity()) {
            $this->flash = 'A term carries at most '.GrowthPlan::MAX_GOALS.' goals, so the plan stays something a child and family can actually act on.';

            return;
        }

        $validated = $this->validate([
            'goalDomain' => ['required', 'in:'.implode(',', array_keys(CapabilityObservation::DOMAINS))],
            'goalStatement' => ['required', 'string', 'min:10', 'max:1000'],
            'supportAtSchool' => ['required', 'string', 'min:10', 'max:1000'],
            'supportAtHome' => ['required', 'string', 'min:10', 'max:1000'],
            'studentVoice' => ['nullable', 'string', 'max:1000'],
        ]);

        GrowthGoal::create([
            'growth_plan_id' => $this->plan->id,
            'domain' => $validated['goalDomain'],
            'goal_statement' => $validated['goalStatement'],
            'support_at_school' => $validated['supportAtSchool'],
            'support_at_home' => $validated['supportAtHome'],
            'student_voice' => $validated['studentVoice'] ?: null,
            'status' => 'set',
        ]);

        $this->reset(['goalDomain', 'goalStatement', 'supportAtSchool', 'supportAtHome', 'studentVoice']);
        $this->plan->refresh();
        $this->flash = 'Goal added.';
    }

    public function shareWithParent(): void
    {
        abort_unless($this->canManage(), 403);
        abort_if($this->plan === null, 400);

        if ($this->plan->goals()->count() === 0) {
            $this->flash = 'Add at least one goal before sharing.';

            return;
        }

        $this->plan->update([
            'status' => 'active',
            'summary_for_parent' => $this->summaryForParent ?: null,
            'shared_with_parent_at' => now(),
        ]);

        $this->plan->refresh();
        $this->flash = 'Shared with the guardian.';
    }

    public function acknowledge(): void
    {
        abort_if($this->plan === null, 400);
        abort_unless(Auth::user()->can('acknowledge', $this->plan), 403);

        $this->plan->update(['parent_acknowledged_at' => now()]);
        $this->plan->refresh();
        $this->flash = 'Thank you — the teacher can see you have read this.';
    }

    public function updateGoalStatus(int $goalId, string $status): void
    {
        abort_unless($this->canManage(), 403);

        $goal = GrowthGoal::where('growth_plan_id', $this->plan?->id)->findOrFail($goalId);
        abort_unless(array_key_exists($status, GrowthGoal::STATUSES), 422);

        $goal->update(['status' => $status, 'reviewed_at' => now()]);
        $this->plan->refresh();
        $this->flash = 'Goal updated.';
    }

    public function with(): array
    {
        return [
            'goals' => $this->plan?->goals()->get() ?? collect(),
            'domains' => CapabilityObservation::DOMAINS,
            'canManage' => $this->canManage(),
            'isGuardian' => app(DevelopmentAccessService::class)
                ->isVerifiedGuardian(Auth::user(), $this->student->id),
            'goalStatuses' => GrowthGoal::STATUSES,
        ];
    }
}; ?>

<div>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">
            Growth plan — {{ $student->name }}
        </h2>
    </x-slot>

    <div class="py-8 max-w-3xl mx-auto sm:px-6 lg:px-8 space-y-6">

        @if ($flash)
            <div role="status" aria-live="polite" class="bg-green-50 border border-green-200 text-green-800 rounded-lg p-4 text-sm">{{ $flash }}</div>
        @endif

        <div class="bg-white rounded-lg shadow p-6">
            <p class="text-sm text-gray-500">{{ $school->name }} &middot; {{ $academicTerm }}</p>
            @if ($plan)
                <p class="text-xs text-gray-400 mt-1">
                    {{ $plan->isSharedWithParent() ? 'Shared with guardian on '.$plan->shared_with_parent_at->format('j M Y') : 'Draft — not yet shared' }}
                    @if ($plan->parent_acknowledged_at)
                        &middot; acknowledged {{ $plan->parent_acknowledged_at->format('j M Y') }}
                    @endif
                </p>
            @endif
        </div>

        @if ($plan === null)
            @if ($canManage)
                <form wire:submit="createPlan" class="bg-white rounded-lg shadow p-6 space-y-4">
                    <h3 class="font-semibold text-gray-900">Start this term's plan</h3>
                    <div>
                        <label for="academicTerm" class="block text-sm font-medium text-gray-700 mb-1">Term</label>
                        <input type="text" wire:model="academicTerm" id="academicTerm" class="w-full rounded border-gray-300 text-sm">
                        @error('academicTerm') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
                    </div>
                    <div>
                        <label for="summaryForParent" class="block text-sm font-medium text-gray-700 mb-1">
                            A short note for the guardian <span class="text-gray-400 font-normal">(plain language, optional)</span>
                        </label>
                        <textarea wire:model="summaryForParent" id="summaryForParent" rows="3" class="w-full rounded border-gray-300 text-sm"></textarea>
                        @error('summaryForParent') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
                    </div>
                    <button type="submit" class="px-4 py-2 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700">Start plan</button>
                </form>
            @else
                <div class="bg-white rounded-lg shadow p-6">
                    <p class="text-sm text-gray-400">No plan has been set for this term yet.</p>
                </div>
            @endif
        @else
            <div class="bg-white rounded-lg shadow p-6">
                <h3 class="font-semibold text-gray-900 mb-4">
                    Goals this term
                    <span class="text-xs font-normal text-gray-400">({{ $goals->count() }} of {{ \App\Models\GrowthPlan::MAX_GOALS }})</span>
                </h3>

                @forelse ($goals as $goal)
                    <div class="border border-gray-200 rounded-lg p-4 mb-3">
                        <div class="flex items-start justify-between gap-3 mb-2">
                            <div>
                                <p class="text-sm font-medium text-gray-900">{{ $goal->goal_statement }}</p>
                                <p class="text-xs text-gray-400 mt-0.5">{{ $domains[$goal->domain] ?? $goal->domain }}</p>
                            </div>
                            <span class="shrink-0 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">{{ $goal->statusLabel() }}</span>
                        </div>
                        <div class="grid sm:grid-cols-2 gap-3 text-sm mt-3">
                            <div class="bg-gray-50 rounded p-3">
                                <div class="text-xs font-semibold text-gray-500 mb-1">At school</div>
                                <p class="text-gray-700">{{ $goal->support_at_school }}</p>
                            </div>
                            <div class="bg-gray-50 rounded p-3">
                                <div class="text-xs font-semibold text-gray-500 mb-1">At home</div>
                                <p class="text-gray-700">{{ $goal->support_at_home }}</p>
                            </div>
                        </div>
                        @if ($canManage)
                            <div class="flex flex-wrap gap-2 mt-3">
                                @foreach ($goalStatuses as $key => $label)
                                    @if ($key !== $goal->status)
                                        <button wire:click="updateGoalStatus({{ $goal->id }}, '{{ $key }}')"
                                            class="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50">
                                            Mark: {{ $label }}
                                        </button>
                                    @endif
                                @endforeach
                            </div>
                        @endif
                    </div>
                @empty
                    <p class="text-sm text-gray-400">No goals yet.</p>
                @endforelse
            </div>

            @if ($canManage && $plan->hasGoalCapacity())
                <form wire:submit="addGoal" class="bg-white rounded-lg shadow p-6 space-y-4">
                    <h3 class="font-semibold text-gray-900">Add a goal</h3>

                    <div>
                        <label for="goalDomain" class="block text-sm font-medium text-gray-700 mb-1">Area</label>
                        <select wire:model="goalDomain" id="goalDomain" class="w-full rounded border-gray-300 text-sm">
                            <option value="">Choose an area…</option>
                            @foreach ($domains as $key => $label)
                                <option value="{{ $key }}">{{ $label }}</option>
                            @endforeach
                        </select>
                        @error('goalDomain') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
                    </div>

                    <div>
                        <label for="goalStatement" class="block text-sm font-medium text-gray-700 mb-1">The goal</label>
                        <textarea wire:model="goalStatement" id="goalStatement" rows="2" class="w-full rounded border-gray-300 text-sm"></textarea>
                        @error('goalStatement') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
                    </div>

                    <div>
                        <label for="supportAtSchool" class="block text-sm font-medium text-gray-700 mb-1">What we'll do at school</label>
                        <textarea wire:model="supportAtSchool" id="supportAtSchool" rows="2" class="w-full rounded border-gray-300 text-sm"></textarea>
                        @error('supportAtSchool') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
                    </div>

                    <div>
                        <label for="supportAtHome" class="block text-sm font-medium text-gray-700 mb-1">What could help at home</label>
                        <textarea wire:model="supportAtHome" id="supportAtHome" rows="2" class="w-full rounded border-gray-300 text-sm"></textarea>
                        @error('supportAtHome') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
                    </div>

                    <div>
                        <label for="studentVoice" class="block text-sm font-medium text-gray-700 mb-1">
                            In the student's own words <span class="text-gray-400 font-normal">(optional — for older students setting their own goals)</span>
                        </label>
                        <textarea wire:model="studentVoice" id="studentVoice" rows="2" class="w-full rounded border-gray-300 text-sm"></textarea>
                        @error('studentVoice') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
                    </div>

                    <button type="submit" class="px-4 py-2 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700">Add goal</button>
                </form>
            @endif

            @if ($canManage && ! $plan->isSharedWithParent())
                <div class="bg-white rounded-lg shadow p-6">
                    <h3 class="font-semibold text-gray-900 mb-2">Share with the guardian</h3>
                    <p class="text-xs text-gray-500 mb-3">Until you share it, this plan is only visible to school staff.</p>
                    <textarea wire:model="summaryForParent" rows="3" placeholder="A short note for the guardian…"
                        class="w-full rounded border-gray-300 text-sm mb-3"></textarea>
                    <button wire:click="shareWithParent" class="px-4 py-2 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700">
                        Share plan
                    </button>
                </div>
            @endif

            @if ($isGuardian && $plan->isSharedWithParent() && ! $plan->parent_acknowledged_at)
                <div class="bg-white rounded-lg shadow p-6">
                    <h3 class="font-semibold text-gray-900 mb-2">Your response</h3>
                    <p class="text-sm text-gray-600 mb-3">
                        You can also add your own observations from home — things the school may not have seen yet.
                    </p>
                    <div class="flex flex-wrap gap-3">
                        <button wire:click="acknowledge" class="px-4 py-2 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700">
                            I've read this
                        </button>
                        <a href="{{ route('growth.observe', $student->id) }}" wire:navigate
                            class="px-4 py-2 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50">
                            Add an observation from home
                        </a>
                    </div>
                </div>
            @endif
        @endif

        <a href="{{ route('growth.show', $student->id) }}" wire:navigate class="inline-block text-sm text-gray-600 hover:underline">
            &larr; Back to growth record
        </a>
    </div>
</div>
