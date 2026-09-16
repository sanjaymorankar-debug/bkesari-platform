
<?php

use App\Models\SchoolStaff;
use App\Models\StudentSchoolRelationship;
use App\Models\User;
use App\Models\WellbeingConcern;
use App\Services\HealthAccessService;
use Illuminate\Support\Facades\Auth;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

/**
 * Spec section 19 — a teacher raising an observation, and nothing more.
 *
 * The page is written to make the boundary obvious rather than to police it
 * afterwards: it asks what was seen, not what it means, and says plainly that
 * the teacher is not being asked to assess the child. The structural
 * enforcement is that this writes to `wellbeing_concerns`, which has no
 * clinical column to put an opinion in even if someone tried.
 */
new #[Layout('layouts.app')] class extends Component
{
    public User $student;

    public int $schoolId = 0;

    public string $observation = '';

    public string $context = '';

    public string $observedOn = '';

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
            app(HealthAccessService::class)->canRaiseWellbeingConcern(Auth::user(), $student->id, $schoolId),
            403,
            'You can raise an observation only for a student at your school, and only where the guardian has '
                .'consented to wellbeing records.'
        );

        $this->schoolId = $schoolId;
        $this->observedOn = now()->toDateString();
    }

    public function save(): void
    {
        $service = app(HealthAccessService::class);

        abort_unless($service->canRaiseWellbeingConcern(Auth::user(), $this->student->id, $this->schoolId), 403);

        $validated = $this->validate([
            'observation' => ['required', 'string', 'min:15', 'max:2000'],
            'context' => ['nullable', 'string', 'max:200'],
            'observedOn' => ['required', 'date', 'before_or_equal:today'],
        ], [
            'observation.min' => 'Please describe what you actually saw — enough for a counsellor to work with.',
            'observedOn.before_or_equal' => 'An observation cannot be dated in the future.',
        ], ['observedOn' => 'date observed']);

        $concern = WellbeingConcern::create([
            'student_user_id' => $this->student->id,
            'school_id' => $this->schoolId,
            'observation' => $validated['observation'],
            'context' => $validated['context'] ?: null,
            'observed_on' => $validated['observedOn'],
            'raised_by_user_id' => Auth::id(),
            'raised_by_role' => Auth::user()->getRoleNames()->first(),
        ]);

        $service->log(Auth::user(), $this->student->id, 'wellbeing_concern', 'created', $concern->id);

        $this->reset(['observation', 'context']);
        $this->flash = 'Passed to the counsellor. You will not see a clinical outcome — that stays with them.';
    }
}; ?>

<div>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">Raise a wellbeing observation</h2>
    </x-slot>

    <div class="py-8 max-w-2xl mx-auto sm:px-6 lg:px-8 space-y-6">

        @if ($flash)
            <div role="status" aria-live="polite" class="bg-green-50 border border-green-200 text-green-800 rounded-lg p-4 text-sm">{{ $flash }}</div>
        @endif

        <div class="bg-indigo-50 border border-indigo-100 rounded-lg p-4 text-sm text-indigo-900">
            <p class="font-medium mb-1">Describe what you saw, not what you think it means.</p>
            <p>
                This is an observation passed to the school counsellor. You are not being asked to assess
                {{ $student->name }}, and this form has nowhere to record a diagnosis on purpose — that is a
                counsellor's work, under their own confidentiality. You won't see the clinical outcome, and
                that is by design rather than an oversight.
            </p>
        </div>

        <form wire:submit="save" class="bg-white rounded-lg shadow p-6 space-y-5">
            <div>
                <label for="observedOn" class="block text-sm font-medium text-gray-700 mb-1">When did you notice this?</label>
                <input type="date" wire:model="observedOn" id="observedOn" class="rounded border-gray-300 text-sm">
                @error('observedOn') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
            </div>

            <div>
                <label for="observation" class="block text-sm font-medium text-gray-700 mb-1">What did you observe?</label>
                <textarea wire:model="observation" id="observation" rows="5" maxlength="2000"
                    class="w-full rounded border-gray-300 text-sm"
                    placeholder="e.g. Has sat alone at break for the last two weeks and has stopped joining group work."></textarea>
                @error('observation') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
            </div>

            <div>
                <label for="context" class="block text-sm font-medium text-gray-700 mb-1">
                    Where or when <span class="text-gray-400 font-normal">(optional)</span>
                </label>
                <input type="text" wire:model="context" id="context" maxlength="200"
                    placeholder="e.g. During maths, and at break" class="w-full rounded border-gray-300 text-sm">
            </div>

            <button type="submit" class="px-4 py-2 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700">
                Send to the counsellor
            </button>
        </form>
    </div>
</div>
