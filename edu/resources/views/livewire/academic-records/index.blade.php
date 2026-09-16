<?php

use App\Models\School;
use App\Models\SchoolStaff;
use App\Models\StudentAcademicRecord;
use App\Models\StudentSchoolRelationship;
use Illuminate\Support\Facades\Auth;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;
use Livewire\WithPagination;

new #[Layout('layouts.app')] class extends Component
{
    use WithPagination;

    public School $school;

    public string $studentUserId = '';
    public string $subject = '';
    public string $term = '';
    public string $score = '';
    public string $maxScore = '100';

    /**
     * Feeds the Teacher Effectiveness Index's value-add component
     * (term-over-term average-score comparison, per subject/school).
     */
    public function mount(School $school): void
    {
        $isStaff = SchoolStaff::where('user_id', Auth::id())->where('school_id', $school->id)->exists();
        abort_unless($isStaff, 403);

        $this->school = $school;
    }

    public function addRecord(): void
    {
        $validated = $this->validate([
            'studentUserId' => ['required', 'integer'],
            'subject' => ['required', 'string', 'max:100'],
            'term' => ['required', 'string', 'max:50'],
            'score' => ['required', 'numeric', 'min:0'],
            'maxScore' => ['required', 'numeric', 'min:1'],
        ]);

        $belongs = StudentSchoolRelationship::where('user_id', $validated['studentUserId'])
            ->where('school_id', $this->school->id)->where('status', 'verified')->exists();
        abort_unless($belongs, 422);

        StudentAcademicRecord::create([
            'student_user_id' => $validated['studentUserId'],
            'school_id' => $this->school->id,
            'subject' => $validated['subject'],
            'term' => $validated['term'],
            'score' => $validated['score'],
            'max_score' => $validated['maxScore'],
            'recorded_by_user_id' => Auth::id(),
            'recorded_at' => now(),
        ]);

        $this->reset(['subject', 'term', 'score']);
        $this->maxScore = '100';
    }

    public function with(): array
    {
        $studentIds = StudentSchoolRelationship::where('school_id', $this->school->id)->where('status', 'verified')->pluck('user_id');

        return [
            'students' => \App\Models\User::whereIn('id', $studentIds)->orderBy('name')->get(),
            'records' => StudentAcademicRecord::where('school_id', $this->school->id)
                ->with('student')->latest('recorded_at')->paginate(20),
        ];
    }
}; ?>

<div>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">Academic Records — {{ $school->name }}</h2>
    </x-slot>

    <div class="py-8 max-w-5xl mx-auto sm:px-6 lg:px-8 space-y-6">
        <div class="bg-white rounded-lg shadow p-6">
            <h3 class="font-semibold text-gray-900 mb-3">Add Record</h3>
            <form wire:submit="addRecord" class="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
                <div class="md:col-span-2">
                    <x-input-label value="Student" />
                    <select wire:model="studentUserId" class="border-gray-300 rounded-md shadow-sm mt-1 w-full text-sm">
                        <option value="">Select student</option>
                        @foreach ($students as $student)
                            <option value="{{ $student->id }}">{{ $student->name }}</option>
                        @endforeach
                    </select>
                </div>
                <div>
                    <x-input-label value="Subject" />
                    <x-text-input wire:model="subject" class="mt-1 w-full text-sm" />
                </div>
                <div>
                    <x-input-label value="Term" />
                    <x-text-input wire:model="term" placeholder="e.g. 2026-T1" class="mt-1 w-full text-sm" />
                </div>
                <div>
                    <x-input-label value="Score / Max" />
                    <div class="flex gap-1">
                        <x-text-input wire:model="score" type="number" step="0.01" class="mt-1 w-full text-sm" />
                        <x-text-input wire:model="maxScore" type="number" step="0.01" class="mt-1 w-full text-sm" />
                    </div>
                </div>
                <div class="md:col-span-5">
                    <x-input-error :messages="$errors->get('studentUserId')" />
                    <x-input-error :messages="$errors->get('subject')" />
                    <x-input-error :messages="$errors->get('term')" />
                    <x-input-error :messages="$errors->get('score')" />
                    <x-input-error :messages="$errors->get('maxScore')" />
                    <x-primary-button class="mt-2">Add Record</x-primary-button>
                </div>
            </form>
        </div>

        <div class="bg-white rounded-lg shadow overflow-hidden">
            <table class="min-w-full divide-y divide-gray-200 text-sm">
                <thead class="bg-gray-50">
                    <tr>
                        <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Student</th>
                        <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Subject</th>
                        <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Term</th>
                        <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Score</th>
                        <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Recorded</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-100">
                    @forelse ($records as $record)
                        <tr>
                            <td class="px-4 py-2">{{ $record->student?->name }}</td>
                            <td class="px-4 py-2">{{ $record->subject }}</td>
                            <td class="px-4 py-2">{{ $record->term }}</td>
                            <td class="px-4 py-2">{{ $record->score }} / {{ $record->max_score }}</td>
                            <td class="px-4 py-2 text-gray-400">{{ $record->recorded_at?->format('M j, Y') }}</td>
                        </tr>
                    @empty
                        <tr><td colspan="5" class="px-4 py-6 text-center text-gray-400">No records yet.</td></tr>
                    @endforelse
                </tbody>
            </table>
            <div class="p-4">{{ $records->links() }}</div>
        </div>
    </div>
</div>
