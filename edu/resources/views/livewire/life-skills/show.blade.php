<?php

use App\Models\LifeSkillRecord;
use App\Models\StudentSchoolRelationship;
use App\Models\User;
use App\Services\ConsentService;
use App\Services\DevelopmentAccessService;
use Illuminate\Support\Facades\Auth;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

/**
 * Spec section 17 — life-skills participation.
 *
 * Recorded by school staff (typically the Career & Life-Skills Mentor) as
 * "took part / actively engaged / led", never as a mark. The page shows
 * coverage across the eight skill areas so a school can see which ones a child
 * has had no exposure to at all — that gap is the actionable signal here, not
 * any comparison between children.
 */
new #[Layout('layouts.app')] class extends Component
{
    public User $student;

    public string $schoolId = '';

    public string $skillArea = '';

    public string $activityTitle = '';

    public string $activityDescription = '';

    public string $participationLevel = 'participated';

    public string $academicTerm = '';

    public string $flash = '';

    public function mount(User $student): void
    {
        $this->student = $student;

        abort_unless(
            app(DevelopmentAccessService::class)->canView(Auth::user(), $student->id, 'life_skills'),
            403,
            'You do not have access to this record, or consent is not on record for it.'
        );

        $this->academicTerm = $this->currentTerm();
        $this->schoolId = (string) ($this->recordableSchools()->first()->school_id ?? '');
    }

    private function currentTerm(): string
    {
        $now = now();
        $startYear = $now->month >= 4 ? $now->year : $now->year - 1;

        return $startYear.'-'.substr((string) ($startYear + 1), 2).' Term '.($now->month >= 4 && $now->month <= 9 ? '1' : '2');
    }

    /** Schools where the viewer is staff and the child is enrolled. */
    private function recordableSchools()
    {
        $access = app(DevelopmentAccessService::class);

        return StudentSchoolRelationship::query()
            ->where('user_id', $this->student->id)
            ->where('status', 'verified')
            ->with('school:id,name')
            ->get()
            ->filter(fn ($rel): bool => $access->canManageGrowthPlan(Auth::user(), $this->student->id, $rel->school_id))
            ->values();
    }

    public function save(): void
    {
        $validated = $this->validate([
            'schoolId' => ['required', 'exists:schools,id'],
            'skillArea' => ['required', 'in:'.implode(',', array_keys(LifeSkillRecord::SKILL_AREAS))],
            'activityTitle' => ['required', 'string', 'max:200'],
            'activityDescription' => ['nullable', 'string', 'max:2000'],
            'participationLevel' => ['required', 'in:'.implode(',', array_keys(LifeSkillRecord::PARTICIPATION_LEVELS))],
            'academicTerm' => ['required', 'string', 'max:40'],
        ]);

        app(ConsentService::class)->requireConsent($this->student->id, 'life_skills');

        abort_unless(
            app(DevelopmentAccessService::class)
                ->canManageGrowthPlan(Auth::user(), $this->student->id, (int) $validated['schoolId']),
            403,
            'You cannot record life-skills activity for this student.'
        );

        LifeSkillRecord::create([
            'student_user_id' => $this->student->id,
            'school_id' => $validated['schoolId'],
            'recorded_by_user_id' => Auth::id(),
            'skill_area' => $validated['skillArea'],
            'activity_title' => $validated['activityTitle'],
            'activity_description' => $validated['activityDescription'] ?: null,
            'participation_level' => $validated['participationLevel'],
            'academic_term' => $validated['academicTerm'],
            'recorded_on' => now()->toDateString(),
        ]);

        $this->reset(['activityTitle', 'activityDescription']);
        $this->flash = 'Activity recorded.';
    }

    public function with(): array
    {
        $records = LifeSkillRecord::where('student_user_id', $this->student->id)
            ->orderByDesc('recorded_on')
            ->get();

        return [
            'records' => $records,
            'byArea' => $records->groupBy('skill_area'),
            'skillAreas' => LifeSkillRecord::SKILL_AREAS,
            'participationLevels' => LifeSkillRecord::PARTICIPATION_LEVELS,
            'recordableSchools' => $this->recordableSchools(),
        ];
    }
}; ?>

<div>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">
            {{ Auth::id() === $student->id ? 'My life skills' : $student->name . ' — life skills' }}
        </h2>
    </x-slot>

    <div class="py-8 max-w-3xl mx-auto sm:px-6 lg:px-8 space-y-6">

        @if ($flash)
            <div role="status" aria-live="polite" class="bg-green-50 border border-green-200 text-green-800 rounded-lg p-4 text-sm">{{ $flash }}</div>
        @endif

        <div class="bg-white rounded-lg shadow p-6">
            <h3 class="font-semibold text-gray-900 mb-1">Areas covered so far</h3>
            <p class="text-xs text-gray-500 mb-4">
                This records taking part, not performance. There is no score here and none is calculated.
            </p>
            <div class="grid sm:grid-cols-2 gap-2">
                @foreach ($skillAreas as $key => $label)
                    @php $count = ($byArea[$key] ?? collect())->count(); @endphp
                    <div class="flex items-center justify-between p-3 rounded border {{ $count > 0 ? 'border-green-200 bg-green-50' : 'border-gray-200' }}">
                        <span class="text-sm {{ $count > 0 ? 'text-green-900' : 'text-gray-500' }}">{{ $label }}</span>
                        <span class="text-xs {{ $count > 0 ? 'text-green-700' : 'text-gray-400' }}">
                            {{ $count > 0 ? $count . ' ' . \Illuminate\Support\Str::plural('activity', $count) : 'none yet' }}
                        </span>
                    </div>
                @endforeach
            </div>
        </div>

        <div class="bg-white rounded-lg shadow p-6">
            <h3 class="font-semibold text-gray-900 mb-4">Activities</h3>
            @forelse ($records as $record)
                <div class="py-3 border-b last:border-0">
                    <div class="flex items-start justify-between gap-3">
                        <div>
                            <p class="text-sm font-medium text-gray-900">{{ $record->activity_title }}</p>
                            <p class="text-xs text-gray-400 mt-0.5">
                                {{ $record->skillAreaLabel() }} &middot; {{ $record->recorded_on->format('j M Y') }}
                            </p>
                            @if ($record->activity_description)
                                <p class="text-sm text-gray-600 mt-1">{{ $record->activity_description }}</p>
                            @endif
                        </div>
                        <span class="shrink-0 text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800">
                            {{ $record->participationLabel() }}
                        </span>
                    </div>
                </div>
            @empty
                <p class="text-sm text-gray-400">No activities recorded yet.</p>
            @endforelse
        </div>

        @if ($recordableSchools->isNotEmpty())
            <form wire:submit="save" class="bg-white rounded-lg shadow p-6 space-y-4">
                <h3 class="font-semibold text-gray-900">Record an activity</h3>

                @if ($recordableSchools->count() > 1)
                    <div>
                        <label for="schoolId" class="block text-sm font-medium text-gray-700 mb-1">School</label>
                        <select wire:model="schoolId" id="schoolId" class="w-full rounded border-gray-300 text-sm">
                            @foreach ($recordableSchools as $rel)
                                <option value="{{ $rel->school_id }}">{{ $rel->school->name }}</option>
                            @endforeach
                        </select>
                    </div>
                @endif

                <div>
                    <label for="skillArea" class="block text-sm font-medium text-gray-700 mb-1">Skill area</label>
                    <select wire:model="skillArea" id="skillArea" class="w-full rounded border-gray-300 text-sm">
                        <option value="">Choose an area…</option>
                        @foreach ($skillAreas as $key => $label)
                            <option value="{{ $key }}">{{ $label }}</option>
                        @endforeach
                    </select>
                    @error('skillArea') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
                </div>

                <div>
                    <label for="activityTitle" class="block text-sm font-medium text-gray-700 mb-1">Activity</label>
                    <input type="text" wire:model="activityTitle" id="activityTitle" maxlength="200"
                        placeholder="e.g. Class budgeting workshop" class="w-full rounded border-gray-300 text-sm">
                    @error('activityTitle') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
                </div>

                <div>
                    <label for="activityDescription" class="block text-sm font-medium text-gray-700 mb-1">
                        Description <span class="text-gray-400 font-normal">(optional)</span>
                    </label>
                    <textarea wire:model="activityDescription" id="activityDescription" rows="2" maxlength="2000"
                        class="w-full rounded border-gray-300 text-sm"></textarea>
                </div>

                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2">How did they take part?</label>
                    <div class="flex flex-wrap gap-3">
                        @foreach ($participationLevels as $key => $label)
                            <label class="flex items-center gap-2 text-sm">
                                <input type="radio" wire:model="participationLevel" value="{{ $key }}" class="text-indigo-600">
                                {{ $label }}
                            </label>
                        @endforeach
                    </div>
                </div>

                <div>
                    <label for="academicTerm" class="block text-sm font-medium text-gray-700 mb-1">Term</label>
                    <input type="text" wire:model="academicTerm" id="academicTerm" maxlength="40" class="w-full rounded border-gray-300 text-sm">
                    @error('academicTerm') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
                </div>

                <button type="submit" class="px-4 py-2 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700">Save activity</button>
            </form>
        @endif

        <a href="{{ route('growth.show', $student->id) }}" wire:navigate class="inline-block text-sm text-gray-600 hover:underline">
            &larr; Back to growth record
        </a>
    </div>
</div>
