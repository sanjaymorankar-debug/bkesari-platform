<?php

use App\Models\FacilityClaim;
use App\Models\School;
use App\Models\SchoolReply;
use App\Services\ClaimedVsExperiencedService;
use App\Support\FacilityTaxonomy;
use Illuminate\Support\Facades\Auth;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

/**
 * Spec section 8 — "What This School Offers", maintained by the school itself
 * against the canonical taxonomy.
 *
 * The page also shows the school its own claimed-vs-experienced picture
 * (section 11), including any significant gaps, because a school finding out
 * about a discrepancy from the public profile rather than its own dashboard is
 * the wrong way round — section 29's right of reply starts here.
 */
new #[Layout('layouts.app')] class extends Component
{
    public School $school;

    public string $academicYear = '';

    public string $facilityKey = '';

    public string $description = '';

    public string $applicableClasses = '';

    public string $availability = 'all_students';

    public string $provider = '';

    public string $evidenceNote = '';

    public string $replyFacilityKey = '';

    public string $replyBody = '';

    public bool $isMandatory = false;

    public string $feeAmount = '';

    public string $flash = '';

    public function mount(School $school): void
    {
        $this->school = $school;

        abort_unless($this->canManage(), 403, 'You can only manage facilities for your own school.');

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

    public function addClaim(): void
    {
        abort_unless($this->canManage(), 403);

        $validated = $this->validate([
            'academicYear' => ['required', 'string', 'regex:/^\d{4}-\d{2}$/'],
            'facilityKey' => ['required', 'in:'.FacilityTaxonomy::validationList()],
            'description' => ['nullable', 'string', 'max:1000'],
            'applicableClasses' => ['nullable', 'string', 'max:100'],
            'availability' => ['required', 'in:'.implode(',', array_keys(FacilityClaim::AVAILABILITY))],
            'provider' => ['nullable', 'string', 'max:150'],
            'evidenceNote' => ['nullable', 'string', 'max:1000'],
            'feeAmount' => ['nullable', 'numeric', 'min:0', 'max:99999999'],
        ], [], ['academicYear' => 'academic year', 'facilityKey' => 'facility']);

        $exists = FacilityClaim::where('school_id', $this->school->id)
            ->where('facility_key', $validated['facilityKey'])
            ->where('academic_year', $validated['academicYear'])
            ->exists();

        if ($exists) {
            $this->flash = 'That facility is already listed for '.$validated['academicYear'].'.';

            return;
        }

        FacilityClaim::create([
            'school_id' => $this->school->id,
            'facility_key' => $validated['facilityKey'],
            'academic_year' => $validated['academicYear'],
            'is_offered' => true,
            'description' => $validated['description'] ?: null,
            'applicable_classes' => $validated['applicableClasses'] ?: null,
            'availability' => $validated['availability'],
            'fee_amount' => $validated['feeAmount'] !== '' ? $validated['feeAmount'] : null,
            'is_mandatory' => $this->isMandatory,
            'provider' => $validated['provider'] ?: null,
            'evidence_note' => $validated['evidenceNote'] ?: null,
            // Submitting a supporting note moves the claim into the queue for
            // checking; it never marks itself verified.
            'verification_status' => $validated['evidenceNote'] ? 'pending' : 'unverified',
            'recorded_by_user_id' => Auth::id(),
        ]);

        $this->reset(['facilityKey', 'description', 'applicableClasses', 'provider', 'evidenceNote', 'feeAmount']);
        $this->availability = 'all_students';
        $this->flash = 'Facility added to your listing.';
    }

    /**
     * Spec section 29 — answer a reported gap in words.
     *
     * Deliberately does not touch the discrepancy itself: a reply sits beside
     * what families reported, it does not remove or score it down.
     */
    public function postReply(): void
    {
        abort_unless($this->canManage(), 403);

        $validated = $this->validate([
            'replyFacilityKey' => ['required', 'in:'.FacilityTaxonomy::validationList()],
            'replyBody' => ['required', 'string', 'min:20', 'max:2000'],
        ], [
            'replyBody.min' => 'Please give families enough of an explanation to be useful.',
        ], ['replyFacilityKey' => 'facility', 'replyBody' => 'reply']);

        SchoolReply::create([
            'school_id' => $this->school->id,
            'context_type' => 'facility_discrepancy',
            'context_key' => $validated['replyFacilityKey'],
            'academic_year' => $this->academicYear,
            'body' => $validated['replyBody'],
            'author_user_id' => Auth::id(),
        ]);

        $this->reset(['replyFacilityKey', 'replyBody']);
        $this->flash = 'Your reply is now published beside what families reported.';
    }

    public function removeClaim(int $claimId): void
    {
        abort_unless($this->canManage(), 403);

        FacilityClaim::where('school_id', $this->school->id)->findOrFail($claimId)->delete();

        $this->flash = 'Facility removed from this year\'s listing.';
    }

    public function with(): array
    {
        $claims = FacilityClaim::where('school_id', $this->school->id)
            ->where('academic_year', $this->academicYear)
            ->orderBy('facility_key')
            ->get();

        $comparison = app(ClaimedVsExperiencedService::class)
            ->compareSchool($this->school->id, $this->academicYear);

        return [
            'claims' => $claims,
            'comparison' => $comparison,
            'discrepancies' => array_filter($comparison, fn (array $r): bool => $r['status'] === 'significant_discrepancy'),
            'grouped' => FacilityTaxonomy::grouped(),
            'availabilityOptions' => FacilityClaim::AVAILABILITY,
            'verificationLabels' => FacilityClaim::VERIFICATION_STATUSES,
            'myReplies' => SchoolReply::where('school_id', $this->school->id)
                ->where('context_type', 'facility_discrepancy')
                ->where('academic_year', $this->academicYear)
                ->with('author:id,name')
                ->latest()
                ->get(),
        ];
    }
}; ?>

<div>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">Facilities — {{ $school->name }}</h2>
    </x-slot>

    <div class="py-8 max-w-5xl mx-auto sm:px-6 lg:px-8 space-y-6">

        @if ($flash)
            <div role="status" aria-live="polite" class="bg-green-50 border border-green-200 text-green-800 rounded-lg p-4 text-sm">{{ $flash }}</div>
        @endif

        @if (count($discrepancies) > 0)
            <div class="bg-amber-50 border border-amber-200 rounded-lg p-6">
                <h3 class="font-semibold text-amber-900 mb-2">Families are reporting something different</h3>
                <p class="text-sm text-amber-900 mb-3">
                    For the facilities below, most reports don't match what's listed. This is what families said —
                    not a finding against your school, and nothing is published as proven. There can be good
                    reasons (a lab closed for repairs, limited timetable access). You can respond publicly.
                </p>
                <ul class="text-sm text-amber-900 space-y-1">
                    @foreach ($discrepancies as $row)
                        <li>
                            <strong>{{ $row['label'] }}</strong> —
                            {{ $row['not_available'] }} of {{ $row['report_count'] }} reports say it isn't available
                        </li>
                    @endforeach
                </ul>
            </div>
        @endif

        {{-- Spec section 29 — the school's right of reply. --}}
        <div class="bg-white rounded-lg shadow p-6">
            <h3 class="font-semibold text-gray-900 mb-1">Respond publicly</h3>
            <p class="text-xs text-gray-500 mb-4">
                Your reply appears on your public profile beside what families reported. It doesn't remove or
                change their reports — both sides are shown. Replies are permanent and dated: post a new one if
                the situation changes rather than editing the old one.
            </p>

            <form wire:submit="postReply" class="space-y-3">
                <div>
                    <label for="replyFacilityKey" class="block text-sm font-medium text-gray-700 mb-1">Which facility?</label>
                    <select wire:model="replyFacilityKey" id="replyFacilityKey" class="w-full sm:w-80 rounded border-gray-300 text-sm">
                        <option value="">Choose…</option>
                        @foreach ($claims as $claim)
                            <option value="{{ $claim->facility_key }}">{{ $claim->label() }}</option>
                        @endforeach
                    </select>
                    @error('replyFacilityKey') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
                </div>
                <div>
                    <label for="replyBody" class="block text-sm font-medium text-gray-700 mb-1">Your explanation</label>
                    <textarea wire:model="replyBody" id="replyBody" rows="3" maxlength="2000"
                        class="w-full rounded border-gray-300 text-sm"
                        placeholder="e.g. The pool was closed from June for resurfacing and reopens in November. Swimming lessons moved to the municipal pool in the meantime."></textarea>
                    @error('replyBody') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
                </div>
                <button type="submit" class="px-4 py-2 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700">Publish reply</button>
            </form>

            @if ($myReplies->isNotEmpty())
                <div class="mt-5 pt-4 border-t">
                    <h4 class="text-sm font-medium text-gray-700 mb-2">Replies you've published</h4>
                    @foreach ($myReplies as $reply)
                        <div class="py-2 border-b last:border-0">
                            <div class="text-sm text-gray-900">{{ $reply->subjectLabel() }}</div>
                            <p class="text-sm text-gray-600">{{ $reply->body }}</p>
                            <div class="text-xs text-gray-400">
                                {{ $reply->created_at->format('j M Y') }} &middot; {{ $reply->author?->name }}
                            </div>
                        </div>
                    @endforeach
                </div>
            @endif
        </div>

        <div class="bg-white rounded-lg shadow p-6">
            <label for="academicYear" class="block text-sm font-medium text-gray-700 mb-1">Academic year</label>
            <input type="text" wire:model.live="academicYear" id="academicYear" class="rounded border-gray-300 text-sm w-32">
            @error('academicYear') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
            <p class="text-xs text-gray-500 mt-2">
                Listings are kept per year, so what you offered in a previous year stays on record.
            </p>
        </div>

        <div class="bg-white rounded-lg shadow p-6">
            <h3 class="font-semibold text-gray-900 mb-4">Listed for {{ $academicYear }} ({{ $claims->count() }})</h3>

            @forelse ($claims as $claim)
                @php $row = collect($comparison)->firstWhere('facility_key', $claim->facility_key); @endphp
                <div class="py-3 border-b last:border-0">
                    <div class="flex flex-wrap items-start justify-between gap-3">
                        <div class="flex-1 min-w-64">
                            <div class="flex flex-wrap items-center gap-2">
                                <span class="text-sm font-medium text-gray-900">{{ $claim->label() }}</span>
                                <span class="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{{ $claim->groupLabel() }}</span>
                                <span class="text-xs px-2 py-0.5 rounded-full
                                    {{ $claim->verification_status === 'verified' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600' }}">
                                    {{ $verificationLabels[$claim->verification_status] }}
                                </span>
                            </div>
                            @if ($claim->description)
                                <p class="text-sm text-gray-600 mt-1">{{ $claim->description }}</p>
                            @endif
                            <p class="text-xs text-gray-400 mt-1">
                                {{ $availabilityOptions[$claim->availability] }}
                                @if ($claim->applicable_classes) &middot; classes {{ $claim->applicable_classes }} @endif
                                @if ($claim->provider) &middot; {{ $claim->provider }} @endif
                            </p>
                        </div>
                        <div class="text-right">
                            @if ($row)
                                <div class="text-xs
                                    {{ $row['status'] === 'significant_discrepancy' ? 'text-amber-700' : 'text-gray-500' }}">
                                    {{ $row['status_label'] }}
                                </div>
                                <div class="text-xs text-gray-400">{{ $row['report_count'] }} reports</div>
                            @endif
                            <button wire:click="removeClaim({{ $claim->id }})" class="text-xs text-red-600 hover:underline mt-1">Remove</button>
                        </div>
                    </div>
                </div>
            @empty
                <p class="text-sm text-gray-400">Nothing listed for this year yet.</p>
            @endforelse
        </div>

        <form wire:submit="addClaim" class="bg-white rounded-lg shadow p-6 space-y-4">
            <h3 class="font-semibold text-gray-900">Add a facility</h3>
            <p class="text-xs text-gray-500">
                Only list what students can actually use this year. Everything here is visible to parents and
                can be rated by them.
            </p>

            <div class="grid sm:grid-cols-2 gap-4">
                <div>
                    <label for="facilityKey" class="block text-sm font-medium text-gray-700 mb-1">Facility</label>
                    <select wire:model="facilityKey" id="facilityKey" class="w-full rounded border-gray-300 text-sm">
                        <option value="">Choose…</option>
                        @foreach ($grouped as $groupLabel => $items)
                            <optgroup label="{{ $groupLabel }}">
                                @foreach ($items as $key => $itemLabel)
                                    <option value="{{ $key }}">{{ $itemLabel }}</option>
                                @endforeach
                            </optgroup>
                        @endforeach
                    </select>
                    @error('facilityKey') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
                </div>

                <div>
                    <label for="availability" class="block text-sm font-medium text-gray-700 mb-1">Who can use it?</label>
                    <select wire:model="availability" id="availability" class="w-full rounded border-gray-300 text-sm">
                        @foreach ($availabilityOptions as $key => $optionLabel)
                            <option value="{{ $key }}">{{ $optionLabel }}</option>
                        @endforeach
                    </select>
                </div>

                <div>
                    <label for="applicableClasses" class="block text-sm font-medium text-gray-700 mb-1">
                        Classes <span class="text-gray-400 font-normal">(optional)</span>
                    </label>
                    <input type="text" wire:model="applicableClasses" id="applicableClasses" maxlength="100"
                        placeholder="e.g. 6-12" class="w-full rounded border-gray-300 text-sm">
                </div>

                <div>
                    <label for="provider" class="block text-sm font-medium text-gray-700 mb-1">
                        Provider <span class="text-gray-400 font-normal">(optional)</span>
                    </label>
                    <input type="text" wire:model="provider" id="provider" maxlength="150"
                        placeholder="School, or an external partner" class="w-full rounded border-gray-300 text-sm">
                </div>

                <div>
                    <label for="feeAmount" class="block text-sm font-medium text-gray-700 mb-1">
                        Extra fee, if any (₹) <span class="text-gray-400 font-normal">(optional)</span>
                    </label>
                    <input type="number" step="0.01" wire:model="feeAmount" id="feeAmount" class="w-full rounded border-gray-300 text-sm">
                    @error('feeAmount') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
                </div>

                <div class="flex items-end">
                    <label class="flex items-center gap-2 text-sm">
                        <input type="checkbox" wire:model="isMandatory" class="rounded text-indigo-600"> Mandatory for students
                    </label>
                </div>
            </div>

            <div>
                <label for="description" class="block text-sm font-medium text-gray-700 mb-1">
                    Description <span class="text-gray-400 font-normal">(optional)</span>
                </label>
                <textarea wire:model="description" id="description" rows="2" maxlength="1000" class="w-full rounded border-gray-300 text-sm"></textarea>
            </div>

            <div>
                <label for="evidenceNote" class="block text-sm font-medium text-gray-700 mb-1">
                    Supporting evidence <span class="text-gray-400 font-normal">(optional — sends this for checking)</span>
                </label>
                <input type="text" wire:model="evidenceNote" id="evidenceNote" maxlength="1000"
                    placeholder="e.g. Lab commissioned March 2026, inspection report available"
                    class="w-full rounded border-gray-300 text-sm">
                <p class="text-xs text-gray-400 mt-1">
                    Adding evidence marks this "awaiting check". Only a reviewer can mark it verified.
                </p>
            </div>

            <button type="submit" class="px-4 py-2 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700">Add facility</button>
        </form>
    </div>
</div>
