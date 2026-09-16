<?php

use App\Models\Course;
use App\Models\CourseRating;
use App\Models\ParentSchoolRelationship;
use App\Models\School;
use App\Models\StudentSchoolRelationship;
use Illuminate\Support\Facades\Auth;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

/**
 * Spec section 12 — rating a course.
 *
 * Students see all ten dimensions; parents see the subset they are actually in
 * a position to judge (see CourseRating::PARENT_DIMENSIONS). Asking a parent
 * to score project work they never saw would manufacture data, and a rating
 * built from guesses is worse than a shorter honest one.
 *
 * Anonymous by construction, using the same per-school pseudonym as complaints
 * and facility ratings.
 */
new #[Layout('layouts.app')] class extends Component
{
    public School $school;

    public string $academicYear = '';

    public string $courseId = '';

    public array $scores = [];

    public string $comment = '';

    public string $flash = '';

    public function mount(School $school): void
    {
        $this->school = $school;

        abort_if($this->raterRole() === null, 403, 'Only verified parents and students of this school can rate its courses.');

        $this->academicYear = $this->currentAcademicYear();
        $this->scores = array_fill_keys(array_keys(CourseRating::DIMENSIONS), '');
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

    /** @return list<string> */
    private function askableDimensions(): array
    {
        return $this->raterRole() === 'parent'
            ? CourseRating::PARENT_DIMENSIONS
            : array_keys(CourseRating::DIMENSIONS);
    }

    public function submit(): void
    {
        $role = $this->raterRole();

        abort_if($role === null, 403);

        $validated = $this->validate([
            'courseId' => ['required', 'integer'],
            'scores.*' => ['nullable', 'integer', 'min:1', 'max:5'],
            'comment' => ['nullable', 'string', 'max:2000'],
        ], [], ['courseId' => 'course']);

        $course = Course::where('school_id', $this->school->id)
            ->where('academic_year', $this->academicYear)
            ->find($validated['courseId']);

        abort_if($course === null, 422, 'That course is not listed by this school for this year.');

        $askable = $this->askableDimensions();

        $values = [];

        foreach (array_keys(CourseRating::DIMENSIONS) as $dimension) {
            // A dimension this rater was never shown stays null rather than
            // being written as a zero or a guess.
            $values[$dimension] = in_array($dimension, $askable, true) && $this->scores[$dimension] !== ''
                ? (int) $this->scores[$dimension]
                : null;
        }

        CourseRating::updateOrCreate(
            [
                'course_id' => $course->id,
                'academic_year' => $this->academicYear,
                'anonymous_ref' => Auth::user()->anonymousRefFor($this->school, $role),
            ],
            array_merge($values, [
                'school_id' => $this->school->id,
                'rater_role' => $role,
                'comment' => $validated['comment'] ?: null,
                'submitted_at' => now(),
            ])
        );

        $this->scores = array_fill_keys(array_keys(CourseRating::DIMENSIONS), '');
        $this->reset(['courseId', 'comment']);
        $this->flash = 'Thank you — recorded anonymously. The school sees what you said, never who said it.';
    }

    public function with(): array
    {
        $askable = $this->askableDimensions();

        return [
            'courses' => Course::where('school_id', $this->school->id)
                ->where('academic_year', $this->academicYear)
                ->orderBy('name')
                ->get(),
            'dimensions' => array_intersect_key(CourseRating::DIMENSIONS, array_flip($askable)),
            'isParent' => $this->raterRole() === 'parent',
        ];
    }
}; ?>

<div>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">Rate a course — {{ $school->name }}</h2>
    </x-slot>

    <div class="py-8 max-w-2xl mx-auto sm:px-6 lg:px-8 space-y-6">

        @if ($flash)
            <div role="status" aria-live="polite" class="bg-green-50 border border-green-200 text-green-800 rounded-lg p-4 text-sm">{{ $flash }}</div>
        @endif

        <div class="bg-indigo-50 border border-indigo-100 rounded-lg p-4 text-sm text-indigo-900">
            Your name is never attached to this.
            @if ($isParent)
                You're asked only about things you're likely to have seen — leave anything blank you can't judge.
            @else
                Leave anything blank you can't judge.
            @endif
        </div>

        @if ($courses->isEmpty())
            <div class="bg-white rounded-lg shadow p-6">
                <p class="text-sm text-gray-500">
                    This school hasn't listed any courses for {{ $academicYear }} yet, so there's nothing to rate.
                </p>
            </div>
        @else
            <form wire:submit="submit" class="bg-white rounded-lg shadow p-6 space-y-5">
                <div>
                    <label for="courseId" class="block text-sm font-medium text-gray-700 mb-1">Which course?</label>
                    <select wire:model="courseId" id="courseId" class="w-full rounded border-gray-300 text-sm">
                        <option value="">Choose…</option>
                        @foreach ($courses as $course)
                            <option value="{{ $course->id }}">{{ $course->name }}</option>
                        @endforeach
                    </select>
                    @error('courseId') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
                </div>

                <div class="space-y-3">
                    @foreach ($dimensions as $key => $label)
                        <x-rating-scale :name="'course_'.$key" :label="$label" :model="'scores.'.$key" />
                    @endforeach
                </div>

                <div>
                    <label for="comment" class="block text-sm font-medium text-gray-700 mb-1">
                        Anything else? <span class="text-gray-400 font-normal">(optional)</span>
                    </label>
                    <textarea wire:model="comment" id="comment" rows="3" maxlength="2000" class="w-full rounded border-gray-300 text-sm"></textarea>
                </div>

                <div class="flex items-center gap-3">
                    <button type="submit" class="px-4 py-2 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700">Submit</button>
                    <a href="{{ route('schools.show', $school) }}" wire:navigate class="text-sm text-gray-600 hover:underline">Back to school</a>
                </div>
            </form>
        @endif
    </div>
</div>
