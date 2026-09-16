<?php

use App\Models\AnonymousIdentity;
use App\Models\Appeal;
use App\Models\Complaint;
use Illuminate\Support\Facades\Auth;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

new #[Layout('layouts.app')] class extends Component
{
    public Complaint $complaint;
    public string $reason = '';

    /**
     * Beyond the resolution-confirmation's automatic escalate-on-"no" path
     * (spec section T) — a formal appeal, reviewed one level up from
     * wherever the complaint was already handled, for when the submitter
     * disagrees with how the escalation itself was handled.
     */
    public function mount(Complaint $complaint): void
    {
        $owns = AnonymousIdentity::where('user_id', Auth::id())->where('anonymous_ref', $complaint->anonymous_ref)->exists();
        abort_unless($owns, 403);

        abort_unless(in_array($complaint->status, ['escalated', 'action_taken', 'resolved', 'closed'], true), 422, 'This complaint isn\'t far enough along to appeal yet.');
        abort_if(Appeal::where('complaint_id', $complaint->id)->exists(), 422, 'An appeal already exists for this complaint.');

        $this->complaint = $complaint->load(['state', 'district']);
    }

    public function submit(): void
    {
        $this->validate(['reason' => ['required', 'string', 'min:20', 'max:3000']]);

        $appeal = Appeal::create([
            'complaint_id' => $this->complaint->id,
            'district_id' => $this->complaint->district_id,
            'state_id' => $this->complaint->state_id,
            'anonymous_ref' => $this->complaint->anonymous_ref,
            'reason' => $this->reason,
            'status' => 'submitted',
        ]);

        $this->redirect(route('appeals.show', $appeal), navigate: true);
    }
}; ?>

<div>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">Appeal Complaint {{ $complaint->complaint_number }}</h2>
    </x-slot>

    <div class="py-8 max-w-2xl mx-auto sm:px-6 lg:px-8">
        <div class="bg-white rounded-lg shadow p-6">
            <p class="text-sm text-gray-500 mb-6">
                Explain why the outcome so far isn't sufficient. This is reviewed by a State Officer — one level up
                from whoever already handled the complaint — not automatically re-investigated by the same office.
            </p>

            <form wire:submit="submit" class="space-y-4">
                <div>
                    <x-input-label for="reason" value="Reason for appeal" />
                    <textarea wire:model="reason" id="reason" rows="6" class="border-gray-300 rounded-md shadow-sm mt-1 w-full"></textarea>
                    <x-input-error :messages="$errors->get('reason')" class="mt-2" />
                </div>

                <x-primary-button>Submit Appeal</x-primary-button>
            </form>
        </div>
    </div>
</div>
