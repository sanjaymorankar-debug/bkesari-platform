<?php

use App\Models\AnonymousIdentity;
use App\Models\Appeal;
use App\Models\OfficerJurisdiction;
use App\Notifications\AppealDecided;
use Illuminate\Support\Facades\Auth;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

new #[Layout('layouts.app')] class extends Component
{
    public Appeal $appeal;
    public string $decisionNote = '';

    public function mount(Appeal $appeal): void
    {
        $user = Auth::user();
        $owns = AnonymousIdentity::where('user_id', $user->id)->where('anonymous_ref', $appeal->anonymous_ref)->exists();

        abort_unless($owns || $this->canReview($appeal), 403);

        $this->appeal = $appeal->load(['complaint.school', 'district', 'state', 'reviewedBy']);
    }

    /**
     * Appeals are reviewed one level above the original complaint handling —
     * State Officer for the appeal's state, or National Admin/System Admin.
     * District Officers (who typically handled the original complaint) cannot review appeals against it.
     */
    private function canReview(Appeal $appeal): bool
    {
        $user = Auth::user();

        if ($user->hasRole('state_officer')) {
            return OfficerJurisdiction::where('user_id', $user->id)
                ->where('level', 'state')->where('state_id', $appeal->state_id)->exists();
        }

        return $user->hasAnyRole(['national_admin', 'system_admin']);
    }

    public function decide(string $decision): void
    {
        abort_unless($this->canReview($this->appeal), 403);
        abort_unless(in_array($decision, ['upheld', 'denied'], true), 422);

        $this->validate(['decisionNote' => ['required', 'string', 'min:10', 'max:2000']]);

        $this->appeal->update([
            'status' => $decision,
            'reviewed_by_user_id' => Auth::id(),
            'decision_note' => $this->decisionNote,
            'resolved_at' => now(),
        ]);

        $this->appeal->refresh();
        $this->decisionNote = '';

        $submitter = AnonymousIdentity::where('anonymous_ref', $this->appeal->anonymous_ref)->first()?->user;
        $submitter?->notify(new AppealDecided($this->appeal));
    }

    public function beginReview(): void
    {
        abort_unless($this->canReview($this->appeal), 403);

        if ($this->appeal->status === 'submitted') {
            $this->appeal->update(['status' => 'under_review']);
            $this->appeal->refresh();
        }
    }

    public function with(): array
    {
        return ['canReview' => $this->canReview($this->appeal)];
    }
}; ?>

<div>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">Appeal — {{ $appeal->complaint->complaint_number }}</h2>
    </x-slot>

    <div class="py-8 max-w-3xl mx-auto sm:px-6 lg:px-8 space-y-6">
        <div class="bg-white rounded-lg shadow p-6">
            <div class="flex justify-between items-start">
                <div>
                    <h3 class="font-semibold text-lg">{{ $appeal->complaint->school->name }}</h3>
                    <p class="text-xs text-gray-400 mt-1">Filed by {{ $appeal->anonymous_ref }}</p>
                </div>
                <span @class([
                    'text-xs font-medium px-2 py-1 rounded',
                    'bg-yellow-50 text-yellow-700' => $appeal->status === 'submitted',
                    'bg-blue-50 text-blue-700' => $appeal->status === 'under_review',
                    'bg-green-50 text-green-700' => $appeal->status === 'upheld',
                    'bg-gray-100 text-gray-700' => $appeal->status === 'denied',
                ])>{{ str_replace('_', ' ', $appeal->status) }}</span>
            </div>
            <p class="text-gray-700 text-sm mt-4 whitespace-pre-line">{{ $appeal->reason }}</p>
        </div>

        @if ($appeal->status !== 'submitted' && $appeal->decision_note)
            <div class="bg-white rounded-lg shadow p-6">
                <h3 class="font-semibold text-gray-900 mb-2">Decision</h3>
                <p class="text-sm text-gray-700 whitespace-pre-line">{{ $appeal->decision_note }}</p>
                <p class="text-xs text-gray-400 mt-3">Reviewed by {{ $appeal->reviewedBy?->name }} on {{ $appeal->resolved_at?->format('M j, Y') }}</p>
            </div>
        @endif

        @if ($canReview && in_array($appeal->status, ['submitted', 'under_review'], true))
            <div class="bg-white rounded-lg shadow p-6">
                <h3 class="font-semibold text-gray-900 mb-3">Review Appeal</h3>

                @if ($appeal->status === 'submitted')
                    <x-secondary-button wire:click="beginReview" class="mb-4">Begin Review</x-secondary-button>
                @else
                    <div class="space-y-3">
                        <textarea wire:model="decisionNote" rows="4" placeholder="Decision note (required)"
                            class="border-gray-300 rounded-md shadow-sm w-full text-sm"></textarea>
                        <x-input-error :messages="$errors->get('decisionNote')" />
                        <div class="flex gap-3">
                            <x-primary-button wire:click="decide('upheld')">Uphold Appeal</x-primary-button>
                            <x-secondary-button wire:click="decide('denied')">Deny Appeal</x-secondary-button>
                        </div>
                    </div>
                @endif
            </div>
        @endif
    </div>
</div>
