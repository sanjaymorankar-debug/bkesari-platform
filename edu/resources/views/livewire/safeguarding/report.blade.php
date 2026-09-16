<?php

use App\Models\SafeguardingReport;
use App\Models\School;
use App\Services\SafeguardingService;
use Illuminate\Support\Facades\Auth;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

/**
 * Spec section 25 — reporting a serious safeguarding concern.
 *
 * The design constraint that shapes this whole screen: the platform must make
 * the legal path unmissable and must never imply that using this form
 * discharges it. So the emergency numbers and the POCSO section 19 duty appear
 * *before* the form, not after submission, and the confirmation screen leads
 * with "this is not a report to the police" rather than with a reassuring tick.
 */
new #[Layout('layouts.app')] class extends Component
{
    public School $school;

    public string $category = '';

    public string $description = '';

    public bool $immediateDanger = false;

    public bool $understoodLegalDuty = false;

    public ?string $submittedReference = null;

    public bool $submittedEngagesPocso = false;

    public int $notifiedCount = 0;

    public function mount(School $school): void
    {
        $this->school = $school;
    }

    public function submit(): void
    {
        $user = Auth::user();

        abort_unless($user !== null, 403);

        $validated = $this->validate([
            'category' => ['required', 'in:'.implode(',', array_keys(SafeguardingReport::CATEGORIES))],
            'description' => ['required', 'string', 'min:20', 'max:5000'],
            'understoodLegalDuty' => ['accepted'],
        ], [
            'understoodLegalDuty.accepted' => 'Please confirm you have read the section above about reporting to the police.',
            'description.min' => 'Please give enough detail for the Child Safety Officer to act on.',
        ], ['category' => 'type of concern']);

        $role = match (true) {
            $user->hasRole('parent') => 'parent',
            $user->hasRole('student') => 'student',
            $user->hasRole('teacher') => 'teacher',
            $user->hasAnyRole(['school_admin', 'career_mentor', 'child_safety_officer']) => 'staff',
            default => 'other',
        };

        $report = SafeguardingReport::create([
            'reference' => SafeguardingReport::generateReference(),
            'school_id' => $this->school->id,
            'district_id' => $this->school->district_id,
            'state_id' => $this->school->state_id,
            // Anonymised like every other reporting channel (section 26).
            'anonymous_ref' => $user->anonymousRefFor(
                $this->school,
                in_array($role, ['parent', 'student'], true) ? $role : 'parent'
            ),
            'reporter_role' => $role,
            'category' => $validated['category'],
            'description' => $validated['description'],
            'immediate_danger' => $this->immediateDanger,
        ]);

        $service = app(SafeguardingService::class);
        $service->log($report, 'submitted', null, 'Report submitted.');
        // The reporter was shown the duty above the form; record that.
        $service->recordLegalDutyShown($report);

        // Push the case at the people who can act, rather than waiting for
        // someone to open the queue.
        $this->notifiedCount = $service->notifyResponsibleOfficers($report);

        $this->submittedReference = $report->reference;
        $this->submittedEngagesPocso = $report->engagesPocsoDuty();

        $this->reset(['category', 'description', 'immediateDanger', 'understoodLegalDuty']);
    }

    public function with(): array
    {
        return ['categories' => SafeguardingReport::CATEGORIES];
    }
}; ?>

<div>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">Report a serious concern about a child</h2>
    </x-slot>

    <div class="py-8 max-w-3xl mx-auto sm:px-6 lg:px-8 space-y-6">

        @if ($submittedReference)
            {{-- The confirmation deliberately leads with what this ISN'T. --}}
            <div class="bg-white rounded-lg shadow border-l-4 border-red-500 p-6">
                <h3 class="font-semibold text-gray-900 text-lg mb-2">This is not a report to the police</h3>
                <p class="text-sm text-gray-700 mb-3">
                    Your concern has been sent to the Child Safety Officer and recorded as
                    <strong>{{ $submittedReference }}</strong>. Keep that reference.
                </p>
                <p class="text-sm text-gray-700 mb-3">
                    Reporting it here <strong>does not</strong> satisfy any legal duty you may have.
                    @if ($submittedEngagesPocso)
                        Under section 19 of the POCSO Act 2012, anyone who knows of a child sexual offence has an
                        independent duty to report it to the police or the Special Juvenile Police Unit. A school
                        cannot hold an internal inquiry instead, and neither can this platform.
                    @endif
                </p>
                <div class="bg-red-50 rounded p-4 text-sm text-red-900">
                    <div class="font-medium mb-1">If you have not already contacted them:</div>
                    <ul class="space-y-1">
                        <li><strong>Police — 100</strong> (or 112)</li>
                        <li><strong>Childline — 1098</strong>, free, 24 hours</li>
                        <li>Your district's Special Juvenile Police Unit or Child Welfare Committee</li>
                    </ul>
                </div>
                {{-- Say honestly whether anyone was actually alerted. A school
                     with no Child Safety Officer configured is a real state,
                     and telling the reporter "it's been sent" when nobody was
                     notified would be a comfortable lie. --}}
                @if ($notifiedCount > 0)
                    <p class="text-sm text-gray-700 mt-3">
                        {{ $notifiedCount }} {{ Str::plural('officer', $notifiedCount) }} responsible for child
                        safety {{ $notifiedCount === 1 ? 'has' : 'have' }} been notified.
                    </p>
                @else
                    <p class="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-3 mt-3">
                        <strong>No child safety officer is currently set up to receive this.</strong> Your report
                        is recorded and cannot be deleted, but nobody has been alerted automatically. Please
                        contact the police or Childline on 1098 directly.
                    </p>
                @endif

                <p class="text-xs text-gray-500 mt-3">
                    This report is not public, does not appear on the school's profile, and does not affect any
                    rating or score.
                </p>
            </div>
        @else
            {{-- Everything below appears BEFORE the form on purpose. --}}
            <div class="bg-red-50 border-l-4 border-red-500 rounded-lg p-6">
                <h3 class="font-semibold text-red-900 mb-2">If a child is in danger right now, contact the police first</h3>
                <ul class="text-sm text-red-900 space-y-1 mb-3">
                    <li><strong>Police — 100</strong> (or 112)</li>
                    <li><strong>Childline — 1098</strong>, free, 24 hours</li>
                </ul>
                <p class="text-sm text-red-900">
                    This form is not monitored around the clock and is not an emergency service.
                </p>
            </div>

            <div class="bg-white rounded-lg shadow p-6">
                <h3 class="font-semibold text-gray-900 mb-2">Your legal duty to report</h3>
                <p class="text-sm text-gray-700 mb-2">
                    Under <strong>section 19 of the POCSO Act 2012</strong>, any person who knows that a child
                    has been sexually abused must report it to the police or the Special Juvenile Police Unit.
                    Courts have held that a school may <strong>not</strong> carry out an internal inquiry
                    instead of reporting.
                </p>
                <p class="text-sm text-gray-700">
                    Filling in this form <strong>does not discharge that duty</strong>. What it does is make sure
                    the Child Safety Officer receives the concern, and create a dated record that cannot be
                    quietly deleted.
                </p>
            </div>

            <form wire:submit="submit" class="bg-white rounded-lg shadow p-6 space-y-5">
                <div>
                    <label for="category" class="block text-sm font-medium text-gray-700 mb-1">What is the concern?</label>
                    <select wire:model="category" id="category" class="w-full rounded border-gray-300 text-sm">
                        <option value="">Choose…</option>
                        @foreach ($categories as $key => $label)
                            <option value="{{ $key }}">{{ $label }}</option>
                        @endforeach
                    </select>
                    @error('category') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
                </div>

                <div>
                    <label for="description" class="block text-sm font-medium text-gray-700 mb-1">What happened?</label>
                    <textarea wire:model="description" id="description" rows="6" maxlength="5000"
                        class="w-full rounded border-gray-300 text-sm"
                        placeholder="Include what you saw or were told, when, and who was involved, as far as you know."></textarea>
                    @error('description') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
                </div>

                <label class="flex items-start gap-2 text-sm">
                    <input type="checkbox" wire:model="immediateDanger" class="mt-0.5 rounded text-red-600">
                    <span>I believe a child is in immediate danger</span>
                </label>

                <label class="flex items-start gap-2 text-sm">
                    <input type="checkbox" wire:model="understoodLegalDuty" class="mt-0.5 rounded text-indigo-600">
                    <span>
                        I have read the section above and understand that submitting this form is not a report to
                        the police and does not discharge any legal duty I may have.
                    </span>
                </label>
                @error('understoodLegalDuty') <p class="text-xs text-red-600">{{ $message }}</p> @enderror

                <div class="bg-gray-50 rounded p-4 text-xs text-gray-600">
                    Your name is not attached to this report. It goes to the Child Safety Officer and the
                    district's officers — <strong>not</strong> to the school's administration — and it never
                    appears publicly or in any school rating.
                </div>

                <button type="submit" class="px-4 py-2 text-sm rounded bg-red-600 text-white hover:bg-red-700">
                    Send to the Child Safety Officer
                </button>
            </form>
        @endif
    </div>
</div>
