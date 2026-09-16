<?php

use App\Models\AnonymousIdentity;
use App\Models\OfficerJurisdiction;
use App\Models\RetaliationReport;
use Illuminate\Support\Facades\Auth;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

new #[Layout('layouts.app')] class extends Component
{
    public RetaliationReport $retaliationReport;
    public string $newStatus = '';

    public function mount(RetaliationReport $retaliationReport): void
    {
        $user = Auth::user();
        $owns = AnonymousIdentity::where('user_id', $user->id)->where('anonymous_ref', $retaliationReport->anonymous_ref)->exists();

        abort_unless($owns || $this->canReview($retaliationReport), 403);

        $this->retaliationReport = $retaliationReport->load(['school', 'complaint']);
    }

    private function canReview(RetaliationReport $report): bool
    {
        $user = Auth::user();

        if ($user->hasRole('district_officer')) {
            return OfficerJurisdiction::where('user_id', $user->id)
                ->where('level', 'district')->where('district_id', $report->district_id)->exists();
        }

        if ($user->hasRole('state_officer')) {
            return OfficerJurisdiction::where('user_id', $user->id)
                ->where('level', 'state')->where('state_id', $report->state_id)->exists();
        }

        return $user->hasAnyRole(['national_admin', 'system_admin']);
    }

    public function updateStatus(): void
    {
        abort_unless($this->canReview($this->retaliationReport), 403);

        $this->validate(['newStatus' => ['required', 'in:under_review,investigating,action_taken,resolved,closed']]);

        $this->retaliationReport->update([
            'status' => $this->newStatus,
            'resolved_at' => in_array($this->newStatus, ['resolved', 'closed'], true) ? now() : null,
        ]);

        $this->retaliationReport->refresh();
        $this->newStatus = '';
    }

    public function with(): array
    {
        return ['canReview' => $this->canReview($this->retaliationReport)];
    }
}; ?>

<div>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">Retaliation Report #{{ $retaliationReport->id }}</h2>
    </x-slot>

    <div class="py-8 max-w-3xl mx-auto sm:px-6 lg:px-8 space-y-6">
        <div class="bg-white rounded-lg shadow p-6">
            <div class="flex justify-between items-start">
                <div>
                    <h3 class="font-semibold text-lg">{{ ucfirst(str_replace('_', ' ', $retaliationReport->category)) }}</h3>
                    <p class="text-sm text-gray-500">{{ $retaliationReport->school->name }}</p>
                    @if ($retaliationReport->complaint)
                        <p class="text-xs text-gray-400 mt-1">Related to complaint {{ $retaliationReport->complaint->complaint_number }}</p>
                    @endif
                </div>
                <span class="text-xs font-medium px-2 py-1 rounded bg-red-50 text-red-700">{{ str_replace('_', ' ', $retaliationReport->status) }}</span>
            </div>
            <p class="text-gray-700 text-sm mt-4 whitespace-pre-line">{{ $retaliationReport->description }}</p>
            <p class="text-xs text-gray-400 mt-4">Reported as {{ $retaliationReport->anonymous_ref }} ({{ $retaliationReport->submitted_role }})</p>
        </div>

        @if ($canReview)
            <div class="bg-white rounded-lg shadow p-6">
                <h3 class="font-semibold text-gray-900 mb-3">Update Status</h3>
                <p class="text-xs text-gray-500 mb-3">This is a review-workflow update, not a determination of guilt (spec section U).</p>
                <div class="flex gap-3">
                    <select wire:model="newStatus" class="border-gray-300 rounded-md shadow-sm text-sm">
                        <option value="">Select status</option>
                        <option value="under_review">Under Review</option>
                        <option value="investigating">Investigating</option>
                        <option value="action_taken">Action Taken</option>
                        <option value="resolved">Resolved</option>
                        <option value="closed">Closed</option>
                    </select>
                    <x-primary-button wire:click="updateStatus">Update</x-primary-button>
                </div>
                <x-input-error :messages="$errors->get('newStatus')" class="mt-2" />
            </div>
        @endif
    </div>
</div>
