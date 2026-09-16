<?php

use App\Models\Fee;
use App\Models\FeeRevision;
use App\Models\School;
use App\Services\AnnualCostCalculator;
use Illuminate\Support\Facades\Auth;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

/**
 * Spec section 9 — the school's own fee register.
 *
 * Editing an amount writes a `fee_revisions` row rather than silently
 * replacing the old figure, because a fee that moves after admissions close is
 * exactly the thing this module exists to make visible.
 */
new #[Layout('layouts.app')] class extends Component
{
    public School $school;

    public string $academicYear = '';

    // New-fee form
    public string $category = '';

    public string $label = '';

    public string $amount = '';

    public string $frequency = 'annual';

    public string $classGrade = '';

    public bool $isMandatory = true;

    public bool $isRefundable = false;

    public string $conditions = '';

    public string $stateCapStatus = 'not_applicable';

    // Edit-amount form
    public ?int $editingFeeId = null;

    public string $editAmount = '';

    public string $editReason = '';

    public string $flash = '';

    public function mount(School $school): void
    {
        $this->school = $school;

        abort_unless($this->canManage(), 403, 'You can only manage fees for your own school.');

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

    public function addFee(): void
    {
        abort_unless($this->canManage(), 403);

        $validated = $this->validate([
            'academicYear' => ['required', 'string', 'regex:/^\d{4}-\d{2}$/'],
            'category' => ['required', 'in:'.implode(',', array_keys(Fee::CATEGORIES))],
            'label' => ['required', 'string', 'max:150'],
            'amount' => ['required', 'numeric', 'min:0', 'max:99999999'],
            'frequency' => ['required', 'in:'.implode(',', array_keys(Fee::FREQUENCIES))],
            'classGrade' => ['nullable', 'string', 'max:20'],
            'conditions' => ['nullable', 'string', 'max:1000'],
            'stateCapStatus' => ['required', 'in:'.implode(',', array_keys(Fee::CAP_STATUSES))],
        ], [], ['academicYear' => 'academic year']);

        Fee::create([
            'school_id' => $this->school->id,
            'academic_year' => $validated['academicYear'],
            'class_grade' => $validated['classGrade'] ?: null,
            'category' => $validated['category'],
            'label' => $validated['label'],
            'amount' => $validated['amount'],
            'frequency' => $validated['frequency'],
            'is_mandatory' => $this->isMandatory,
            'is_refundable' => $this->isRefundable,
            'conditions' => $validated['conditions'] ?: null,
            'effective_from' => now()->toDateString(),
            'state_cap_status' => $validated['stateCapStatus'],
            'recorded_by_user_id' => Auth::id(),
        ]);

        $this->reset(['category', 'label', 'amount', 'conditions', 'classGrade']);
        $this->frequency = 'annual';
        $this->flash = 'Fee added.';
    }

    public function startEdit(int $feeId): void
    {
        $fee = Fee::where('school_id', $this->school->id)->findOrFail($feeId);

        $this->editingFeeId = $fee->id;
        $this->editAmount = (string) $fee->amount;
        $this->editReason = '';
    }

    public function cancelEdit(): void
    {
        $this->reset(['editingFeeId', 'editAmount', 'editReason']);
    }

    public function saveEdit(): void
    {
        abort_unless($this->canManage(), 403);

        $validated = $this->validate([
            'editAmount' => ['required', 'numeric', 'min:0', 'max:99999999'],
            'editReason' => ['required', 'string', 'min:5', 'max:500'],
        ], [], ['editAmount' => 'amount', 'editReason' => 'reason for the change']);

        $fee = Fee::where('school_id', $this->school->id)->findOrFail($this->editingFeeId);

        if ((float) $validated['editAmount'] === (float) $fee->amount) {
            $this->flash = 'That is the same amount — nothing changed.';
            $this->cancelEdit();

            return;
        }

        // Record before mutating. A revision row is the point of this screen.
        FeeRevision::create([
            'fee_id' => $fee->id,
            'school_id' => $this->school->id,
            'changed_by_user_id' => Auth::id(),
            'previous_amount' => $fee->amount,
            'new_amount' => $validated['editAmount'],
            'previous_snapshot' => $fee->only([
                'category', 'label', 'amount', 'frequency', 'class_grade',
                'is_mandatory', 'is_refundable', 'academic_year', 'state_cap_status',
            ]),
            'reason' => $validated['editReason'],
            'changed_at' => now(),
        ]);

        $fee->update(['amount' => $validated['editAmount']]);

        $this->cancelEdit();
        $this->flash = 'Fee updated. The previous amount is kept in the change history below.';
    }

    public function deleteFee(int $feeId): void
    {
        abort_unless($this->canManage(), 403);

        Fee::where('school_id', $this->school->id)->findOrFail($feeId)->delete();

        $this->flash = 'Fee removed.';
    }

    public function with(): array
    {
        $fees = Fee::where('school_id', $this->school->id)
            ->where('academic_year', $this->academicYear)
            ->orderBy('category')
            ->get();

        $calculator = app(AnnualCostCalculator::class);

        return [
            'fees' => $fees,
            'summary' => $calculator->summarise($fees),
            'categories' => Fee::CATEGORIES,
            'frequencies' => Fee::FREQUENCIES,
            'capStatuses' => Fee::CAP_STATUSES,
            'years' => Fee::where('school_id', $this->school->id)
                ->distinct()->orderByDesc('academic_year')->pluck('academic_year'),
            'revisions' => FeeRevision::where('school_id', $this->school->id)
                ->with(['fee:id,label,category', 'changedBy:id,name'])
                ->latest('changed_at')->limit(25)->get(),
        ];
    }
}; ?>

<div>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">Fees — {{ $school->name }}</h2>
    </x-slot>

    <div class="py-8 max-w-5xl mx-auto sm:px-6 lg:px-8 space-y-6">

        @if ($flash)
            <div role="status" aria-live="polite" class="bg-green-50 border border-green-200 text-green-800 rounded-lg p-4 text-sm">{{ $flash }}</div>
        @endif

        <div class="bg-white rounded-lg shadow p-6">
            <div class="flex flex-wrap items-end gap-4">
                <div>
                    <label for="academicYear" class="block text-sm font-medium text-gray-700 mb-1">Academic year</label>
                    <input type="text" wire:model.live="academicYear" id="academicYear" placeholder="2026-27"
                        class="rounded border-gray-300 text-sm w-32">
                    @error('academicYear') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
                </div>
                @if ($years->isNotEmpty())
                    <div class="flex flex-wrap gap-2 pb-1">
                        @foreach ($years as $year)
                            <button wire:click="$set('academicYear', '{{ $year }}')"
                                class="px-2 py-1 text-xs rounded {{ $academicYear === $year ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200' }}">
                                {{ $year }}
                            </button>
                        @endforeach
                    </div>
                @endif
            </div>
            <p class="text-xs text-gray-500 mt-3">
                Previous years are never overwritten — changing the year above starts a separate set of records.
            </p>
        </div>

        <div class="bg-white rounded-lg shadow p-6">
            <h3 class="font-semibold text-gray-900 mb-4">Estimated cost for {{ $academicYear }}</h3>
            @if ($summary['has_data'])
                <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div class="bg-indigo-50 rounded p-3">
                        <div class="text-xs text-indigo-700">First year (incl. one-time)</div>
                        <div class="text-xl font-bold text-indigo-900">₹{{ number_format($summary['first_year_total']) }}</div>
                    </div>
                    <div class="bg-gray-50 rounded p-3">
                        <div class="text-xs text-gray-600">Every year after</div>
                        <div class="text-xl font-bold text-gray-900">₹{{ number_format($summary['continuing_year_total']) }}</div>
                    </div>
                    <div class="bg-gray-50 rounded p-3">
                        <div class="text-xs text-gray-600">Mandatory (recurring)</div>
                        <div class="text-lg font-semibold text-gray-900">₹{{ number_format($summary['mandatory_recurring']) }}</div>
                    </div>
                    <div class="bg-gray-50 rounded p-3">
                        <div class="text-xs text-gray-600">Optional (recurring)</div>
                        <div class="text-lg font-semibold text-gray-900">₹{{ number_format($summary['optional_recurring']) }}</div>
                    </div>
                </div>
                <p class="text-xs text-gray-500 mt-3">
                    Estimated from what you've entered. Per-term charges are annualised at
                    {{ \App\Services\AnnualCostCalculator::TERMS_PER_YEAR }} terms a year.
                </p>
            @else
                <p class="text-sm text-gray-400">No fees recorded for this year yet.</p>
            @endif
        </div>

        <div class="bg-white rounded-lg shadow p-6">
            <h3 class="font-semibold text-gray-900 mb-4">Fees recorded ({{ $fees->count() }})</h3>
            @forelse ($fees as $fee)
                <div class="py-3 border-b last:border-0">
                    @if ($editingFeeId === $fee->id)
                        <form wire:submit="saveEdit" class="space-y-3">
                            <div class="text-sm font-medium text-gray-900">{{ $fee->label }}</div>
                            <div class="flex flex-wrap gap-3 items-start">
                                <div>
                                    <label class="block text-xs text-gray-600 mb-1">New amount (₹)</label>
                                    <input type="number" step="0.01" wire:model="editAmount" class="rounded border-gray-300 text-sm w-32">
                                    @error('editAmount') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
                                </div>
                                <div class="flex-1 min-w-48">
                                    <label class="block text-xs text-gray-600 mb-1">Why is it changing?</label>
                                    <input type="text" wire:model="editReason" class="w-full rounded border-gray-300 text-sm">
                                    @error('editReason') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
                                </div>
                            </div>
                            <div class="flex gap-2">
                                <button type="submit" class="px-3 py-1.5 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700">Save</button>
                                <button type="button" wire:click="cancelEdit" class="px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-700">Cancel</button>
                            </div>
                        </form>
                    @else
                        <div class="flex flex-wrap items-start justify-between gap-3">
                            <div class="flex-1 min-w-64">
                                <div class="flex flex-wrap items-center gap-2">
                                    <span class="text-sm font-medium text-gray-900">{{ $fee->label }}</span>
                                    <span class="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{{ $fee->categoryLabel() }}</span>
                                    @if ($fee->is_mandatory)
                                        <span class="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">Mandatory</span>
                                    @else
                                        <span class="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">Optional</span>
                                    @endif
                                    @if ($fee->state_cap_status !== 'not_applicable')
                                        <span class="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">{{ $capStatuses[$fee->state_cap_status] }}</span>
                                    @endif
                                </div>
                                <div class="text-xs text-gray-400 mt-1">
                                    {{ $fee->class_grade ? 'Class '.$fee->class_grade : 'All classes' }}
                                    @if ($fee->is_refundable) &middot; refundable @endif
                                    @if ($fee->conditions) &middot; {{ $fee->conditions }} @endif
                                </div>
                            </div>
                            <div class="text-right">
                                <div class="text-sm font-semibold text-gray-900">₹{{ number_format((float) $fee->amount) }}</div>
                                <div class="text-xs text-gray-400">{{ $fee->frequencyLabel() }}</div>
                            </div>
                            <div class="flex gap-2">
                                <button wire:click="startEdit({{ $fee->id }})" class="text-xs text-indigo-600 hover:underline">Change amount</button>
                                <button wire:click="deleteFee({{ $fee->id }})" class="text-xs text-red-600 hover:underline">Remove</button>
                            </div>
                        </div>
                    @endif
                </div>
            @empty
                <p class="text-sm text-gray-400">Nothing recorded yet — add the first fee below.</p>
            @endforelse
        </div>

        <form wire:submit="addFee" class="bg-white rounded-lg shadow p-6 space-y-4">
            <h3 class="font-semibold text-gray-900">Add a fee</h3>

            <div class="grid sm:grid-cols-2 gap-4">
                <div>
                    <label for="category" class="block text-sm font-medium text-gray-700 mb-1">Category</label>
                    <select wire:model="category" id="category" class="w-full rounded border-gray-300 text-sm">
                        <option value="">Choose…</option>
                        @foreach ($categories as $key => $catLabel)
                            <option value="{{ $key }}">{{ $catLabel }}</option>
                        @endforeach
                    </select>
                    @error('category') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
                </div>

                <div>
                    <label for="label" class="block text-sm font-medium text-gray-700 mb-1">What is it called?</label>
                    <input type="text" wire:model="label" id="label" maxlength="150"
                        placeholder="e.g. Term tuition fee" class="w-full rounded border-gray-300 text-sm">
                    @error('label') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
                </div>

                <div>
                    <label for="amount" class="block text-sm font-medium text-gray-700 mb-1">Amount (₹)</label>
                    <input type="number" step="0.01" wire:model="amount" id="amount" class="w-full rounded border-gray-300 text-sm">
                    @error('amount') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
                </div>

                <div>
                    <label for="frequency" class="block text-sm font-medium text-gray-700 mb-1">How often?</label>
                    <select wire:model="frequency" id="frequency" class="w-full rounded border-gray-300 text-sm">
                        @foreach ($frequencies as $key => $freqLabel)
                            <option value="{{ $key }}">{{ $freqLabel }}</option>
                        @endforeach
                    </select>
                </div>

                <div>
                    <label for="classGrade" class="block text-sm font-medium text-gray-700 mb-1">
                        Class <span class="text-gray-400 font-normal">(blank = all classes)</span>
                    </label>
                    <input type="text" wire:model="classGrade" id="classGrade" maxlength="20" class="w-full rounded border-gray-300 text-sm">
                </div>

                <div>
                    <label for="stateCapStatus" class="block text-sm font-medium text-gray-700 mb-1">State fee-cap status</label>
                    <select wire:model="stateCapStatus" id="stateCapStatus" class="w-full rounded border-gray-300 text-sm">
                        @foreach ($capStatuses as $key => $capLabel)
                            <option value="{{ $key }}">{{ $capLabel }}</option>
                        @endforeach
                    </select>
                </div>
            </div>

            <div>
                <label for="conditions" class="block text-sm font-medium text-gray-700 mb-1">
                    Conditions <span class="text-gray-400 font-normal">(optional)</span>
                </label>
                <input type="text" wire:model="conditions" id="conditions" maxlength="1000" class="w-full rounded border-gray-300 text-sm">
            </div>

            <div class="flex flex-wrap gap-4">
                <label class="flex items-center gap-2 text-sm">
                    <input type="checkbox" wire:model="isMandatory" class="rounded text-indigo-600"> Mandatory
                </label>
                <label class="flex items-center gap-2 text-sm">
                    <input type="checkbox" wire:model="isRefundable" class="rounded text-indigo-600"> Refundable
                </label>
            </div>

            <button type="submit" class="px-4 py-2 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700">Add fee</button>
        </form>

        @if ($revisions->isNotEmpty())
            <div class="bg-white rounded-lg shadow p-6">
                <h3 class="font-semibold text-gray-900 mb-1">Change history</h3>
                <p class="text-xs text-gray-500 mb-4">Permanent and visible to parents. Amounts are never quietly replaced.</p>
                @foreach ($revisions as $revision)
                    <div class="py-2 border-b last:border-0 text-sm">
                        <div class="flex flex-wrap justify-between gap-2">
                            <span class="text-gray-800">{{ $revision->fee?->label ?? 'Removed fee' }}</span>
                            <span class="{{ $revision->delta() > 0 ? 'text-red-600' : 'text-green-700' }}">
                                ₹{{ number_format((float) $revision->previous_amount) }} → ₹{{ number_format((float) $revision->new_amount) }}
                            </span>
                        </div>
                        <div class="text-xs text-gray-400">
                            {{ $revision->changed_at->format('j M Y') }} &middot; {{ $revision->changedBy?->name }}
                            @if ($revision->reason) &middot; {{ $revision->reason }} @endif
                        </div>
                    </div>
                @endforeach
            </div>
        @endif
    </div>
</div>
