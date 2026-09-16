<?php

use App\Models\FacilityClaim;
use App\Models\FacilityRating;
use App\Models\ParentSchoolRelationship;
use App\Models\School;
use App\Models\StudentSchoolRelationship;
use Illuminate\Support\Facades\Auth;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

/**
 * Spec sections 11 and 12 — the experience side.
 *
 * Only verified parents and students of this school may rate it, and what they
 * submit is stored against an anonymous reference rather than their user id
 * (section 26), so the school sees the report and never the reporter.
 *
 * The first question is availability, not quality, because "is it actually
 * there?" is the one that feeds claimed-vs-experienced — and a family can
 * answer it honestly even when they have no basis to score quality.
 */
new #[Layout('layouts.app')] class extends Component
{
    public School $school;

    public string $academicYear = '';

    public string $facilityKey = '';

    public string $availabilityReport = '';

    public array $scores = [
        'quality' => '',
        'equipment' => '',
        'usage_frequency' => '',
        'staff_support' => '',
        'overall_usefulness' => '',
    ];

    public string $comment = '';

    public string $flash = '';

    public function mount(School $school): void
    {
        $this->school = $school;

        abort_if($this->raterRole() === null, 403, 'Only verified parents and students of this school can rate its facilities.');

        $this->academicYear = $this->currentAcademicYear();
        $this->facilityKey = (string) request()->query('facility', '');
    }

    private function currentAcademicYear(): string
    {
        $now = now();
        $startYear = $now->month >= 4 ? $now->year : $now->year - 1;

        return $startYear.'-'.substr((string) ($startYear + 1), 2);
    }

    private function raterRole(): ?string
    {
        $user = Auth::user();

        if ($user === null) {
            return null;
        }

        if ($user->hasRole('parent') && ParentSchoolRelationship::where('user_id', $user->id)
            ->where('school_id', $this->school->id)->where('status', 'verified')->exists()) {
            return 'parent';
        }

        if ($user->hasRole('student') && StudentSchoolRelationship::where('user_id', $user->id)
            ->where('school_id', $this->school->id)->where('status', 'verified')->exists()) {
            return 'student';
        }

        return null;
    }

    public function submit(): void
    {
        $role = $this->raterRole();

        abort_if($role === null, 403);

        $validated = $this->validate([
            'facilityKey' => ['required', 'string'],
            'availabilityReport' => ['required', 'in:'.implode(',', array_keys(FacilityRating::AVAILABILITY_REPORTS))],
            'scores.*' => ['nullable', 'integer', 'min:1', 'max:5'],
            'comment' => ['nullable', 'string', 'max:2000'],
            'academicYear' => ['required', 'string', 'regex:/^\d{4}-\d{2}$/'],
        ], [], ['facilityKey' => 'facility', 'availabilityReport' => 'availability']);

        // Only facilities the school actually lists can be rated — otherwise
        // the claimed-vs-experienced comparison has nothing to compare against.
        abort_unless(
            FacilityClaim::where('school_id', $this->school->id)
                ->where('facility_key', $validated['facilityKey'])
                ->where('academic_year', $validated['academicYear'])
                ->exists(),
            422,
            'That facility is not listed by this school for this year.'
        );

        // Context is the rater's role, matching how complaints and school
        // feedback already allocate pseudonyms — one stable per-school
        // pseudonym per person, rather than a fresh one per feature.
        $anonymousRef = Auth::user()->anonymousRefFor($this->school, $role);

        // One rating per person per facility per year: re-submitting updates
        // your own, it does not stack.
        FacilityRating::updateOrCreate(
            [
                'school_id' => $this->school->id,
                'facility_key' => $validated['facilityKey'],
                'academic_year' => $validated['academicYear'],
                'anonymous_ref' => $anonymousRef,
            ],
            [
                'rater_role' => $role,
                'availability_report' => $validated['availabilityReport'],
                'quality' => $this->scores['quality'] !== '' ? (int) $this->scores['quality'] : null,
                'equipment' => $this->scores['equipment'] !== '' ? (int) $this->scores['equipment'] : null,
                'usage_frequency' => $this->scores['usage_frequency'] !== '' ? (int) $this->scores['usage_frequency'] : null,
                'staff_support' => $this->scores['staff_support'] !== '' ? (int) $this->scores['staff_support'] : null,
                'overall_usefulness' => $this->scores['overall_usefulness'] !== '' ? (int) $this->scores['overall_usefulness'] : null,
                'comment' => $validated['comment'] ?: null,
                'submitted_at' => now(),
            ]
        );

        $this->reset(['facilityKey', 'availabilityReport', 'comment']);
        $this->scores = array_fill_keys(array_keys($this->scores), '');
        $this->flash = 'Thank you — your report was recorded anonymously. The school sees what you said, never who said it.';
    }

    public function with(): array
    {
        return [
            'claims' => FacilityClaim::where('school_id', $this->school->id)
                ->where('academic_year', $this->academicYear)
                ->where('is_offered', true)
                ->get(),
            'availabilityReports' => FacilityRating::AVAILABILITY_REPORTS,
            'dimensions' => FacilityRating::DIMENSIONS,
        ];
    }
}; ?>

<div>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">Rate a facility — {{ $school->name }}</h2>
    </x-slot>

    <div class="py-8 max-w-2xl mx-auto sm:px-6 lg:px-8 space-y-6">

        @if ($flash)
            <div role="status" aria-live="polite" class="bg-green-50 border border-green-200 text-green-800 rounded-lg p-4 text-sm">{{ $flash }}</div>
        @endif

        <div class="bg-indigo-50 border border-indigo-100 rounded-lg p-4">
            <p class="text-sm text-indigo-900">
                Your name is never attached to this. The school sees the report and the totals, never who sent them.
            </p>
        </div>

        @if ($claims->isEmpty())
            <div class="bg-white rounded-lg shadow p-6">
                <p class="text-sm text-gray-500">
                    This school hasn't listed any facilities for {{ $academicYear }} yet, so there's nothing to
                    rate. Ratings are tied to what a school says it offers.
                </p>
            </div>
        @else
            <form wire:submit="submit" class="bg-white rounded-lg shadow p-6 space-y-5">

                <div>
                    <label for="facilityKey" class="block text-sm font-medium text-gray-700 mb-1">Which facility?</label>
                    <select wire:model="facilityKey" id="facilityKey" class="w-full rounded border-gray-300 text-sm">
                        <option value="">Choose…</option>
                        @foreach ($claims as $claim)
                            <option value="{{ $claim->facility_key }}">{{ $claim->label() }}</option>
                        @endforeach
                    </select>
                    @error('facilityKey') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
                </div>

                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2">
                        Is it actually available to your child?
                    </label>
                    <div class="space-y-2">
                        @foreach ($availabilityReports as $key => $label)
                            <label class="flex items-center gap-2 text-sm">
                                <input type="radio" wire:model="availabilityReport" value="{{ $key }}" class="text-indigo-600">
                                {{ $label }}
                            </label>
                        @endforeach
                    </div>
                    @error('availabilityReport') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
                </div>

                <div>
                    <div class="text-sm font-medium text-gray-700 mb-1">How would you rate it?</div>
                    <p class="text-xs text-gray-400 mb-3">Leave anything blank if you don't have a basis to judge it.</p>

                    <div class="space-y-3">
                        @foreach ($dimensions as $key => $label)
                            <x-rating-scale :name="'facility_'.$key" :label="$label" :model="'scores.'.$key" />
                        @endforeach
                    </div>
                </div>

                <div>
                    <label for="comment" class="block text-sm font-medium text-gray-700 mb-1">
                        Anything else? <span class="text-gray-400 font-normal">(optional)</span>
                    </label>
                    <textarea wire:model="comment" id="comment" rows="3" maxlength="2000" class="w-full rounded border-gray-300 text-sm"></textarea>
                </div>

                <div class="flex items-center gap-3">
                    <button type="submit" class="px-4 py-2 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700">Submit report</button>
                    <a href="{{ route('schools.show', $school) }}" wire:navigate class="text-sm text-gray-600 hover:underline">Back to school</a>
                </div>
            </form>
        @endif
    </div>
</div>
