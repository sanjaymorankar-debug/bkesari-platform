<?php

use App\Models\AnonymousIdentity;
use App\Models\Complaint;
use App\Models\SchoolStaff;
use App\Models\User;
use App\Notifications\ComplaintStatusChanged;
use App\Services\IdentityResolutionService;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Gate;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

new #[Layout('layouts.app')] class extends Component
{
    public Complaint $complaint;
    public string $responseMessage = '';
    public string $confirmChoice = '';
    public string $identityReason = '';
    public ?string $revealedName = null;
    public ?string $revealedEmail = null;

    public function mount(Complaint $complaint): void
    {
        Gate::authorize('view', $complaint);
        $this->complaint = $complaint->load(['school', 'category', 'evidence', 'responses.responder', 'statusHistory', 'resolution']);
    }

    /**
     * Hard gate lives in IdentityResolutionService itself (throws without a
     * reason) — this UI just surfaces that requirement. Every reveal is
     * logged to identity_access_logs regardless of how it's triggered.
     */
    public function revealIdentity(): void
    {
        Gate::authorize('review', $this->complaint);

        $this->validate(['identityReason' => ['required', 'string', 'min:10', 'max:500']], [
            'identityReason.required' => 'You must state a reason before identity can be revealed.',
            'identityReason.min' => 'Please provide a more specific reason (at least 10 characters).',
        ]);

        $user = app(IdentityResolutionService::class)->resolve(
            $this->complaint->anonymous_ref,
            'complaint-identity-reveal',
            $this->identityReason
        );

        $this->revealedName = $user?->name ?? 'Unknown';
        $this->revealedEmail = $user?->email;
    }

    /**
     * School responds — moves status forward but does NOT let the school
     * unilaterally close the loop; only the submitter's confirmResolution
     * action can mark it resolved (spec section T).
     */
    public function respond(): void
    {
        Gate::authorize('respond', $this->complaint);

        $this->validate(['responseMessage' => ['required', 'string', 'min:5', 'max:3000']]);

        $this->complaint->responses()->create([
            'responder_type' => 'school',
            'responder_user_id' => Auth::id(),
            'message' => $this->responseMessage,
        ]);

        $this->complaint->recordStatusChange('school_responded', Auth::id(), 'School responded.');
        $this->responseMessage = '';
        $this->complaint->refresh()->load(['responses.responder', 'statusHistory']);
        $this->notifySubmitter('The school responded to your complaint '.$this->complaint->complaint_number.'.');
    }

    public function markResolutionProposed(): void
    {
        Gate::authorize('respond', $this->complaint);

        $this->complaint->resolution()->updateOrCreate([], [
            'resolution_summary' => $this->responseMessage ?: 'School marked this complaint as addressed.',
            'confirmed_by_submitter' => 'pending',
        ]);

        $this->complaint->recordStatusChange('action_taken', Auth::id(), 'School proposed resolution — awaiting submitter confirmation.');
        $this->complaint->refresh()->load(['resolution', 'statusHistory']);
        $this->notifySubmitter('The school proposed a resolution for complaint '.$this->complaint->complaint_number.' — please confirm whether it\'s resolved.');
    }

    /**
     * Looks up the real user behind the complaint's anonymous_ref purely to
     * deliver a notification — never surfaced to the school, which only
     * ever sees the anonymous_ref itself.
     */
    private function notifySubmitter(string $message): void
    {
        $user = AnonymousIdentity::where('anonymous_ref', $this->complaint->anonymous_ref)->first()?->user;
        $user?->notify(new ComplaintStatusChanged($this->complaint, $message));
    }

    private function notifySchoolStaff(string $message): void
    {
        $staffUserIds = SchoolStaff::where('school_id', $this->complaint->school_id)->pluck('user_id');
        User::whereIn('id', $staffUserIds)->get()->each(
            fn (User $user) => $user->notify(new ComplaintStatusChanged($this->complaint, $message))
        );
    }

    /**
     * "Was your issue actually resolved?" — the submitter, not the school,
     * has the final word (spec section T).
     */
    public function confirmResolution(): void
    {
        Gate::authorize('confirmResolution', $this->complaint);

        $this->validate(['confirmChoice' => ['required', 'in:yes,partially,no']]);

        $resolution = $this->complaint->resolution()->firstOrCreate([]);
        $resolution->update([
            'confirmed_by_submitter' => $this->confirmChoice,
            'confirmed_at' => now(),
            'escalated' => $this->confirmChoice === 'no',
        ]);

        $newStatus = match ($this->confirmChoice) {
            'yes' => 'resolved',
            'partially' => 'investigating',
            'no' => 'escalated',
        };

        $this->complaint->recordStatusChange($newStatus, Auth::id(), 'Submitter confirmed: '.$this->confirmChoice);
        $this->complaint->refresh()->load(['resolution', 'statusHistory']);
        $this->notifySchoolStaff('Complaint '.$this->complaint->complaint_number.' was marked "'.$newStatus.'" by the submitter.');
    }

    public function with(): array
    {
        return [
            'canRespond' => Gate::allows('respond', $this->complaint),
            'canConfirm' => Gate::allows('confirmResolution', $this->complaint)
                && in_array($this->complaint->status, ['action_taken', 'school_responded'], true),
            'canRevealIdentity' => Gate::allows('review', $this->complaint) && Auth::user()->can('access-protected-identity'),
        ];
    }
}; ?>

<div>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">Complaint {{ $complaint->complaint_number }}</h2>
    </x-slot>

    <div class="py-8 max-w-3xl mx-auto sm:px-6 lg:px-8 space-y-6">
        <div class="bg-white rounded-lg shadow p-6">
            <div class="flex justify-between items-start">
                <div>
                    <h3 class="font-semibold text-lg">{{ $complaint->subject }}</h3>
                    <p class="text-sm text-gray-500">{{ $complaint->school->name }} &middot; {{ $complaint->category->name }}</p>
                </div>
                <span class="text-xs font-medium px-2 py-1 rounded bg-indigo-50 text-indigo-700">{{ str_replace('_', ' ', $complaint->status) }}</span>
            </div>
            <p class="text-gray-700 text-sm mt-4 whitespace-pre-line">{{ $complaint->description }}</p>
            <p class="text-xs text-gray-400 mt-4">Submitted as {{ $complaint->anonymous_ref }} ({{ $complaint->submitted_role }}) &middot; Severity: {{ $complaint->severity }}</p>

            @if ($complaint->evidence->isNotEmpty())
                <div class="mt-4">
                    <h4 class="text-sm font-medium text-gray-700">Evidence</h4>
                    @foreach ($complaint->evidence as $evidence)
                        <a href="{{ route('complaints.evidence.download', [$complaint, $evidence]) }}" class="text-sm text-indigo-600 hover:underline block">{{ $evidence->original_filename }}</a>
                    @endforeach
                </div>
            @endif
        </div>

        <div class="bg-white rounded-lg shadow p-6">
            <h3 class="font-semibold text-gray-900 mb-3">Responses</h3>
            @forelse ($complaint->responses as $response)
                <div class="border-b last:border-0 py-3">
                    <p class="text-xs text-gray-400 uppercase">{{ $response->responder_type }} &middot; {{ $response->created_at->diffForHumans() }}</p>
                    <p class="text-sm text-gray-700 mt-1">{{ $response->message }}</p>
                </div>
            @empty
                <p class="text-sm text-gray-400">No response yet.</p>
            @endforelse

            @if ($canRespond)
                <div class="mt-4 border-t pt-4">
                    <x-input-label for="responseMessage" value="Respond as school" />
                    <textarea wire:model="responseMessage" id="responseMessage" rows="3" class="border-gray-300 rounded-md shadow-sm mt-1 w-full"></textarea>
                    <x-input-error :messages="$errors->get('responseMessage')" class="mt-2" />
                    <div class="flex gap-3 mt-2">
                        <x-secondary-button wire:click="respond">Send Response</x-secondary-button>
                        <x-primary-button wire:click="markResolutionProposed">Mark as Resolved (propose)</x-primary-button>
                    </div>
                </div>
            @endif
        </div>

        @if ($canConfirm)
            <div class="bg-white rounded-lg shadow p-6">
                <h3 class="font-semibold text-gray-900 mb-2">Was your issue actually resolved?</h3>
                @if ($complaint->resolution)
                    <p class="text-sm text-gray-600 mb-3">School's summary: {{ $complaint->resolution->resolution_summary }}</p>
                @endif
                <div class="flex gap-3">
                    <label class="flex items-center gap-2 text-sm"><input type="radio" wire:model="confirmChoice" value="yes"> Yes</label>
                    <label class="flex items-center gap-2 text-sm"><input type="radio" wire:model="confirmChoice" value="partially"> Partially</label>
                    <label class="flex items-center gap-2 text-sm"><input type="radio" wire:model="confirmChoice" value="no"> No / Still under dispute</label>
                </div>
                <x-input-error :messages="$errors->get('confirmChoice')" class="mt-2" />
                <x-primary-button class="mt-3" wire:click="confirmResolution">Confirm</x-primary-button>
            </div>
        @endif

        @if ($canRevealIdentity)
            <div class="bg-white rounded-lg shadow p-6 border border-red-100">
                <h3 class="font-semibold text-gray-900 mb-1">Reveal Submitter Identity</h3>
                <p class="text-xs text-gray-500 mb-3">
                    Exceptional access only. A reason is required and every reveal is permanently logged with your
                    name, the time, and this reason (spec section I).
                </p>

                @if ($revealedName)
                    <div class="bg-red-50 rounded p-3 text-sm">
                        <p><strong>Name:</strong> {{ $revealedName }}</p>
                        @if ($revealedEmail)
                            <p><strong>Email:</strong> {{ $revealedEmail }}</p>
                        @endif
                    </div>
                @else
                    <x-input-label for="identityReason" value="Reason for accessing identity" />
                    <textarea wire:model="identityReason" id="identityReason" rows="2" class="border-gray-300 rounded-md shadow-sm mt-1 w-full" placeholder="e.g. Investigating child-safety allegation, need to contact submitter directly"></textarea>
                    <x-input-error :messages="$errors->get('identityReason')" class="mt-2" />
                    <x-secondary-button class="mt-3" wire:click="revealIdentity">Reveal Identity</x-secondary-button>
                @endif
            </div>
        @endif

        <div class="bg-white rounded-lg shadow p-6">
            <h3 class="font-semibold text-gray-900 mb-3">Timeline</h3>
            @foreach ($complaint->statusHistory as $event)
                <div class="text-sm py-1 flex justify-between">
                    <span>{{ str_replace('_', ' ', $event->to_status) }}{{ $event->note ? ' — '.$event->note : '' }}</span>
                    <span class="text-gray-400">{{ $event->created_at->diffForHumans() }}</span>
                </div>
            @endforeach
        </div>
    </div>
</div>
