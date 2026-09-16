<?php

use App\Models\AuditLog;
use App\Models\Setting;
use Illuminate\Support\Facades\Auth;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

new #[Layout('layouts.app')] class extends Component
{
    public int $windowMinutes;
    public int $threshold;

    public function mount(): void
    {
        $this->windowMinutes = (int) Setting::get('fraud.window_minutes', 10);
        $this->threshold = (int) Setting::get('fraud.threshold', 5);
    }

    /**
     * Configures the coordinated-review heuristic (AIAssistService::detectFeedbackSpike)
     * used against school and teacher feedback (spec section AE). Takes effect on the
     * next submission — there's no backfill/rescan of already-submitted feedback.
     */
    public function save(): void
    {
        $this->validate([
            'windowMinutes' => ['required', 'integer', 'min:1', 'max:1440'],
            'threshold' => ['required', 'integer', 'min:2', 'max:1000'],
        ]);

        Setting::set('fraud.window_minutes', $this->windowMinutes);
        Setting::set('fraud.threshold', $this->threshold);

        AuditLog::record('moderation-thresholds-updated', Auth::id(), metadata: [
            'window_minutes' => $this->windowMinutes,
            'threshold' => $this->threshold,
        ]);
    }
}; ?>

<div>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">Moderation Settings</h2>
    </x-slot>

    <div class="py-8 max-w-xl mx-auto sm:px-6 lg:px-8">
        <div class="bg-white rounded-lg shadow p-6">
            <h3 class="font-semibold text-gray-900 mb-1">Coordinated-Review Detection</h3>
            <p class="text-sm text-gray-500 mb-6">
                A school or teacher is flagged for review when this many feedback submissions land within the
                configured window — a heuristic, not proof of manipulation (spec section AE).
            </p>

            <form wire:submit="save" class="space-y-4">
                <div>
                    <x-input-label for="windowMinutes" value="Window (minutes)" />
                    <x-text-input wire:model="windowMinutes" id="windowMinutes" type="number" class="mt-1 w-full" />
                    <x-input-error :messages="$errors->get('windowMinutes')" class="mt-2" />
                </div>
                <div>
                    <x-input-label for="threshold" value="Submission threshold" />
                    <x-text-input wire:model="threshold" id="threshold" type="number" class="mt-1 w-full" />
                    <x-input-error :messages="$errors->get('threshold')" class="mt-2" />
                </div>
                <x-primary-button>Save</x-primary-button>
            </form>
        </div>
    </div>
</div>
