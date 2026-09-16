
<?php

use App\Models\AuditLog;
use App\Models\FacilityClaim;
use App\Models\OfficerJurisdiction;
use App\Models\School;
use Illuminate\Support\Facades\Auth;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

/**
 * Spec sections 5 and 8 — the officer's verification queue.
 *
 * Both `School::markUdiseVerified()` and `FacilityClaim::markVerified()`
 * existed with nothing behind them, which meant that in practice nothing on
 * the platform was ever verified: every school showed "not yet confirmed" and
 * every claim showed "not yet checked" forever. A verification badge nobody
 * can grant is worse than no badge, because it makes the unverified state look
 * like a judgement rather than a backlog.
 *
 * Verifying is deliberately a two-step act. An officer must tick that they
 * actually checked the code against government data before the button does
 * anything — rule 44 forbids claiming a government verification without
 * evidence, and a single click labelled "Verify" makes it far too easy to
 * grant one on a glance.
 */
new #[Layout('layouts.app')] class extends Component
{
    /** Schools the officer has ticked as checked this session. */
    public array $confirmedUdise = [];

    public string $flash = '';

    public function mount(): void
    {
        abort_unless(
            Auth::user()?->hasAnyRole(['district_officer', 'state_officer', 'national_admin', 'system_admin']),
            403
        );
    }

    /** @return array{0: \Illuminate\Support\Collection, 1: \Illuminate\Support\Collection} */
    private function jurisdiction(): array
    {
        $user = Auth::user();

        return [
            OfficerJurisdiction::where('user_id', $user->id)->where('level', 'district')->pluck('district_id'),
            OfficerJurisdiction::where('user_id', $user->id)->where('level', 'state')->pluck('state_id'),
        ];
    }

    private function schoolsInScope()
    {
        $user = Auth::user();
        [$districtIds, $stateIds] = $this->jurisdiction();

        $query = School::query();

        if ($user->hasAnyRole(['national_admin', 'system_admin'])) {
            return $query;
        }

        return $query->where(function ($q) use ($districtIds, $stateIds): void {
            $q->whereIn('district_id', $districtIds)->orWhereIn('state_id', $stateIds);
        });
    }

    private function assertInScope(School $school): void
    {
        abort_unless(
            $this->schoolsInScope()->whereKey($school->id)->exists(),
            403,
            'That school is outside your jurisdiction.'
        );
    }

    public function confirmUdise(int $schoolId): void
    {
        $school = School::findOrFail($schoolId);

        $this->assertInScope($school);

        // The tick is the point: without it this is a one-click government
        // verification, which is exactly what rule 44 forbids.
        if (! ($this->confirmedUdise[$schoolId] ?? false)) {
            $this->flash = 'Tick the confirmation first — this records a government verification.';

            return;
        }

        $school->markUdiseVerified(Auth::user());

        AuditLog::record('udise.verified', Auth::id(), $school, [
            'udise_code' => $school->udise_code,
        ]);

        unset($this->confirmedUdise[$schoolId]);
        $this->flash = $school->name.' is now marked UDISE Verified.';
    }

    public function verifyClaim(int $claimId): void
    {
        $claim = FacilityClaim::with('school')->findOrFail($claimId);

        $this->assertInScope($claim->school);

        $claim->markVerified(Auth::user());

        AuditLog::record('facility_claim.verified', Auth::id(), $claim, [
            'facility_key' => $claim->facility_key,
            'school_id' => $claim->school_id,
        ]);

        $this->flash = $claim->label().' at '.$claim->school->name.' is now marked as evidence checked.';
    }

    /** Send a claim back when the evidence doesn't stand up. */
    public function returnClaim(int $claimId): void
    {
        $claim = FacilityClaim::with('school')->findOrFail($claimId);

        $this->assertInScope($claim->school);

        $claim->update(['verification_status' => 'unverified']);

        AuditLog::record('facility_claim.returned', Auth::id(), $claim, [
            'facility_key' => $claim->facility_key,
            'school_id' => $claim->school_id,
        ]);

        $this->flash = 'Returned to the school as unchecked. The claim itself is untouched — only its '
            .'evidence status changed.';
    }

    public function with(): array
    {
        $schoolIds = $this->schoolsInScope()->pluck('id');

        return [
            // A code on record that nobody has confirmed. Schools with no code
            // at all are not listed: there is nothing to check.
            'awaitingUdise' => School::whereIn('id', $schoolIds)
                ->whereNotNull('udise_code')
                ->whereNull('udise_verified_at')
                ->orderBy('name')
                ->get(),
            'awaitingEvidence' => FacilityClaim::whereIn('school_id', $schoolIds)
                ->where('verification_status', 'pending')
                ->with('school:id,name')
                ->orderBy('created_at')
                ->get(),
        ];
    }
}; ?>

<div>
    <x-slot name="title">Verification queue</x-slot>

    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">Verification queue</h2>
    </x-slot>

    <div class="py-8 max-w-4xl mx-auto sm:px-6 lg:px-8 space-y-6">

        @if ($flash)
            <div role="status" aria-live="polite" class="bg-green-50 border border-green-200 text-green-800 rounded-lg p-4 text-sm">{{ $flash }}</div>
        @endif

        <div class="bg-white rounded-lg shadow p-6">
            <h3 class="font-semibold text-gray-900 mb-1">UDISE codes awaiting confirmation ({{ $awaitingUdise->count() }})</h3>
            <p class="text-xs text-gray-500 mb-4">
                These schools have entered a UDISE code that nobody has checked. Confirm one only after you
                have looked it up against government data — the badge tells parents this platform verified it.
            </p>

            @forelse ($awaitingUdise as $school)
                <div class="py-3 border-b last:border-0">
                    <div class="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <a href="{{ route('schools.show', $school) }}" wire:navigate
                                class="text-sm font-medium text-indigo-600 hover:underline">{{ $school->name }}</a>
                            <div class="text-xs text-gray-500 mt-0.5">
                                Code on record: <span class="font-mono">{{ $school->udise_code }}</span>
                                &middot; {{ $school->city }}
                            </div>
                        </div>
                        <button wire:click="confirmUdise({{ $school->id }})"
                            class="px-3 py-1.5 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700">
                            Confirm
                        </button>
                    </div>
                    <label class="flex items-start gap-2 text-xs text-gray-600 mt-2">
                        <input type="checkbox" wire:model="confirmedUdise.{{ $school->id }}" class="mt-0.5 rounded text-indigo-600">
                        <span>I have checked this code against UDISE+ government data and it matches this school.</span>
                    </label>
                </div>
            @empty
                <p class="text-sm text-gray-400">Nothing awaiting confirmation.</p>
            @endforelse
        </div>

        <div class="bg-white rounded-lg shadow p-6">
            <h3 class="font-semibold text-gray-900 mb-1">Facility evidence awaiting a check ({{ $awaitingEvidence->count() }})</h3>
            <p class="text-xs text-gray-500 mb-4">
                Schools that submitted supporting evidence for a claim. Checking evidence says the paperwork
                stands up — it is not a statement about whether families can actually use the facility, which
                is what the claimed-vs-experienced comparison is for.
            </p>

            @forelse ($awaitingEvidence as $claim)
                <div class="py-3 border-b last:border-0">
                    <div class="flex flex-wrap items-start justify-between gap-3">
                        <div class="flex-1 min-w-64">
                            <div class="text-sm font-medium text-gray-900">
                                {{ $claim->label() }}
                                <span class="text-xs font-normal text-gray-400">at {{ $claim->school?->name }}</span>
                            </div>
                            @if ($claim->description)
                                <p class="text-sm text-gray-600 mt-1">{{ $claim->description }}</p>
                            @endif
                            @if ($claim->evidence_note)
                                <p class="text-sm text-gray-700 mt-1">
                                    <span class="text-gray-500">Evidence submitted:</span> {{ $claim->evidence_note }}
                                </p>
                            @endif
                            <div class="text-xs text-gray-400 mt-1">{{ $claim->academic_year }}</div>
                        </div>
                        <div class="flex flex-col gap-1">
                            <button wire:click="verifyClaim({{ $claim->id }})"
                                class="px-3 py-1.5 text-xs rounded bg-indigo-600 text-white hover:bg-indigo-700">Evidence checks out</button>
                            <button wire:click="returnClaim({{ $claim->id }})"
                                class="text-xs text-gray-600 hover:underline">Send back as unchecked</button>
                        </div>
                    </div>
                </div>
            @empty
                <p class="text-sm text-gray-400">Nothing awaiting a check.</p>
            @endforelse
        </div>
    </div>
</div>
