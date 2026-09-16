<?php

use App\Models\SafeguardingReport;
use App\Services\SafeguardingService;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\ValidationException;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

/**
 * Spec section 25 — handling one safeguarding case.
 *
 * The closure control is deliberately blocked, not merely discouraged, while a
 * POCSO case has no external report recorded. See SafeguardingService::close().
 */
new #[Layout('layouts.app')] class extends Component
{
    public SafeguardingReport $report;

    public string $externalChannel = '';

    public string $externalReference = '';

    public string $note = '';

    public string $closureReason = '';

    public string $flash = '';

    public function mount(SafeguardingReport $report): void
    {
        $service = app(SafeguardingService::class);

        abort_unless($service->canView(Auth::user(), $report), 403);

        $this->report = $report;

        // Opening one of these is itself an auditable event.
        $service->recordView(Auth::user(), $report);
    }

    public function acknowledge(): void
    {
        app(SafeguardingService::class)->acknowledge(Auth::user(), $this->report);
        $this->report->refresh();
        $this->flash = 'Case acknowledged.';
    }

    public function recordExternalReport(): void
    {
        $this->validate([
            'externalChannel' => ['required', 'in:'.implode(',', array_keys(SafeguardingReport::EXTERNAL_CHANNELS))],
            'externalReference' => ['nullable', 'string', 'max:100'],
        ], [], ['externalChannel' => 'authority']);

        app(SafeguardingService::class)->recordExternalReport(
            Auth::user(),
            $this->report,
            $this->externalChannel,
            $this->externalReference ?: null,
        );

        $this->report->refresh();
        $this->reset(['externalChannel', 'externalReference']);
        $this->flash = 'External report recorded.';
    }

    public function addNote(): void
    {
        $this->validate(['note' => ['required', 'string', 'min:3', 'max:2000']]);

        app(SafeguardingService::class)->addNote(Auth::user(), $this->report, $this->note);

        $this->reset('note');
        $this->flash = 'Note added to the case record.';
    }

    public function startInvestigation(): void
    {
        app(SafeguardingService::class)->startInvestigation(Auth::user(), $this->report, 'Investigation started.');
        $this->report->refresh();
        $this->flash = 'Case marked as under investigation.';
    }

    public function close(): void
    {
        try {
            app(SafeguardingService::class)->close(Auth::user(), $this->report, $this->closureReason);
        } catch (ValidationException $e) {
            // Surface the POCSO block as a field error rather than a crash.
            $this->addError('closureReason', $e->validator->errors()->first());

            return;
        }

        $this->report->refresh();
        $this->reset('closureReason');
        $this->flash = 'Case closed.';
    }

    public function with(): array
    {
        return [
            'events' => $this->report->events()->with('actor:id,name')->orderBy('occurred_at')->get(),
            'channels' => SafeguardingReport::EXTERNAL_CHANNELS,
            'closureBlocked' => $this->report->engagesPocsoDuty() && ! $this->report->hasExternalReport(),
        ];
    }
}; ?>

<div>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">
            Safeguarding case {{ $report->reference }}
        </h2>
    </x-slot>

    <div class="py-8 max-w-4xl mx-auto sm:px-6 lg:px-8 space-y-6">

        @if ($flash)
            <div role="status" aria-live="polite" class="bg-green-50 border border-green-200 text-green-800 rounded-lg p-4 text-sm">{{ $flash }}</div>
        @endif

        @if ($closureBlocked)
            <div class="bg-red-50 border-l-4 border-red-500 rounded-lg p-6">
                <h3 class="font-semibold text-red-900 mb-2">A report to the police or SJPU has not been recorded</h3>
                <p class="text-sm text-red-900">
                    Under section 19 of the POCSO Act 2012 this duty is independent of this platform, and a school
                    may not hold an internal inquiry in its place. This case cannot be closed here until an
                    external report is recorded below.
                </p>
            </div>
        @endif

        <div class="bg-white rounded-lg shadow p-6">
            <div class="flex flex-wrap items-start justify-between gap-3 mb-4">
                <div>
                    <div class="flex flex-wrap items-center gap-2">
                        <span class="text-sm font-medium text-gray-900">{{ $report->categoryLabel() }}</span>
                        @if ($report->immediate_danger)
                            <span class="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-800 font-medium">Immediate danger</span>
                        @endif
                    </div>
                    <div class="text-xs text-gray-400 mt-1">
                        {{ $report->school?->name }} &middot; reported {{ $report->created_at->format('j M Y, g:i a') }}
                        &middot; from a verified {{ $report->reporter_role }} (identity protected)
                    </div>
                </div>
                <span class="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">{{ $report->statusLabel() }}</span>
            </div>

            <div class="bg-gray-50 rounded p-4 text-sm text-gray-800 whitespace-pre-wrap">{{ $report->description }}</div>

            <div class="mt-4 text-xs text-gray-500 space-y-1">
                @if ($report->legal_duty_shown_at)
                    <div>Legal duty to report externally was shown to the reporter on
                        {{ $report->legal_duty_shown_at->format('j M Y, g:i a') }}.</div>
                @endif
                @if ($report->hasExternalReport())
                    <div class="text-gray-700">
                        External report acknowledged
                        {{ $report->external_report_acknowledged_at->format('j M Y') }} —
                        {{ $channels[$report->external_report_channel] ?? $report->external_report_channel }}
                        @if ($report->external_report_reference)
                            (reference {{ $report->external_report_reference }})
                        @endif.
                        <span class="text-gray-400">This is an officer's acknowledgement, not a verified police record.</span>
                    </div>
                @endif
            </div>
        </div>

        @if ($report->status !== 'closed')
            <div class="bg-white rounded-lg shadow p-6 space-y-5">
                <h3 class="font-semibold text-gray-900">Actions</h3>

                <div class="flex flex-wrap gap-2">
                    @unless ($report->acknowledged_at)
                        <button wire:click="acknowledge" class="px-4 py-2 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700">
                            Acknowledge receipt
                        </button>
                    @endunless
                    @if ($report->status !== 'under_investigation')
                        <button wire:click="startInvestigation" class="px-4 py-2 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50">
                            Mark under investigation
                        </button>
                    @endif
                </div>

                @unless ($report->hasExternalReport())
                    <form wire:submit="recordExternalReport" class="border-t pt-4 space-y-3">
                        <h4 class="text-sm font-medium text-gray-900">Record an external report</h4>
                        <p class="text-xs text-gray-500">
                            Record this once a report has actually been made to an outside authority. The platform
                            cannot verify it — this is your acknowledgement that it happened.
                        </p>
                        <div class="flex flex-wrap gap-3">
                            <div>
                                <label for="externalChannel" class="block text-xs text-gray-600 mb-1">Reported to</label>
                                <select wire:model="externalChannel" id="externalChannel" class="rounded border-gray-300 text-sm">
                                    <option value="">Choose…</option>
                                    @foreach ($channels as $key => $label)
                                        <option value="{{ $key }}">{{ $label }}</option>
                                    @endforeach
                                </select>
                                @error('externalChannel') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
                            </div>
                            <div class="flex-1 min-w-48">
                                <label for="externalReference" class="block text-xs text-gray-600 mb-1">
                                    Reference (FIR / DD number, optional)
                                </label>
                                <input type="text" wire:model="externalReference" id="externalReference" maxlength="100"
                                    class="w-full rounded border-gray-300 text-sm">
                            </div>
                        </div>
                        <button type="submit" class="px-4 py-2 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700">
                            Record external report
                        </button>
                    </form>
                @endunless

                <form wire:submit="addNote" class="border-t pt-4 space-y-2">
                    <label for="note" class="block text-sm font-medium text-gray-900">Add a note</label>
                    <textarea wire:model="note" id="note" rows="2" maxlength="2000" class="w-full rounded border-gray-300 text-sm"></textarea>
                    @error('note') <p class="text-xs text-red-600">{{ $message }}</p> @enderror
                    <button type="submit" class="px-4 py-2 text-sm rounded border border-gray-300 text-gray-700 hover:bg-gray-50">Add note</button>
                </form>

                <form wire:submit="close" class="border-t pt-4 space-y-2">
                    <label for="closureReason" class="block text-sm font-medium text-gray-900">Close this case</label>
                    <textarea wire:model="closureReason" id="closureReason" rows="2" maxlength="2000"
                        class="w-full rounded border-gray-300 text-sm" placeholder="Why is this case being closed?"></textarea>
                    @error('closureReason') <p class="text-xs text-red-600">{{ $message }}</p> @enderror
                    <button type="submit" class="px-4 py-2 text-sm rounded {{ $closureBlocked ? 'bg-gray-300 text-gray-600' : 'bg-gray-800 text-white hover:bg-gray-900' }}">
                        Close case
                    </button>
                </form>
            </div>
        @else
            <div class="bg-white rounded-lg shadow p-6">
                <h3 class="font-semibold text-gray-900 mb-1">Closed</h3>
                <p class="text-sm text-gray-600">{{ $report->closure_reason }}</p>
                <p class="text-xs text-gray-400 mt-1">{{ $report->closed_at?->format('j M Y') }}</p>
            </div>
        @endif

        <div class="bg-white rounded-lg shadow p-6">
            <h3 class="font-semibold text-gray-900 mb-1">Case record</h3>
            <p class="text-xs text-gray-500 mb-4">Append-only. Nothing here can be edited or removed.</p>
            <div class="space-y-3">
                @foreach ($events as $event)
                    <div class="text-sm border-l-2 border-gray-200 pl-3">
                        <div class="text-gray-800">{{ str_replace('_', ' ', ucfirst($event->event_type)) }}</div>
                        @if ($event->detail)
                            <div class="text-gray-600">{{ $event->detail }}</div>
                        @endif
                        <div class="text-xs text-gray-400">
                            {{ $event->occurred_at->format('j M Y, g:i a') }}
                            @if ($event->actor) &middot; {{ $event->actor->name }} ({{ $event->actor_role }}) @endif
                        </div>
                    </div>
                @endforeach
            </div>
        </div>
    </div>
</div>
