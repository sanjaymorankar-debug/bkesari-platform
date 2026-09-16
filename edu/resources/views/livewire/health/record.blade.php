<?php

use App\Models\HealthFollowup;
use App\Models\PhysicalHealthRecord;
use App\Models\SchoolStaff;
use App\Models\StudentSchoolRelationship;
use App\Models\User;
use App\Services\HealthAccessService;
use Illuminate\Support\Facades\Auth;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

/**
 * Spec section 18 — recording a screening. Nurse/medical officer only.
 *
 * Where a concern is noted, the form opens a follow-up in the same action
 * (section 21's lifecycle) rather than leaving it to be remembered later: a
 * screening that finds something and loses track of it is worse than no
 * screening, because it looks like care was taken.
 */
new #[Layout('layouts.app')] class extends Component
{
    public User $student;

    public int $schoolId = 0;

    public string $academicYear = '';

    public string $examinationDate = '';

    public string $examinationType = 'annual_screening';

    public string $heightCm = '';

    public string $weightKg = '';

    public string $visionLeft = '';

    public string $visionRight = '';

    public string $hearing = '';

    public string $dental = '';

    public string $generalExamination = '';

    public string $healthConcerns = '';

    public string $recommendations = '';

    public string $nextDueDate = '';

    // Follow-up, opened alongside the record when something needs chasing.
    public bool $openFollowup = false;

    public string $followupArea = 'general';

    public string $followupFinding = '';

    public string $followupAction = '';

    public string $followupDue = '';

    public string $flash = '';

    public function mount(User $student): void
    {
        $this->student = $student;

        $schoolId = StudentSchoolRelationship::where('user_id', $student->id)
            ->where('status', 'verified')
            ->whereIn('school_id', SchoolStaff::where('user_id', Auth::id())->pluck('school_id'))
            ->value('school_id');

        abort_if($schoolId === null, 403, 'This student is not enrolled at a school you work at.');

        abort_unless(
            app(HealthAccessService::class)->canRecordPhysicalHealth(Auth::user(), $student->id, $schoolId),
            403,
            'Only a nurse or medical officer at this student\'s school can record a screening, and only with '
                .'the guardian\'s consent in force.'
        );

        $this->schoolId = $schoolId;
        $this->academicYear = $this->currentAcademicYear();
        $this->examinationDate = now()->toDateString();
    }

    private function currentAcademicYear(): string
    {
        $now = now();
        $startYear = $now->month >= 4 ? $now->year : $now->year - 1;

        return $startYear.'-'.substr((string) ($startYear + 1), 2);
    }

    public function save(): void
    {
        $service = app(HealthAccessService::class);

        abort_unless(
            $service->canRecordPhysicalHealth(Auth::user(), $this->student->id, $this->schoolId),
            403
        );

        $validated = $this->validate([
            'academicYear' => ['required', 'string', 'regex:/^\d{4}-\d{2}$/'],
            'examinationDate' => ['required', 'date', 'before_or_equal:today'],
            'examinationType' => ['required', 'in:'.implode(',', array_keys(PhysicalHealthRecord::EXAMINATION_TYPES))],
            'heightCm' => ['nullable', 'numeric', 'min:30', 'max:250'],
            'weightKg' => ['nullable', 'numeric', 'min:5', 'max:250'],
            'visionLeft' => ['nullable', 'string', 'max:20'],
            'visionRight' => ['nullable', 'string', 'max:20'],
            'hearing' => ['nullable', 'in:normal,concern_noted,not_tested'],
            'dental' => ['nullable', 'in:normal,concern_noted,not_tested'],
            'generalExamination' => ['nullable', 'string', 'max:2000'],
            'healthConcerns' => ['nullable', 'string', 'max:2000'],
            'recommendations' => ['nullable', 'string', 'max:2000'],
            'nextDueDate' => ['nullable', 'date', 'after:today'],
            'followupFinding' => ['required_if:openFollowup,true', 'nullable', 'string', 'max:1000'],
            'followupDue' => ['nullable', 'date'],
        ], [
            'followupFinding.required_if' => 'Say what the follow-up is for.',
            'examinationDate.before_or_equal' => 'A screening cannot be dated in the future.',
        ], [
            'academicYear' => 'academic year',
            'examinationDate' => 'examination date',
        ]);

        $record = PhysicalHealthRecord::create([
            'student_user_id' => $this->student->id,
            'school_id' => $this->schoolId,
            'academic_year' => $validated['academicYear'],
            'examination_date' => $validated['examinationDate'],
            'examination_type' => $validated['examinationType'],
            'height_cm' => $validated['heightCm'] !== '' ? $validated['heightCm'] : null,
            'weight_kg' => $validated['weightKg'] !== '' ? $validated['weightKg'] : null,
            'vision_left' => $validated['visionLeft'] ?: null,
            'vision_right' => $validated['visionRight'] ?: null,
            'hearing' => $validated['hearing'] ?: null,
            'dental' => $validated['dental'] ?: null,
            'general_examination' => $validated['generalExamination'] ?: null,
            'health_concerns' => $validated['healthConcerns'] ?: null,
            'recommendations' => $validated['recommendations'] ?: null,
            'next_due_date' => $validated['nextDueDate'] ?: null,
            'recorded_by_user_id' => Auth::id(),
            'recorded_by_designation' => SchoolStaff::where('user_id', Auth::id())
                ->where('school_id', $this->schoolId)->value('designation'),
        ]);

        // BMI is stored as calculated so the historical series stays stable
        // even if the formula is ever revisited.
        if ($record->calculatedBmi() !== null) {
            $record->update(['bmi' => $record->calculatedBmi()]);
        }

        $service->log(Auth::user(), $this->student->id, 'physical_health', 'created', $record->id);

        if ($this->openFollowup) {
            $followup = HealthFollowup::create([
                'student_user_id' => $this->student->id,
                'school_id' => $this->schoolId,
                'physical_health_record_id' => $record->id,
                'area' => $this->followupArea,
                'finding' => $validated['followupFinding'],
                'recommended_action' => $this->followupAction ?: null,
                'identified_on' => $validated['examinationDate'],
                'due_on' => $validated['followupDue'] ?: null,
                'opened_by_user_id' => Auth::id(),
            ]);

            $service->log(Auth::user(), $this->student->id, 'followup', 'created', $followup->id);
        }

        $this->reset([
            'heightCm', 'weightKg', 'visionLeft', 'visionRight', 'hearing', 'dental',
            'generalExamination', 'healthConcerns', 'recommendations', 'nextDueDate',
            'openFollowup', 'followupFinding', 'followupAction', 'followupDue',
        ]);

        $this->flash = 'Screening recorded.'.($this->openFollowup ? ' A follow-up was opened.' : '');
    }

    public function with(): array
    {
        return [
            'examinationTypes' => PhysicalHealthRecord::EXAMINATION_TYPES,
            'areas' => HealthFollowup::AREAS,
        ];
    }
}; ?>

<div>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">Record a screening — {{ $student->name }}</h2>
    </x-slot>

    <div class="py-8 max-w-3xl mx-auto sm:px-6 lg:px-8 space-y-6">

        @if ($flash)
            <div role="status" aria-live="polite" class="bg-green-50 border border-green-200 text-green-800 rounded-lg p-4 text-sm">{{ $flash }}</div>
        @endif

        <form wire:submit="save" class="bg-white rounded-lg shadow p-6 space-y-5">
            <div class="grid sm:grid-cols-3 gap-4">
                <div>
                    <label for="examinationDate" class="block text-sm font-medium text-gray-700 mb-1">Date</label>
                    <input type="date" wire:model="examinationDate" id="examinationDate" class="w-full rounded border-gray-300 text-sm">
                    @error('examinationDate') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
                </div>
                <div>
                    <label for="examinationType" class="block text-sm font-medium text-gray-700 mb-1">Type</label>
                    <select wire:model="examinationType" id="examinationType" class="w-full rounded border-gray-300 text-sm">
                        @foreach ($examinationTypes as $key => $label)
                            <option value="{{ $key }}">{{ $label }}</option>
                        @endforeach
                    </select>
                </div>
                <div>
                    <label for="academicYear" class="block text-sm font-medium text-gray-700 mb-1">Academic year</label>
                    <input type="text" wire:model="academicYear" id="academicYear" class="w-full rounded border-gray-300 text-sm">
                    @error('academicYear') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
                </div>
            </div>

            <p class="text-xs text-gray-500">Leave anything blank that wasn't measured — a blank is more honest than a zero.</p>

            <div class="grid sm:grid-cols-4 gap-4">
                <div>
                    <label for="heightCm" class="block text-sm font-medium text-gray-700 mb-1">Height (cm)</label>
                    <input type="number" step="0.1" wire:model="heightCm" id="heightCm" class="w-full rounded border-gray-300 text-sm">
                    @error('heightCm') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
                </div>
                <div>
                    <label for="weightKg" class="block text-sm font-medium text-gray-700 mb-1">Weight (kg)</label>
                    <input type="number" step="0.1" wire:model="weightKg" id="weightKg" class="w-full rounded border-gray-300 text-sm">
                    @error('weightKg') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
                </div>
                <div>
                    <label for="visionLeft" class="block text-sm font-medium text-gray-700 mb-1">Vision (L)</label>
                    <input type="text" wire:model="visionLeft" id="visionLeft" maxlength="20" placeholder="6/6" class="w-full rounded border-gray-300 text-sm">
                </div>
                <div>
                    <label for="visionRight" class="block text-sm font-medium text-gray-700 mb-1">Vision (R)</label>
                    <input type="text" wire:model="visionRight" id="visionRight" maxlength="20" placeholder="6/6" class="w-full rounded border-gray-300 text-sm">
                </div>
                <div>
                    <label for="hearing" class="block text-sm font-medium text-gray-700 mb-1">Hearing</label>
                    <select wire:model="hearing" id="hearing" class="w-full rounded border-gray-300 text-sm">
                        <option value="">Not recorded</option>
                        <option value="normal">Normal</option>
                        <option value="concern_noted">Concern noted</option>
                        <option value="not_tested">Not tested</option>
                    </select>
                </div>
                <div>
                    <label for="dental" class="block text-sm font-medium text-gray-700 mb-1">Dental</label>
                    <select wire:model="dental" id="dental" class="w-full rounded border-gray-300 text-sm">
                        <option value="">Not recorded</option>
                        <option value="normal">Normal</option>
                        <option value="concern_noted">Concern noted</option>
                        <option value="not_tested">Not tested</option>
                    </select>
                </div>
                <div class="sm:col-span-2">
                    <label for="nextDueDate" class="block text-sm font-medium text-gray-700 mb-1">Next screening due</label>
                    <input type="date" wire:model="nextDueDate" id="nextDueDate" class="w-full rounded border-gray-300 text-sm">
                    @error('nextDueDate') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
                </div>
            </div>

            <div>
                <label for="healthConcerns" class="block text-sm font-medium text-gray-700 mb-1">Concerns noted</label>
                <textarea wire:model="healthConcerns" id="healthConcerns" rows="2" maxlength="2000" class="w-full rounded border-gray-300 text-sm"></textarea>
            </div>

            <div>
                <label for="recommendations" class="block text-sm font-medium text-gray-700 mb-1">Recommendations</label>
                <textarea wire:model="recommendations" id="recommendations" rows="2" maxlength="2000" class="w-full rounded border-gray-300 text-sm"></textarea>
            </div>

            <div class="border-t pt-4 space-y-3">
                <label class="flex items-center gap-2 text-sm font-medium text-gray-900">
                    <input type="checkbox" wire:model.live="openFollowup" class="rounded text-indigo-600">
                    Open a follow-up for this
                </label>
                <p class="text-xs text-gray-500">
                    Anything needing action later should have a follow-up, so it can be chased rather than
                    remembered.
                </p>

                @if ($openFollowup)
                    <div class="grid sm:grid-cols-2 gap-4">
                        <div>
                            <label for="followupArea" class="block text-sm text-gray-700 mb-1">Area</label>
                            <select wire:model="followupArea" id="followupArea" class="w-full rounded border-gray-300 text-sm">
                                @foreach ($areas as $key => $label)
                                    <option value="{{ $key }}">{{ $label }}</option>
                                @endforeach
                            </select>
                        </div>
                        <div>
                            <label for="followupDue" class="block text-sm text-gray-700 mb-1">Due by</label>
                            <input type="date" wire:model="followupDue" id="followupDue" class="w-full rounded border-gray-300 text-sm">
                        </div>
                        <div class="sm:col-span-2">
                            <label for="followupFinding" class="block text-sm text-gray-700 mb-1">What was found?</label>
                            <input type="text" wire:model="followupFinding" id="followupFinding" maxlength="1000" class="w-full rounded border-gray-300 text-sm">
                            @error('followupFinding') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
                        </div>
                        <div class="sm:col-span-2">
                            <label for="followupAction" class="block text-sm text-gray-700 mb-1">Recommended action</label>
                            <input type="text" wire:model="followupAction" id="followupAction" maxlength="1000" class="w-full rounded border-gray-300 text-sm">
                        </div>
                    </div>
                @endif
            </div>

            <div class="flex items-center gap-3">
                <button type="submit" class="px-4 py-2 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700">Save screening</button>
                <a href="{{ route('health.show', $student) }}" wire:navigate class="text-sm text-gray-600 hover:underline">Back to record</a>
            </div>
        </form>
    </div>
</div>
