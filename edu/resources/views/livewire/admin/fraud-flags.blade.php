<?php

use App\Models\AuditLog;
use App\Models\FraudFlag;
use Illuminate\Support\Facades\Auth;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;
use Livewire\WithPagination;

new #[Layout('layouts.app')] class extends Component
{
    use WithPagination;

    public string $statusFilter = 'open';

    public function updatedStatusFilter(): void
    {
        $this->resetPage();
    }

    public function setStatus(int $id, string $status): void
    {
        abort_unless(in_array($status, ['open', 'reviewing', 'dismissed', 'confirmed'], true), 422);

        $flag = FraudFlag::findOrFail($id);
        $flag->update([
            'status' => $status,
            'reviewed_by_user_id' => Auth::id(),
            'reviewed_at' => now(),
        ]);

        AuditLog::record('fraud-flag-reviewed', Auth::id(), $flag, ['status' => $status]);
    }

    public function with(): array
    {
        $query = FraudFlag::query()->latest();

        if ($this->statusFilter !== 'all') {
            $query->where('status', $this->statusFilter);
        }

        return ['flags' => $query->paginate(20)];
    }
}; ?>

<div>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">Fraud & Anti-Manipulation Flags</h2>
    </x-slot>

    <div class="py-8 max-w-5xl mx-auto sm:px-6 lg:px-8 space-y-6">
        <p class="text-sm text-gray-500">
            Rule-based signals only (spec section AE) — a flag is a prompt for human review, never an automatic
            penalty against a school or teacher.
        </p>

        <div class="flex gap-2">
            @foreach (['open' => 'Open', 'reviewing' => 'Reviewing', 'confirmed' => 'Confirmed', 'dismissed' => 'Dismissed', 'all' => 'All'] as $value => $label)
                <button wire:click="$set('statusFilter', '{{ $value }}')"
                    class="text-xs px-3 py-1.5 rounded-full {{ $statusFilter === $value ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600' }}">
                    {{ $label }}
                </button>
            @endforeach
        </div>

        <div class="bg-white rounded-lg shadow divide-y divide-gray-100">
            @forelse ($flags as $flag)
                <div class="p-4">
                    <div class="flex justify-between items-start">
                        <div>
                            <p class="text-sm font-medium text-gray-900">
                                {{ str_replace('_', ' ', $flag->flag_type) }} —
                                {{ ucfirst($flag->subject_type) }} #{{ $flag->subject_id }}
                                @if ($subject = $flag->subject())
                                    ({{ $subject->name }})
                                @endif
                            </p>
                            <p class="text-xs text-gray-400 mt-1">{{ $flag->created_at->diffForHumans() }}</p>
                            @if ($flag->details)
                                <p class="text-xs text-gray-500 mt-1">{{ json_encode($flag->details) }}</p>
                            @endif
                        </div>
                        <span @class([
                            'text-xs font-medium px-2 py-1 rounded whitespace-nowrap',
                            'bg-yellow-50 text-yellow-700' => $flag->status === 'open',
                            'bg-blue-50 text-blue-700' => $flag->status === 'reviewing',
                            'bg-red-50 text-red-700' => $flag->status === 'confirmed',
                            'bg-gray-100 text-gray-500' => $flag->status === 'dismissed',
                        ])>{{ $flag->status }}</span>
                    </div>

                    @if (in_array($flag->status, ['open', 'reviewing'], true))
                        <div class="flex gap-2 mt-3">
                            @if ($flag->status === 'open')
                                <x-secondary-button wire:click="setStatus({{ $flag->id }}, 'reviewing')">Start Review</x-secondary-button>
                            @endif
                            <x-secondary-button wire:click="setStatus({{ $flag->id }}, 'confirmed')">Confirm</x-secondary-button>
                            <x-secondary-button wire:click="setStatus({{ $flag->id }}, 'dismissed')">Dismiss</x-secondary-button>
                        </div>
                    @endif
                </div>
            @empty
                <p class="p-6 text-center text-gray-400 text-sm">No flags for this filter.</p>
            @endforelse
        </div>

        <div>{{ $flags->links() }}</div>
    </div>
</div>
