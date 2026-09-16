<?php

use App\Models\Course;
use App\Models\CourseRating;
use App\Models\School;
use Illuminate\Support\Facades\Auth;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

/**
 * Spec sections 8 and 12 — the school's course catalogue, and what families
 * said about each one.
 *
 * The school sees per-dimension averages with their response counts, not one
 * blended score: "practical learning 2.1 from 18 responses" is actionable,
 * "3.4 overall" is not.
 */
new #[Layout('layouts.app')] class extends Component
{
    public School $school;

    public string $academicYear = '';

    public string $name = '';

    public string $courseType = 'core_subject';

    public string $applicableClasses = '';

    public string $stream = '';

    public string $description = '';

    public string $flash = '';

    public function mount(School $school): void
    {
        $this->school = $school;

        abort_unless($this->canManage(), 403, 'You can only manage courses for your own school.');

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

    public function addCourse(): void
    {
        abort_unless($this->canManage(), 403);

        $validated = $this->validate([
            'academicYear' => ['required', 'string', 'regex:/^\d{4}-\d{2}$/'],
            'name' => ['required', 'string', 'max:150'],
            'courseType' => ['required', 'in:'.implode(',', array_keys(Course::TYPES))],
            'applicableClasses' => ['nullable', 'string', 'max:100'],
            'stream' => ['nullable', 'string', 'max:60'],
            'description' => ['nullable', 'string', 'max:1000'],
        ], [], ['academicYear' => 'academic year', 'name' => 'course name']);

        $exists = Course::where('school_id', $this->school->id)
            ->where('academic_year', $validated['academicYear'])
            ->where('name', $validated['name'])
            ->exists();

        if ($exists) {
            $this->flash = 'That course is already listed for '.$validated['academicYear'].'.';

            return;
        }

        Course::create([
            'school_id' => $this->school->id,
            'academic_year' => $validated['academicYear'],
            'name' => $validated['name'],
            'course_type' => $validated['courseType'],
            'applicable_classes' => $validated['applicableClasses'] ?: null,
            'stream' => $validated['stream'] ?: null,
            'description' => $validated['description'] ?: null,
            'recorded_by_user_id' => Auth::id(),
        ]);

        $this->reset(['name', 'applicableClasses', 'stream', 'description']);
        $this->flash = 'Course added.';
    }

    public function removeCourse(int $courseId): void
    {
        abort_unless($this->canManage(), 403);

        Course::where('school_id', $this->school->id)->findOrFail($courseId)->delete();

        $this->flash = 'Course removed from this year\'s listing.';
    }

    public function with(): array
    {
        $courses = Course::where('school_id', $this->school->id)
            ->where('academic_year', $this->academicYear)
            ->orderBy('name')
            ->get();

        $ratings = CourseRating::where('school_id', $this->school->id)
            ->where('academic_year', $this->academicYear)
            ->get()
            ->groupBy('course_id');

        return [
            'courses' => $courses,
            'averagesByCourse' => $courses->mapWithKeys(fn (Course $course): array => [
                $course->id => CourseRating::averages($ratings->get($course->id, collect())),
            ]),
            'responseCounts' => $courses->mapWithKeys(fn (Course $course): array => [
                $course->id => $ratings->get($course->id, collect())->count(),
            ]),
            'types' => Course::TYPES,
        ];
    }
}; ?>

<div>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">Courses — {{ $school->name }}</h2>
    </x-slot>

    <div class="py-8 max-w-5xl mx-auto sm:px-6 lg:px-8 space-y-6">

        @if ($flash)
            <div role="status" aria-live="polite" class="bg-green-50 border border-green-200 text-green-800 rounded-lg p-4 text-sm">{{ $flash }}</div>
        @endif

        <div class="bg-white rounded-lg shadow p-6">
            <label for="academicYear" class="block text-sm font-medium text-gray-700 mb-1">Academic year</label>
            <input type="text" wire:model.live="academicYear" id="academicYear" class="rounded border-gray-300 text-sm w-32">
            @error('academicYear') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
        </div>

        <div class="bg-white rounded-lg shadow p-6">
            <h3 class="font-semibold text-gray-900 mb-1">Courses for {{ $academicYear }} ({{ $courses->count() }})</h3>
            <p class="text-xs text-gray-500 mb-4">
                Each dimension shows its own response count. A low score from three people is a different
                thing from a low score from thirty.
            </p>

            @forelse ($courses as $course)
                <div class="py-4 border-b last:border-0">
                    <div class="flex flex-wrap items-start justify-between gap-3">
                        <div class="flex-1 min-w-64">
                            <div class="flex flex-wrap items-center gap-2">
                                <span class="text-sm font-medium text-gray-900">{{ $course->name }}</span>
                                <span class="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{{ $course->typeLabel() }}</span>
                            </div>
                            <div class="text-xs text-gray-400 mt-1">
                                @if ($course->applicable_classes) Classes {{ $course->applicable_classes }} @endif
                                @if ($course->stream) &middot; {{ $course->stream }} @endif
                                &middot; {{ $responseCounts[$course->id] }}
                                {{ Str::plural('response', $responseCounts[$course->id]) }}
                            </div>
                        </div>
                        <button wire:click="removeCourse({{ $course->id }})" class="text-xs text-red-600 hover:underline">Remove</button>
                    </div>

                    @if ($responseCounts[$course->id] > 0)
                        <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-3">
                            @foreach ($averagesByCourse[$course->id] as $dimension)
                                @if ($dimension['responses'] > 0)
                                    <div class="bg-gray-50 rounded p-2">
                                        <div class="text-xs text-gray-600">{{ $dimension['label'] }}</div>
                                        <div class="text-sm font-semibold text-gray-900">
                                            {{ $dimension['average'] }}<span class="text-xs font-normal text-gray-400">/5</span>
                                            <span class="text-xs font-normal text-gray-400">
                                                &middot; {{ $dimension['responses'] }}
                                            </span>
                                        </div>
                                    </div>
                                @endif
                            @endforeach
                        </div>
                    @else
                        <p class="text-xs text-gray-400 mt-2">No ratings yet.</p>
                    @endif
                </div>
            @empty
                <p class="text-sm text-gray-400">No courses listed for this year yet.</p>
            @endforelse
        </div>

        <form wire:submit="addCourse" class="bg-white rounded-lg shadow p-6 space-y-4">
            <h3 class="font-semibold text-gray-900">Add a course</h3>

            <div class="grid sm:grid-cols-2 gap-4">
                <div>
                    <label for="name" class="block text-sm font-medium text-gray-700 mb-1">Course name</label>
                    <input type="text" wire:model="name" id="name" maxlength="150"
                        placeholder="e.g. Physics" class="w-full rounded border-gray-300 text-sm">
                    @error('name') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
                </div>
                <div>
                    <label for="courseType" class="block text-sm font-medium text-gray-700 mb-1">Type</label>
                    <select wire:model="courseType" id="courseType" class="w-full rounded border-gray-300 text-sm">
                        @foreach ($types as $key => $label)
                            <option value="{{ $key }}">{{ $label }}</option>
                        @endforeach
                    </select>
                </div>
                <div>
                    <label for="applicableClasses" class="block text-sm font-medium text-gray-700 mb-1">Classes</label>
                    <input type="text" wire:model="applicableClasses" id="applicableClasses" maxlength="100" class="w-full rounded border-gray-300 text-sm">
                </div>
                <div>
                    <label for="stream" class="block text-sm font-medium text-gray-700 mb-1">
                        Stream <span class="text-gray-400 font-normal">(optional)</span>
                    </label>
                    <input type="text" wire:model="stream" id="stream" maxlength="60" class="w-full rounded border-gray-300 text-sm">
                </div>
            </div>

            <div>
                <label for="description" class="block text-sm font-medium text-gray-700 mb-1">
                    Description <span class="text-gray-400 font-normal">(optional)</span>
                </label>
                <textarea wire:model="description" id="description" rows="2" maxlength="1000" class="w-full rounded border-gray-300 text-sm"></textarea>
            </div>

            <button type="submit" class="px-4 py-2 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700">Add course</button>
        </form>
    </div>
</div>
