<?php

use App\Models\CapabilityObservation;
use App\Models\StudentSchoolRelationship;
use App\Models\User;
use App\Services\ConsentService;
use App\Services\DevelopmentAccessService;
use Illuminate\Support\Facades\Auth;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

/**
 * Recording one observation (spec section 15).
 *
 * The form asks for a moment and its context, not a verdict. `strand` plus
 * `evidence_context` exist to keep it that way — an observer who has to name
 * the activity they saw it in writes "worked through a hard problem set
 * without giving up" rather than "is persistent". The domain list is NEP
 * 2020's, so what gets recorded maps onto the Holistic Progress Card rather
 * than a shape invented here.
 */
new #[Layout('layouts.app')] class extends Component
{
    public User $student;

    public string $schoolId = '';

    public string $domain = '';

    public string $strand = '';

    public string $observationType = 'strength';

    public string $observation = '';

    public string $evidenceContext = '';

    public string $academicTerm = '';

    public string $saved = '';

    public function mount(User $student): void
    {
        $this->student = $student;

        $this->academicTerm = $this->currentTerm();

        $schools = $this->availableSchools();

        abort_if($schools->isEmpty(), 403, 'You cannot record observations for this student.');

        $this->schoolId = (string) $schools->first()->school_id;
    }

    /**
     * Schools where this observation could legitimately be recorded — the
     * intersection of where the child is enrolled and what the observer is
     * entitled to. Guardians may record at any school their child attends.
     */
    private function availableSchools()
    {
        $access = app(DevelopmentAccessService::class);

        return StudentSchoolRelationship::query()
            ->where('user_id', $this->student->id)
            ->where('status', 'verified')
            ->with('school:id,name')
            ->get()
            ->filter(fn ($rel): bool => $access->canRecordObservation(Auth::user(), $this->student->id, $rel->school_id))
            ->values();
    }

    private function currentTerm(): string
    {
        // Indian academic year runs April-March; term boundaries vary by
        // state, so this is a sensible default the observer can overwrite.
        $now = now();
        $startYear = $now->month >= 4 ? $now->year : $now->year - 1;

        return $startYear.'-'.substr((string) ($startYear + 1), 2).' Term '.($now->month >= 4 && $now->month <= 9 ? '1' : '2');
    }

    private function observerRole(): string
    {
        $user = Auth::user();

        if ($user->id === $this->student->id) {
            return 'self';
        }

        if (app(DevelopmentAccessService::class)->isVerifiedGuardian($user, $this->student->id)) {
            return 'parent';
        }

        return 'teacher';
    }

    public function save(): void
    {
        $validated = $this->validate([
            'schoolId' => ['required', 'exists:schools,id'],
            'domain' => ['required', 'in:'.implode(',', array_keys(CapabilityObservation::DOMAINS))],
            'strand' => ['required', 'string', 'max:120'],
            'observationType' => ['required', 'in:strength,growth_area'],
            'observation' => ['required', 'string', 'min:10', 'max:2000'],
            'evidenceContext' => ['nullable', 'string', 'max:1000'],
            'academicTerm' => ['required', 'string', 'max:40'],
        ]);

        // Consent and access are re-checked at write time, not just at mount —
        // a guardian could have withdrawn consent while this form was open.
        app(ConsentService::class)->requireConsent($this->student->id, 'capability_growth');

        abort_unless(
            app(DevelopmentAccessService::class)
                ->canRecordObservation(Auth::user(), $this->student->id, (int) $validated['schoolId']),
            403,
            'You cannot record observations for this student at this school.'
        );

        $role = $this->observerRole();

        CapabilityObservation::create([
            'student_user_id' => $this->student->id,
            'school_id' => $validated['schoolId'],
            'observer_user_id' => Auth::id(),
            'observer_role' => $role,
            'domain' => $validated['domain'],
            'strand' => $validated['strand'],
            'observation_type' => $validated['observationType'],
            'observation' => $validated['observation'],
            'evidence_context' => $validated['evidenceContext'] ?: null,
            'academic_term' => $validated['academicTerm'],
            'observed_on' => now()->toDateString(),
            // Peers are the only observer type held for moderation.
            'moderation_status' => $role === 'peer' ? 'pending' : 'approved',
        ]);

        $this->reset(['strand', 'observation', 'evidenceContext']);
        $this->saved = 'Observation recorded.';
    }

    public function with(): array
    {
        return [
            'schools' => $this->availableSchools(),
            'domains' => CapabilityObservation::DOMAINS,
            'role' => $this->observerRole(),
        ];
    }
}; ?>

<div>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">Record an observation</h2>
    </x-slot>

    <div class="py-8 max-w-2xl mx-auto sm:px-6 lg:px-8 space-y-6">

        @if ($saved)
            <div role="status" aria-live="polite" class="bg-green-50 border border-green-200 text-green-800 rounded-lg p-4 text-sm">{{ $saved }}</div>
        @endif

        <div class="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <p class="text-sm text-amber-900">
                Describe <strong>something you saw</strong>, and when. Write "worked steadily through a hard
                problem set" rather than "is hardworking" — this record is about moments, not about deciding
                what kind of child {{ $student->name }} is.
            </p>
        </div>

        <form wire:submit="save" class="bg-white rounded-lg shadow p-6 space-y-5">

            <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Student</label>
                <p class="text-sm text-gray-900">{{ $student->name }}
                    <span class="text-xs text-gray-400">&middot; recorded as {{ $role }}</span>
                </p>
            </div>

            @if ($schools->count() > 1)
                <div>
                    <label for="schoolId" class="block text-sm font-medium text-gray-700 mb-1">School</label>
                    <select wire:model="schoolId" id="schoolId" class="w-full rounded border-gray-300 text-sm">
                        @foreach ($schools as $rel)
                            <option value="{{ $rel->school_id }}">{{ $rel->school->name }}</option>
                        @endforeach
                    </select>
                    @error('schoolId') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
                </div>
            @endif

            <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Is this a strength, or an area to grow?</label>
                <div class="flex gap-3">
                    <label class="flex items-center gap-2 text-sm">
                        <input type="radio" wire:model="observationType" value="strength" class="text-indigo-600">
                        Doing well
                    </label>
                    <label class="flex items-center gap-2 text-sm">
                        <input type="radio" wire:model="observationType" value="growth_area" class="text-indigo-600">
                        Could use support
                    </label>
                </div>
            </div>

            <div>
                <label for="domain" class="block text-sm font-medium text-gray-700 mb-1">Area of development</label>
                <select wire:model="domain" id="domain" class="w-full rounded border-gray-300 text-sm">
                    <option value="">Choose an area…</option>
                    @foreach ($domains as $key => $label)
                        <option value="{{ $key }}">{{ $label }}</option>
                    @endforeach
                </select>
                @error('domain') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
            </div>

            <div>
                <label for="strand" class="block text-sm font-medium text-gray-700 mb-1">More specifically</label>
                <input type="text" wire:model="strand" id="strand" maxlength="120"
                    placeholder="e.g. problem solving, working in a group, reading aloud"
                    class="w-full rounded border-gray-300 text-sm">
                @error('strand') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
            </div>

            <div>
                <label for="observation" class="block text-sm font-medium text-gray-700 mb-1">What did you see?</label>
                <textarea wire:model="observation" id="observation" rows="3" maxlength="2000"
                    class="w-full rounded border-gray-300 text-sm"></textarea>
                @error('observation') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
            </div>

            <div>
                <label for="evidenceContext" class="block text-sm font-medium text-gray-700 mb-1">
                    Where did it happen? <span class="text-gray-400 font-normal">(optional)</span>
                </label>
                <input type="text" wire:model="evidenceContext" id="evidenceContext" maxlength="1000"
                    placeholder="e.g. during the group science project"
                    class="w-full rounded border-gray-300 text-sm">
                @error('evidenceContext') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
            </div>

            <div>
                <label for="academicTerm" class="block text-sm font-medium text-gray-700 mb-1">Term</label>
                <input type="text" wire:model="academicTerm" id="academicTerm" maxlength="40"
                    class="w-full rounded border-gray-300 text-sm">
                @error('academicTerm') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
            </div>

            <div class="flex items-center gap-3">
                <button type="submit" class="px-4 py-2 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700">
                    Save observation
                </button>
                <a href="{{ route('growth.show', $student->id) }}" wire:navigate
                    class="text-sm text-gray-600 hover:underline">Back to growth record</a>
            </div>
        </form>
    </div>
</div>
