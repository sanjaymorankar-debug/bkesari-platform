<?php

use App\Models\CoachingProgramme;
use App\Models\ExternalExam;
use App\Models\School;
use Illuminate\Support\Facades\Auth;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

/**
 * Spec section 10 — external exams and coaching, kept on one screen because a
 * school thinks of them together and because an exam's preparation fee and a
 * coaching programme's fee are frequently the same money described twice.
 */
new #[Layout('layouts.app')] class extends Component
{
    public School $school;

    public string $academicYear = '';

    // Exam form
    public string $examName = '';

    public string $conductingBody = '';

    public string $examType = 'olympiad';

    public string $examClasses = '';

    public string $examFee = '';

    public string $preparationFee = '';

    public bool $preparationOffered = false;

    public bool $examThroughSchool = true;

    public bool $examMandatory = false;

    // Coaching form
    public string $programmeName = '';

    public string $programmeType = 'other';

    public string $providerType = 'school';

    public string $providerName = '';

    public string $coachingClasses = '';

    public string $timing = '';

    public string $coachingFee = '';

    public bool $duringSchoolHours = false;

    public bool $bundledIntoFees = false;

    public bool $coachingMandatory = false;

    public string $flash = '';

    public function mount(School $school): void
    {
        $this->school = $school;

        abort_unless($this->canManage(), 403, 'You can only manage this for your own school.');

        $this->academicYear = $this->currentAcademicYear();
    }

    private function canManage(): bool
    {
        $user = Auth::user();

        return $user->hasAnyRole(['school_admin', 'system_admin'])
            && ($user->hasRole('system_admin')
                || $user->schoolStaffAssignments()->where('school_id', $this->school->id)->exists());
    }

    private function currentAcademicYear(): string
    {
        $now = now();
        $startYear = $now->month >= 4 ? $now->year : $now->year - 1;

        return $startYear.'-'.substr((string) ($startYear + 1), 2);
    }

    public function addExam(): void
    {
        abort_unless($this->canManage(), 403);

        $validated = $this->validate([
            'academicYear' => ['required', 'string', 'regex:/^\d{4}-\d{2}$/'],
            'examName' => ['required', 'string', 'max:150'],
            'conductingBody' => ['nullable', 'string', 'max:150'],
            'examType' => ['required', 'in:'.implode(',', array_keys(ExternalExam::TYPES))],
            'examClasses' => ['nullable', 'string', 'max:100'],
            'examFee' => ['nullable', 'numeric', 'min:0', 'max:9999999'],
            'preparationFee' => ['nullable', 'numeric', 'min:0', 'max:9999999'],
        ], [], ['examName' => 'exam name', 'academicYear' => 'academic year']);

        ExternalExam::create([
            'school_id' => $this->school->id,
            'academic_year' => $validated['academicYear'],
            'exam_name' => $validated['examName'],
            'conducting_body' => $validated['conductingBody'] ?: null,
            'exam_type' => $validated['examType'],
            'applicable_classes' => $validated['examClasses'] ?: null,
            'through_school' => $this->examThroughSchool,
            'exam_fee' => $validated['examFee'] !== '' ? $validated['examFee'] : null,
            'preparation_offered' => $this->preparationOffered,
            'preparation_fee' => $validated['preparationFee'] !== '' ? $validated['preparationFee'] : null,
            'is_mandatory' => $this->examMandatory,
            'recorded_by_user_id' => Auth::id(),
        ]);

        $this->reset(['examName', 'conductingBody', 'examClasses', 'examFee', 'preparationFee', 'examMandatory', 'preparationOffered']);
        $this->flash = 'Exam added.';
    }

    public function addCoaching(): void
    {
        abort_unless($this->canManage(), 403);

        $validated = $this->validate([
            'academicYear' => ['required', 'string', 'regex:/^\d{4}-\d{2}$/'],
            'programmeName' => ['required', 'string', 'max:150'],
            'programmeType' => ['required', 'in:'.implode(',', array_keys(CoachingProgramme::TYPES))],
            'providerType' => ['required', 'in:'.implode(',', array_keys(CoachingProgramme::PROVIDERS))],
            'providerName' => ['nullable', 'string', 'max:150'],
            'coachingClasses' => ['nullable', 'string', 'max:100'],
            'timing' => ['nullable', 'string', 'max:100'],
            'coachingFee' => ['nullable', 'numeric', 'min:0', 'max:9999999'],
        ], [], ['programmeName' => 'programme name', 'academicYear' => 'academic year']);

        CoachingProgramme::create([
            'school_id' => $this->school->id,
            'academic_year' => $validated['academicYear'],
            'programme_name' => $validated['programmeName'],
            'programme_type' => $validated['programmeType'],
            'provider_type' => $validated['providerType'],
            'provider_name' => $validated['providerName'] ?: null,
            'applicable_classes' => $validated['coachingClasses'] ?: null,
            'timing' => $validated['timing'] ?: null,
            'during_school_hours' => $this->duringSchoolHours,
            'fee' => $validated['coachingFee'] !== '' ? $validated['coachingFee'] : null,
            'bundled_into_school_fees' => $this->bundledIntoFees,
            'is_mandatory' => $this->coachingMandatory,
            'recorded_by_user_id' => Auth::id(),
        ]);

        $this->reset(['programmeName', 'providerName', 'coachingClasses', 'timing', 'coachingFee', 'coachingMandatory', 'duringSchoolHours', 'bundledIntoFees']);
        $this->flash = 'Coaching programme added.';
    }

    public function deleteExam(int $id): void
    {
        abort_unless($this->canManage(), 403);
        ExternalExam::where('school_id', $this->school->id)->findOrFail($id)->delete();
        $this->flash = 'Exam removed.';
    }

    public function deleteCoaching(int $id): void
    {
        abort_unless($this->canManage(), 403);
        CoachingProgramme::where('school_id', $this->school->id)->findOrFail($id)->delete();
        $this->flash = 'Coaching programme removed.';
    }

    public function with(): array
    {
        $coaching = CoachingProgramme::where('school_id', $this->school->id)
            ->where('academic_year', $this->academicYear)->orderBy('programme_name')->get();

        return [
            'exams' => ExternalExam::where('school_id', $this->school->id)
                ->where('academic_year', $this->academicYear)->orderBy('exam_name')->get(),
            'coaching' => $coaching,
            'unbundled' => $coaching->filter(fn (CoachingProgramme $c): bool => $c->isUnbundledMandatoryCost()),
            'examTypes' => ExternalExam::TYPES,
            'coachingTypes' => CoachingProgramme::TYPES,
            'providers' => CoachingProgramme::PROVIDERS,
        ];
    }
}; ?>

<div>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">Exams &amp; coaching — {{ $school->name }}</h2>
    </x-slot>

    <div class="py-8 max-w-5xl mx-auto sm:px-6 lg:px-8 space-y-6">

        @if ($flash)
            <div role="status" aria-live="polite" class="bg-green-50 border border-green-200 text-green-800 rounded-lg p-4 text-sm">{{ $flash }}</div>
        @endif

        @if ($unbundled->isNotEmpty())
            <div class="bg-amber-50 border border-amber-200 rounded-lg p-6">
                <h3 class="font-semibold text-amber-900 mb-2">Compulsory costs outside your published fees</h3>
                <p class="text-sm text-amber-900 mb-3">
                    These are marked compulsory but not bundled into school fees, so a parent reading your fee
                    page won't see them. That may be exactly right for how you bill — the point is that your
                    estimated annual cost will be shown as incomplete unless it's accounted for.
                </p>
                <ul class="text-sm text-amber-900 space-y-1">
                    @foreach ($unbundled as $programme)
                        <li><strong>{{ $programme->programme_name }}</strong> — ₹{{ number_format((float) $programme->fee) }}</li>
                    @endforeach
                </ul>
            </div>
        @endif

        <div class="bg-white rounded-lg shadow p-6">
            <label for="academicYear" class="block text-sm font-medium text-gray-700 mb-1">Academic year</label>
            <input type="text" wire:model.live="academicYear" id="academicYear" class="rounded border-gray-300 text-sm w-32">
            @error('academicYear') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
        </div>

        {{-- External exams --}}
        <div class="bg-white rounded-lg shadow p-6">
            <h3 class="font-semibold text-gray-900 mb-4">External exams ({{ $exams->count() }})</h3>
            @forelse ($exams as $exam)
                <div class="flex flex-wrap items-start justify-between gap-3 py-3 border-b last:border-0">
                    <div class="flex-1 min-w-64">
                        <div class="flex flex-wrap items-center gap-2">
                            <span class="text-sm font-medium text-gray-900">{{ $exam->exam_name }}</span>
                            <span class="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{{ $exam->typeLabel() }}</span>
                            @if ($exam->is_mandatory)
                                <span class="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-900">Compulsory</span>
                            @endif
                        </div>
                        <div class="text-xs text-gray-400 mt-1">
                            {{ $exam->conducting_body ?: 'Conducting body not recorded' }}
                            @if ($exam->applicable_classes) &middot; classes {{ $exam->applicable_classes }} @endif
                            &middot; {{ $exam->through_school ? 'registered through the school' : 'families register directly' }}
                        </div>
                    </div>
                    <div class="text-right">
                        <div class="text-sm text-gray-900">
                            @if ($exam->totalCost() > 0) ₹{{ number_format($exam->totalCost()) }} @else No fee recorded @endif
                        </div>
                        <button wire:click="deleteExam({{ $exam->id }})" class="text-xs text-red-600 hover:underline">Remove</button>
                    </div>
                </div>
            @empty
                <p class="text-sm text-gray-400">No exams recorded for this year.</p>
            @endforelse
        </div>

        <form wire:submit="addExam" class="bg-white rounded-lg shadow p-6 space-y-4">
            <h3 class="font-semibold text-gray-900">Add an external exam</h3>
            <div class="grid sm:grid-cols-2 gap-4">
                <div>
                    <label for="examName" class="block text-sm font-medium text-gray-700 mb-1">Exam name</label>
                    <input type="text" wire:model="examName" id="examName" maxlength="150" class="w-full rounded border-gray-300 text-sm">
                    @error('examName') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
                </div>
                <div>
                    <label for="examType" class="block text-sm font-medium text-gray-700 mb-1">Type</label>
                    <select wire:model="examType" id="examType" class="w-full rounded border-gray-300 text-sm">
                        @foreach ($examTypes as $key => $label)
                            <option value="{{ $key }}">{{ $label }}</option>
                        @endforeach
                    </select>
                </div>
                <div>
                    <label for="conductingBody" class="block text-sm font-medium text-gray-700 mb-1">Conducting organisation</label>
                    <input type="text" wire:model="conductingBody" id="conductingBody" maxlength="150" class="w-full rounded border-gray-300 text-sm">
                </div>
                <div>
                    <label for="examClasses" class="block text-sm font-medium text-gray-700 mb-1">Classes</label>
                    <input type="text" wire:model="examClasses" id="examClasses" maxlength="100" class="w-full rounded border-gray-300 text-sm">
                </div>
                <div>
                    <label for="examFee" class="block text-sm font-medium text-gray-700 mb-1">Exam fee (₹)</label>
                    <input type="number" step="0.01" wire:model="examFee" id="examFee" class="w-full rounded border-gray-300 text-sm">
                    @error('examFee') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
                </div>
                <div>
                    <label for="preparationFee" class="block text-sm font-medium text-gray-700 mb-1">Preparation fee (₹)</label>
                    <input type="number" step="0.01" wire:model="preparationFee" id="preparationFee" class="w-full rounded border-gray-300 text-sm">
                </div>
            </div>
            <div class="flex flex-wrap gap-4 text-sm">
                <label class="flex items-center gap-2"><input type="checkbox" wire:model="examThroughSchool" class="rounded text-indigo-600"> Registered through the school</label>
                <label class="flex items-center gap-2"><input type="checkbox" wire:model="preparationOffered" class="rounded text-indigo-600"> Preparation offered</label>
                <label class="flex items-center gap-2"><input type="checkbox" wire:model="examMandatory" class="rounded text-indigo-600"> Compulsory for students</label>
            </div>
            <button type="submit" class="px-4 py-2 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700">Add exam</button>
        </form>

        {{-- Coaching --}}
        <div class="bg-white rounded-lg shadow p-6">
            <h3 class="font-semibold text-gray-900 mb-4">Coaching &amp; preparation ({{ $coaching->count() }})</h3>
            @forelse ($coaching as $programme)
                <div class="flex flex-wrap items-start justify-between gap-3 py-3 border-b last:border-0">
                    <div class="flex-1 min-w-64">
                        <div class="flex flex-wrap items-center gap-2">
                            <span class="text-sm font-medium text-gray-900">{{ $programme->programme_name }}</span>
                            <span class="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{{ $programme->typeLabel() }}</span>
                            @if ($programme->isEffectivelyCompulsory())
                                <span class="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-900">
                                    {{ $programme->is_mandatory ? 'Compulsory' : 'In school hours' }}
                                </span>
                            @endif
                            @if ($programme->bundled_into_school_fees)
                                <span class="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-800">In school fees</span>
                            @endif
                        </div>
                        <div class="text-xs text-gray-400 mt-1">
                            {{ $providers[$programme->provider_type] }}
                            @if ($programme->provider_name) &middot; {{ $programme->provider_name }} @endif
                            @if ($programme->timing) &middot; {{ $programme->timing }} @endif
                        </div>
                    </div>
                    <div class="text-right">
                        <div class="text-sm text-gray-900">
                            @if ($programme->fee) ₹{{ number_format((float) $programme->fee) }} @else No fee recorded @endif
                        </div>
                        <button wire:click="deleteCoaching({{ $programme->id }})" class="text-xs text-red-600 hover:underline">Remove</button>
                    </div>
                </div>
            @empty
                <p class="text-sm text-gray-400">No coaching programmes recorded for this year.</p>
            @endforelse
        </div>

        <form wire:submit="addCoaching" class="bg-white rounded-lg shadow p-6 space-y-4">
            <h3 class="font-semibold text-gray-900">Add a coaching programme</h3>
            <div class="grid sm:grid-cols-2 gap-4">
                <div>
                    <label for="programmeName" class="block text-sm font-medium text-gray-700 mb-1">Programme name</label>
                    <input type="text" wire:model="programmeName" id="programmeName" maxlength="150" class="w-full rounded border-gray-300 text-sm">
                    @error('programmeName') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
                </div>
                <div>
                    <label for="programmeType" class="block text-sm font-medium text-gray-700 mb-1">Type</label>
                    <select wire:model="programmeType" id="programmeType" class="w-full rounded border-gray-300 text-sm">
                        @foreach ($coachingTypes as $key => $label)
                            <option value="{{ $key }}">{{ $label }}</option>
                        @endforeach
                    </select>
                </div>
                <div>
                    <label for="providerType" class="block text-sm font-medium text-gray-700 mb-1">Who runs it?</label>
                    <select wire:model="providerType" id="providerType" class="w-full rounded border-gray-300 text-sm">
                        @foreach ($providers as $key => $label)
                            <option value="{{ $key }}">{{ $label }}</option>
                        @endforeach
                    </select>
                </div>
                <div>
                    <label for="providerName" class="block text-sm font-medium text-gray-700 mb-1">Provider name</label>
                    <input type="text" wire:model="providerName" id="providerName" maxlength="150" class="w-full rounded border-gray-300 text-sm">
                </div>
                <div>
                    <label for="coachingClasses" class="block text-sm font-medium text-gray-700 mb-1">Classes</label>
                    <input type="text" wire:model="coachingClasses" id="coachingClasses" maxlength="100" class="w-full rounded border-gray-300 text-sm">
                </div>
                <div>
                    <label for="timing" class="block text-sm font-medium text-gray-700 mb-1">Timing</label>
                    <input type="text" wire:model="timing" id="timing" maxlength="100" placeholder="e.g. 4-6pm, Mon-Fri" class="w-full rounded border-gray-300 text-sm">
                </div>
                <div>
                    <label for="coachingFee" class="block text-sm font-medium text-gray-700 mb-1">Fee (₹)</label>
                    <input type="number" step="0.01" wire:model="coachingFee" id="coachingFee" class="w-full rounded border-gray-300 text-sm">
                    @error('coachingFee') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
                </div>
            </div>
            <div class="flex flex-wrap gap-4 text-sm">
                <label class="flex items-center gap-2"><input type="checkbox" wire:model="duringSchoolHours" class="rounded text-indigo-600"> Held during school hours</label>
                <label class="flex items-center gap-2"><input type="checkbox" wire:model="bundledIntoFees" class="rounded text-indigo-600"> Included in school fees</label>
                <label class="flex items-center gap-2"><input type="checkbox" wire:model="coachingMandatory" class="rounded text-indigo-600"> Compulsory for students</label>
            </div>
            <button type="submit" class="px-4 py-2 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700">Add programme</button>
        </form>
    </div>
</div>
