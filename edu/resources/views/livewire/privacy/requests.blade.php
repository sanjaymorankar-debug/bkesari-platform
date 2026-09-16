
<?php

use App\Models\DataSubjectRequest;
use App\Models\User;
use App\Services\DataSubjectRequestService;
use App\Services\DevelopmentAccessService;
use App\Support\DataRetention;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\ValidationException;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

/**
 * Spec sections 21 and 40 — where a family exercises their DPDP rights.
 *
 * The page tells people what cannot be erased *before* they ask, with the
 * reason, rather than after they have waited a month for a refusal. That is
 * the difference between a right that is honoured and one that is processed.
 */
new #[Layout('layouts.app')] class extends Component
{
    public string $subjectUserId = '';

    public string $requestType = 'access';

    public array $selected = [];

    public string $detail = '';

    public string $flash = '';

    public function mount(): void
    {
        abort_unless(Auth::check(), 403);

        $this->subjectUserId = (string) Auth::id();
    }

    public function submit(): void
    {
        $validated = $this->validate([
            'subjectUserId' => ['required', 'integer'],
            'requestType' => ['required', 'in:'.implode(',', array_keys(DataSubjectRequest::TYPES))],
            'detail' => ['nullable', 'string', 'max:2000'],
        ], [], ['requestType' => 'request type']);

        $categories = array_keys(array_filter($this->selected));

        try {
            $request = app(DataSubjectRequestService::class)->submit(
                Auth::user(),
                (int) $validated['subjectUserId'],
                $validated['requestType'],
                $categories,
                $validated['detail'] ?: null,
            );
        } catch (ValidationException $e) {
            $this->addError('selected', $e->validator->errors()->first());

            return;
        }

        $this->selected = [];
        $this->detail = '';
        $this->flash = 'Request '.$request->reference.' received. Keep that reference — we will respond by '
            .$request->due_by->format('j M Y').'.';
    }

    public function with(): array
    {
        $user = Auth::user();

        // Yourself, plus any child you are a verified guardian of.
        $subjects = collect([['id' => $user->id, 'name' => $user->name.' (you)']]);

        foreach (app(DevelopmentAccessService::class)->guardianChildIds($user) as $childId) {
            $child = User::find($childId);

            if ($child) {
                $subjects->push(['id' => $child->id, 'name' => $child->name]);
            }
        }

        return [
            'subjects' => $subjects,
            'types' => DataSubjectRequest::TYPES,
            'categories' => DataRetention::CATEGORIES,
            'myRequests' => DataSubjectRequest::where('requester_user_id', $user->id)
                ->latest()
                ->get(),
        ];
    }
}; ?>

<div>
    <x-slot name="title">Your data rights</x-slot>

    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">Your data rights</h2>
    </x-slot>

    <div class="py-8 max-w-3xl mx-auto sm:px-6 lg:px-8 space-y-6">

        @if ($flash)
            <div role="status" aria-live="polite" class="bg-green-50 border border-green-200 text-green-800 rounded-lg p-4 text-sm">{{ $flash }}</div>
        @endif

        <div class="bg-white rounded-lg shadow p-6">
            <p class="text-sm text-gray-700">
                Under the Digital Personal Data Protection Act 2023 you can ask to see what this platform holds
                about you or your child, have it corrected, or have it deleted. Requests go to the Data
                Protection Officer.
            </p>
        </div>

        {{-- Said before the request, not after a month of waiting. --}}
        <div class="bg-amber-50 border border-amber-200 rounded-lg p-6">
            <h3 class="font-semibold text-amber-900 mb-2">Some things cannot be deleted, and it's fair to say so now</h3>
            <ul class="text-sm text-amber-900 space-y-2">
                @foreach ($categories as $key => $meta)
                    @unless ($meta['erasable'])
                        <li>
                            <strong>{{ $meta['label'] }}</strong> — {{ $meta['basis'] }}
                        </li>
                    @endunless
                @endforeach
            </ul>
        </div>

        <form wire:submit="submit" class="bg-white rounded-lg shadow p-6 space-y-5">
            <div class="grid sm:grid-cols-2 gap-4">
                <div>
                    <label for="subjectUserId" class="block text-sm font-medium text-gray-700 mb-1">Whose data?</label>
                    <select wire:model="subjectUserId" id="subjectUserId" class="w-full rounded border-gray-300 text-sm">
                        @foreach ($subjects as $subject)
                            <option value="{{ $subject['id'] }}">{{ $subject['name'] }}</option>
                        @endforeach
                    </select>
                </div>
                <div>
                    <label for="requestType" class="block text-sm font-medium text-gray-700 mb-1">What are you asking for?</label>
                    <select wire:model="requestType" id="requestType" class="w-full rounded border-gray-300 text-sm">
                        @foreach ($types as $key => $label)
                            <option value="{{ $key }}">{{ $label }}</option>
                        @endforeach
                    </select>
                </div>
            </div>

            <fieldset>
                <legend class="block text-sm font-medium text-gray-700 mb-2">Which information?</legend>
                <div class="space-y-2">
                    @foreach ($categories as $key => $meta)
                        <label class="flex items-start gap-2 text-sm">
                            <input type="checkbox" wire:model="selected.{{ $key }}" class="mt-0.5 rounded text-indigo-600">
                            <span>
                                {{ $meta['label'] }}
                                <span class="text-xs text-gray-400">
                                    &middot; kept {{ \App\Support\DataRetention::retentionLabel($key) }}
                                    @unless ($meta['erasable'])
                                        &middot; <span class="text-amber-700">cannot be deleted</span>
                                    @endunless
                                </span>
                            </span>
                        </label>
                    @endforeach
                </div>
                @error('selected') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
            </fieldset>

            <div>
                <label for="detail" class="block text-sm font-medium text-gray-700 mb-1">
                    Anything else we should know? <span class="text-gray-400 font-normal">(optional)</span>
                </label>
                <textarea wire:model="detail" id="detail" rows="3" maxlength="2000" class="w-full rounded border-gray-300 text-sm"></textarea>
            </div>

            <button type="submit" class="px-4 py-2 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700">Send request</button>
        </form>

        @if ($myRequests->isNotEmpty())
            <div class="bg-white rounded-lg shadow p-6">
                <h3 class="font-semibold text-gray-900 mb-4">Your requests</h3>
                @foreach ($myRequests as $request)
                    <div class="py-3 border-b last:border-0">
                        <div class="flex flex-wrap items-center justify-between gap-2">
                            <span class="font-mono text-xs text-gray-500">{{ $request->reference }}</span>
                            <span class="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                                {{ str_replace('_', ' ', $request->status) }}
                            </span>
                        </div>
                        <div class="text-sm text-gray-800 mt-1">{{ $request->typeLabel() }}</div>
                        <div class="text-xs text-gray-400">
                            Sent {{ $request->created_at->format('j M Y') }}
                            @if ($request->isOpen()) &middot; due {{ $request->due_by?->format('j M Y') }} @endif
                        </div>

                        @if ($request->outcome_by_category)
                            <div class="mt-2 space-y-1">
                                @foreach ($request->outcome_by_category as $category => $outcome)
                                    <div class="text-xs {{ $outcome['result'] === 'erased' ? 'text-gray-600' : 'text-amber-800' }}">
                                        <strong>{{ \App\Support\DataRetention::label($category) }}</strong> —
                                        @if ($outcome['result'] === 'erased')
                                            deleted ({{ $outcome['records'] }} {{ Str::plural('record', $outcome['records']) }})
                                        @else
                                            kept: {{ $outcome['reason'] }}
                                        @endif
                                    </div>
                                @endforeach
                            </div>
                        @endif

                        @if ($request->response_note)
                            <p class="text-sm text-gray-600 mt-1">{{ $request->response_note }}</p>
                        @endif
                    </div>
                @endforeach
            </div>
        @endif
    </div>
</div>
