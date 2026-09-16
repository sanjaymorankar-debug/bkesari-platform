
<?php

use App\Models\DataSubjectRequest;
use App\Services\DataSubjectRequestService;
use App\Support\DataRetention;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\ValidationException;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

/**
 * Spec sections 21 and 40 — the Data Protection Officer's queue.
 *
 * The role existed with nothing behind it. Overdue requests are listed first,
 * because a data-subject right honoured late is a right honoured badly.
 */
new #[Layout('layouts.app')] class extends Component
{
    public ?int $actingOn = null;

    public string $note = '';

    public string $flash = '';

    public function mount(): void
    {
        abort_unless(
            Auth::user()?->hasAnyRole(['data_protection_officer', 'system_admin']),
            403
        );
    }

    public function startAction(int $requestId): void
    {
        $this->actingOn = $requestId;
        $this->note = '';
    }

    public function cancel(): void
    {
        $this->reset(['actingOn', 'note']);
    }

    public function fulfil(): void
    {
        $request = DataSubjectRequest::findOrFail($this->actingOn);
        $service = app(DataSubjectRequestService::class);

        try {
            if ($request->request_type === 'erasure') {
                $service->fulfilErasure(Auth::user(), $request, $this->note ?: null);
            } else {
                $service->complete(Auth::user(), $request, $this->note);
            }
        } catch (ValidationException $e) {
            $this->addError('note', $e->validator->errors()->first());

            return;
        }

        $this->cancel();
        $this->flash = 'Request '.$request->reference.' has been dealt with and the requester can see the outcome.';
    }

    public function with(): array
    {
        return [
            // Overdue first, then oldest — a queue ordered by newest would
            // bury the request that has been waiting longest.
            'requests' => DataSubjectRequest::with(['requester:id,name', 'subject:id,name'])
                ->orderByRaw("CASE WHEN status IN ('submitted','under_review') THEN 0 ELSE 1 END")
                ->orderBy('due_by')
                ->limit(100)
                ->get(),
            'categories' => DataRetention::CATEGORIES,
        ];
    }
}; ?>

<div>
    <x-slot name="title">Data protection requests</x-slot>

    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">Data protection requests</h2>
    </x-slot>

    <div class="py-8 max-w-4xl mx-auto sm:px-6 lg:px-8 space-y-6">

        @if ($flash)
            <div role="status" aria-live="polite" class="bg-green-50 border border-green-200 text-green-800 rounded-lg p-4 text-sm">{{ $flash }}</div>
        @endif

        <div class="bg-indigo-50 border border-indigo-100 rounded-lg p-4 text-sm text-indigo-900">
            Erasure deletes what can lawfully be deleted and keeps what cannot, recording the reason for each.
            Safeguarding cases, consent records and audit logs are never removed — the requester is told that,
            not left to assume otherwise.
        </div>

        <div class="bg-white rounded-lg shadow divide-y">
            @forelse ($requests as $request)
                <div class="p-4">
                    <div class="flex flex-wrap items-start justify-between gap-3">
                        <div class="flex-1 min-w-64">
                            <div class="flex flex-wrap items-center gap-2">
                                <span class="font-mono text-xs text-gray-500">{{ $request->reference }}</span>
                                <span class="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                                    {{ $request->typeLabel() }}
                                </span>
                                @if ($request->isOverdue())
                                    <span class="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-800">Overdue</span>
                                @endif
                                @unless ($request->isOpen())
                                    <span class="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-800">
                                        {{ str_replace('_', ' ', $request->status) }}
                                    </span>
                                @endunless
                            </div>
                            <div class="text-sm text-gray-800 mt-1">
                                About {{ $request->subject?->name }}
                                @if ($request->requester_user_id !== $request->subject_user_id)
                                    <span class="text-gray-400">&middot; asked by {{ $request->requester?->name }}</span>
                                @endif
                            </div>
                            <div class="text-xs text-gray-500 mt-1">
                                @foreach ($request->categories ?? [] as $category)
                                    <span class="inline-block mr-2">{{ $categories[$category]['label'] ?? $category }}</span>
                                @endforeach
                            </div>
                            @if ($request->detail)
                                <p class="text-sm text-gray-600 mt-1">{{ $request->detail }}</p>
                            @endif
                            <div class="text-xs text-gray-400 mt-1">
                                Received {{ $request->created_at->format('j M Y') }}
                                @if ($request->isOpen()) &middot; due {{ $request->due_by?->format('j M Y') }} @endif
                            </div>
                        </div>

                        @if ($request->isOpen())
                            <button wire:click="startAction({{ $request->id }})"
                                class="px-3 py-1.5 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700">
                                {{ $request->request_type === 'erasure' ? 'Carry out erasure' : 'Record outcome' }}
                            </button>
                        @endif
                    </div>

                    @if ($request->request_type === 'erasure' && $request->isOpen())
                        @php $scope = $request->erasureScope(); @endphp
                        <div class="mt-2 text-xs text-gray-500">
                            Will delete: {{ count($scope['erasable']) }} {{ Str::plural('category', count($scope['erasable'])) }}.
                            Will keep: {{ count($scope['protected']) }}.
                        </div>
                    @endif

                    @if ($actingOn === $request->id)
                        <form wire:submit="fulfil" class="mt-3 space-y-2 border-t pt-3">
                            <label for="note" class="block text-sm font-medium text-gray-700">
                                What did you do?
                                @if ($request->request_type !== 'erasure')
                                    <span class="text-gray-400 font-normal">(required)</span>
                                @endif
                            </label>
                            <textarea wire:model="note" id="note" rows="2" maxlength="2000" class="w-full rounded border-gray-300 text-sm"></textarea>
                            @error('note') <p class="text-xs text-red-600">{{ $message }}</p> @enderror
                            <div class="flex gap-2">
                                <button type="submit" class="px-3 py-1.5 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700">Confirm</button>
                                <button type="button" wire:click="cancel" class="px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-700">Cancel</button>
                            </div>
                        </form>
                    @endif

                    @if ($request->outcome_by_category)
                        <div class="mt-2 space-y-1">
                            @foreach ($request->outcome_by_category as $category => $outcome)
                                <div class="text-xs {{ $outcome['result'] === 'erased' ? 'text-gray-600' : 'text-amber-800' }}">
                                    {{ $categories[$category]['label'] ?? $category }} —
                                    {{ $outcome['result'] === 'erased'
                                        ? 'deleted ('.$outcome['records'].' records)'
                                        : 'kept: '.$outcome['reason'] }}
                                </div>
                            @endforeach
                        </div>
                    @endif
                </div>
            @empty
                <p class="p-6 text-sm text-gray-400">No requests yet.</p>
            @endforelse
        </div>
    </div>
</div>
