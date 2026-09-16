<?php

use App\Models\CounsellingSession;
use App\Models\SchoolStaff;
use App\Models\User;
use App\Models\WellbeingConcern;
use App\Services\HealthAccessService;
use Illuminate\Support\Facades\Auth;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

/**
 * Spec section 19 — the counsellor portal.
 *
 * Two lists: observations teachers have raised and nobody has picked up, and
 * the counsellor's own recent sessions. The unseen-observations queue is first
 * because an observation raised and never looked at is the failure this module
 * is meant to prevent.
 */
new #[Layout('layouts.app')] class extends Component
{
    public ?int $recordingForStudentId = null;

    public string $sessionDate = '';

    public string $sessionType = 'follow_up';

    public string $sessionNotes = '';

    public string $shareableSummary = '';

    public string $supportPlan = '';

    public bool $referredExternally = false;

    public ?int $linkedConcernId = null;

    public string $flash = '';

    public function mount(): void
    {
        abort_unless(Auth::user()?->hasRole('counsellor'), 403);

        $this->sessionDate = now()->toDateString();
    }

    private function mySchoolIds()
    {
        return SchoolStaff::where('user_id', Auth::id())->pluck('school_id');
    }

    public function startSession(int $studentId, ?int $concernId = null): void
    {
        $this->recordingForStudentId = $studentId;
        $this->linkedConcernId = $concernId;
        $this->reset(['sessionNotes', 'shareableSummary', 'supportPlan', 'referredExternally']);
        $this->sessionDate = now()->toDateString();
    }

    public function cancelSession(): void
    {
        $this->reset(['recordingForStudentId', 'linkedConcernId', 'sessionNotes', 'shareableSummary', 'supportPlan']);
    }

    public function markSeen(int $concernId): void
    {
        $concern = WellbeingConcern::whereIn('school_id', $this->mySchoolIds())->findOrFail($concernId);

        $concern->markSeenBy(Auth::user());

        app(HealthAccessService::class)->log(
            Auth::user(), $concern->student_user_id, 'wellbeing_concern', 'updated', $concern->id, 'Marked as seen.'
        );

        $this->flash = 'Marked as seen.';
    }

    public function saveSession(): void
    {
        $service = app(HealthAccessService::class);

        $schoolId = SchoolStaff::where('user_id', Auth::id())
            ->whereIn('school_id', $this->mySchoolIds())
            ->value('school_id');

        abort_unless(
            $service->canRecordCounsellingSession(Auth::user(), $this->recordingForStudentId, $schoolId),
            403
        );

        $validated = $this->validate([
            'sessionDate' => ['required', 'date', 'before_or_equal:today'],
            'sessionType' => ['required', 'in:'.implode(',', array_keys(CounsellingSession::SESSION_TYPES))],
            'sessionNotes' => ['required', 'string', 'min:5', 'max:5000'],
            'shareableSummary' => ['nullable', 'string', 'max:2000'],
            'supportPlan' => ['nullable', 'string', 'max:2000'],
        ], [], ['sessionDate' => 'session date', 'sessionNotes' => 'session notes']);

        $session = CounsellingSession::create([
            'student_user_id' => $this->recordingForStudentId,
            'school_id' => $schoolId,
            'wellbeing_concern_id' => $this->linkedConcernId,
            'session_date' => $validated['sessionDate'],
            'session_type' => $validated['sessionType'],
            'session_notes' => $validated['sessionNotes'],
            // Left null unless the counsellor writes one. Never derived from
            // the notes.
            'shareable_summary' => $validated['shareableSummary'] ?: null,
            'support_plan' => $validated['supportPlan'] ?: null,
            'referred_externally' => $this->referredExternally,
            'counsellor_user_id' => Auth::id(),
        ]);

        $service->log(Auth::user(), $session->student_user_id, 'counselling_session', 'created', $session->id);

        if ($this->linkedConcernId) {
            WellbeingConcern::whereKey($this->linkedConcernId)->first()?->markSeenBy(Auth::user());
        }

        $this->cancelSession();
        $this->flash = 'Session recorded.'.($validated['shareableSummary'] ? '' : ' No summary was shared with the guardian.');
    }

    public function with(): array
    {
        $schoolIds = $this->mySchoolIds();

        return [
            'unseen' => WellbeingConcern::whereIn('school_id', $schoolIds)
                ->where('referral_status', 'raised')
                ->with(['student:id,name', 'raisedBy:id,name'])
                ->orderBy('observed_on')
                ->get(),
            'recentSessions' => CounsellingSession::where('counsellor_user_id', Auth::id())
                ->with('student:id,name')
                ->orderByDesc('session_date')
                ->limit(15)
                ->get(),
            'sessionTypes' => CounsellingSession::SESSION_TYPES,
            'recordingFor' => $this->recordingForStudentId
                ? User::find($this->recordingForStudentId)
                : null,
        ];
    }
}; ?>

<div>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">Counsellor portal</h2>
    </x-slot>

    <div class="py-8 max-w-4xl mx-auto sm:px-6 lg:px-8 space-y-6">

        @if ($flash)
            <div role="status" aria-live="polite" class="bg-green-50 border border-green-200 text-green-800 rounded-lg p-4 text-sm">{{ $flash }}</div>
        @endif

        <div class="bg-indigo-50 border border-indigo-100 rounded-lg p-4 text-sm text-indigo-900">
            Your session notes are visible only to you. Guardians see the summary you choose to write, and
            nothing else — if you leave it blank, nothing is shared.
        </div>

        <div class="bg-white rounded-lg shadow p-6">
            <h3 class="font-semibold text-gray-900 mb-1">Observations waiting ({{ $unseen->count() }})</h3>
            <p class="text-xs text-gray-500 mb-4">Raised by staff, oldest first. Nobody has picked these up yet.</p>

            @forelse ($unseen as $concern)
                <div class="py-3 border-b last:border-0">
                    <div class="flex flex-wrap items-start justify-between gap-3">
                        <div class="flex-1 min-w-64">
                            <div class="text-sm font-medium text-gray-900">{{ $concern->student?->name }}</div>
                            <p class="text-sm text-gray-700 mt-1">{{ $concern->observation }}</p>
                            <div class="text-xs text-gray-400 mt-1">
                                {{ $concern->observed_on->format('j M Y') }}
                                &middot; raised by {{ $concern->raisedBy?->name }} ({{ $concern->raised_by_role }})
                                @if ($concern->context) &middot; {{ $concern->context }} @endif
                            </div>
                        </div>
                        <div class="flex flex-col gap-1">
                            <button wire:click="startSession({{ $concern->student_user_id }}, {{ $concern->id }})"
                                class="text-xs px-3 py-1.5 rounded bg-indigo-600 text-white hover:bg-indigo-700">Record a session</button>
                            <button wire:click="markSeen({{ $concern->id }})"
                                class="text-xs text-gray-600 hover:underline">Mark as seen</button>
                        </div>
                    </div>
                </div>
            @empty
                <p class="text-sm text-gray-400">Nothing waiting.</p>
            @endforelse
        </div>

        @if ($recordingFor)
            <form wire:submit="saveSession" class="bg-white rounded-lg shadow p-6 space-y-4">
                <h3 class="font-semibold text-gray-900">Record a session — {{ $recordingFor->name }}</h3>

                <div class="grid sm:grid-cols-2 gap-4">
                    <div>
                        <label for="sessionDate" class="block text-sm font-medium text-gray-700 mb-1">Date</label>
                        <input type="date" wire:model="sessionDate" id="sessionDate" class="w-full rounded border-gray-300 text-sm">
                        @error('sessionDate') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
                    </div>
                    <div>
                        <label for="sessionType" class="block text-sm font-medium text-gray-700 mb-1">Type</label>
                        <select wire:model="sessionType" id="sessionType" class="w-full rounded border-gray-300 text-sm">
                            @foreach ($sessionTypes as $key => $label)
                                <option value="{{ $key }}">{{ $label }}</option>
                            @endforeach
                        </select>
                    </div>
                </div>

                <div>
                    <label for="sessionNotes" class="block text-sm font-medium text-gray-700 mb-1">
                        Session notes <span class="text-gray-400 font-normal">(visible only to you)</span>
                    </label>
                    <textarea wire:model="sessionNotes" id="sessionNotes" rows="5" maxlength="5000" class="w-full rounded border-gray-300 text-sm"></textarea>
                    @error('sessionNotes') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
                </div>

                <div>
                    <label for="shareableSummary" class="block text-sm font-medium text-gray-700 mb-1">
                        Summary for the guardian <span class="text-gray-400 font-normal">(optional — this is the only part they see)</span>
                    </label>
                    <textarea wire:model="shareableSummary" id="shareableSummary" rows="3" maxlength="2000" class="w-full rounded border-gray-300 text-sm"></textarea>
                </div>

                <div>
                    <label for="supportPlan" class="block text-sm font-medium text-gray-700 mb-1">Support plan</label>
                    <textarea wire:model="supportPlan" id="supportPlan" rows="2" maxlength="2000" class="w-full rounded border-gray-300 text-sm"></textarea>
                </div>

                <label class="flex items-center gap-2 text-sm">
                    <input type="checkbox" wire:model="referredExternally" class="rounded text-indigo-600">
                    Referred to an external service
                </label>

                <div class="flex gap-2">
                    <button type="submit" class="px-4 py-2 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700">Save session</button>
                    <button type="button" wire:click="cancelSession" class="px-4 py-2 text-sm rounded border border-gray-300 text-gray-700">Cancel</button>
                </div>
            </form>
        @endif

        <div class="bg-white rounded-lg shadow p-6">
            <h3 class="font-semibold text-gray-900 mb-4">Your recent sessions</h3>
            @forelse ($recentSessions as $session)
                <div class="flex flex-wrap items-center justify-between gap-2 py-2 border-b last:border-0">
                    <div>
                        <span class="text-sm text-gray-900">{{ $session->student?->name }}</span>
                        <span class="text-xs text-gray-400">&middot; {{ \App\Models\CounsellingSession::SESSION_TYPES[$session->session_type] }}</span>
                        @unless ($session->shareable_summary)
                            <span class="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">no summary shared</span>
                        @endunless
                    </div>
                    <span class="text-xs text-gray-400">{{ $session->session_date->format('j M Y') }}</span>
                </div>
            @empty
                <p class="text-sm text-gray-400">No sessions recorded yet.</p>
            @endforelse
        </div>
    </div>
</div>
