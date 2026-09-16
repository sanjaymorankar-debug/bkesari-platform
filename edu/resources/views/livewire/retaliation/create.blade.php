<?php

use App\Models\Complaint;
use App\Models\ParentSchoolRelationship;
use App\Models\RetaliationReport;
use App\Models\School;
use App\Models\StudentSchoolRelationship;
use App\Services\AIAssistService;
use Illuminate\Support\Facades\Auth;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

new #[Layout('layouts.app')] class extends Component
{
    public string $schoolId = '';
    public string $complaintId = '';
    public string $category = '';
    public string $description = '';

    public ?int $possibleDuplicateId = null;
    public ?string $possibleDuplicateCategory = null;

    public function mount(): void
    {
        $this->schoolId = (string) request()->query('school', '');
        $this->complaintId = (string) request()->query('complaint', '');
    }

    /**
     * Advisory only (spec section AF) — a heads-up, never a block.
     */
    public function updatedDescription(): void
    {
        if (mb_strlen($this->description) < 20 || $this->schoolId === '') {
            $this->possibleDuplicateId = null;

            return;
        }

        $school = School::find($this->schoolId);
        $duplicate = $school ? app(AIAssistService::class)->findPossibleDuplicateRetaliationReport($school, $this->description) : null;
        $this->possibleDuplicateId = $duplicate?->id;
        $this->possibleDuplicateCategory = $duplicate ? str_replace('_', ' ', $duplicate->category) : null;
    }

    private function verifiedRole(School $school): ?string
    {
        $user = Auth::user();

        if ($user->hasRole('parent') && ParentSchoolRelationship::where('user_id', $user->id)
            ->where('school_id', $school->id)->where('status', 'verified')->exists()) {
            return 'parent';
        }

        if ($user->hasRole('student') && StudentSchoolRelationship::where('user_id', $user->id)
            ->where('school_id', $school->id)->where('status', 'verified')->exists()) {
            return 'student';
        }

        return null;
    }

    public function submit(): void
    {
        $validated = $this->validate([
            'schoolId' => ['required', 'exists:schools,id'],
            'complaintId' => ['nullable', 'exists:complaints,id'],
            'category' => ['required', 'in:intimidation,harassment,discrimination,punishment,academic_retaliation,threats,withdrawal_of_facilities,other'],
            'description' => ['required', 'string', 'min:20', 'max:5000'],
        ]);

        $school = School::with(['state', 'district'])->findOrFail($validated['schoolId']);
        $role = $this->verifiedRole($school);

        abort_unless($role !== null, 403, 'You must be a verified parent or student of this school to report retaliation.');

        $anonymousRef = Auth::user()->anonymousRefFor($school, $role);

        $report = RetaliationReport::create([
            'complaint_id' => $validated['complaintId'] ?: null,
            'school_id' => $school->id,
            'district_id' => $school->district_id,
            'state_id' => $school->state_id,
            'anonymous_ref' => $anonymousRef,
            'submitted_role' => $role,
            'category' => $validated['category'],
            'description' => $validated['description'],
            'status' => 'submitted',
        ]);

        $this->redirect(route('retaliation.show', $report), navigate: true);
    }

    public function with(): array
    {
        $user = Auth::user();
        $myRefs = \App\Models\AnonymousIdentity::where('user_id', $user->id)->pluck('anonymous_ref');

        return [
            'schools' => School::orderBy('name')->get(['id', 'name', 'city']),
            'myComplaints' => Complaint::whereIn('anonymous_ref', $myRefs)->latest()->get(['id', 'complaint_number', 'subject']),
        ];
    }
}; ?>

<div>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">Report Retaliation</h2>
    </x-slot>

    <div class="py-8 max-w-2xl mx-auto sm:px-6 lg:px-8">
        <div class="bg-white rounded-lg shadow p-6">
            <p class="text-sm text-gray-500 mb-6">
                If you believe you or your child faced retaliation for a complaint or feedback — punishment,
                threats, being treated differently — report it here. It's prioritised for review, and, like every
                report on this platform, submitted anonymously as
                <strong>Anonymous Verified {{ ucfirst(Auth::user()->hasRole('student') ? 'Student' : 'Parent') }}</strong>.
                We do not automatically determine guilt — every report goes through officer review.
            </p>

            <form wire:submit="submit" class="space-y-4">
                <div>
                    <x-input-label for="schoolId" value="School" />
                    <select wire:model="schoolId" id="schoolId" class="border-gray-300 rounded-md shadow-sm mt-1 w-full">
                        <option value="">Select school</option>
                        @foreach ($schools as $school)
                            <option value="{{ $school->id }}">{{ $school->name }} ({{ $school->city }})</option>
                        @endforeach
                    </select>
                    <x-input-error :messages="$errors->get('schoolId')" class="mt-2" />
                </div>

                @if ($myComplaints->isNotEmpty())
                    <div>
                        <x-input-label for="complaintId" value="Related complaint (optional)" />
                        <select wire:model="complaintId" id="complaintId" class="border-gray-300 rounded-md shadow-sm mt-1 w-full">
                            <option value="">Not related to a specific complaint</option>
                            @foreach ($myComplaints as $complaint)
                                <option value="{{ $complaint->id }}">{{ $complaint->complaint_number }} — {{ $complaint->subject }}</option>
                            @endforeach
                        </select>
                    </div>
                @endif

                <div>
                    <x-input-label for="category" value="Category" />
                    <select wire:model="category" id="category" class="border-gray-300 rounded-md shadow-sm mt-1 w-full">
                        <option value="">Select category</option>
                        <option value="intimidation">Intimidation</option>
                        <option value="harassment">Harassment</option>
                        <option value="discrimination">Discrimination</option>
                        <option value="punishment">Punishment</option>
                        <option value="academic_retaliation">Academic Retaliation</option>
                        <option value="threats">Threats</option>
                        <option value="withdrawal_of_facilities">Withdrawal of Facilities</option>
                        <option value="other">Other</option>
                    </select>
                    <x-input-error :messages="$errors->get('category')" class="mt-2" />
                </div>

                <div>
                    <x-input-label for="description" value="What happened" />
                    <textarea wire:model.blur="description" id="description" rows="5" class="border-gray-300 rounded-md shadow-sm mt-1 w-full"></textarea>
                    <x-input-error :messages="$errors->get('description')" class="mt-2" />
                    @if ($possibleDuplicateId)
                        <p class="text-xs text-yellow-700 bg-yellow-50 rounded p-2 mt-2">
                            This looks similar to a {{ $possibleDuplicateCategory }} report already filed for this
                            school. You can still submit — this is just a heads-up, not a block.
                        </p>
                    @endif
                </div>

                <x-primary-button>Submit Report</x-primary-button>
            </form>
        </div>
    </div>
</div>
