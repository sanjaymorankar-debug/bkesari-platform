<?php

use Illuminate\Support\Facades\Auth;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;
use Livewire\WithPagination;

new #[Layout('layouts.app')] class extends Component
{
    use WithPagination;

    public function markRead(string $id): void
    {
        Auth::user()->notifications()->where('id', $id)->update(['read_at' => now()]);
    }

    public function markAllRead(): void
    {
        Auth::user()->unreadNotifications()->update(['read_at' => now()]);
    }

    public function with(): array
    {
        return [
            'notifications' => Auth::user()->notifications()->paginate(20),
            'unreadCount' => Auth::user()->unreadNotifications()->count(),
        ];
    }
}; ?>

<div>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">Notifications</h2>
    </x-slot>

    <div class="py-8 max-w-3xl mx-auto sm:px-6 lg:px-8 space-y-4">
        @if ($unreadCount > 0)
            <div class="flex justify-end">
                <x-secondary-button wire:click="markAllRead">Mark all as read ({{ $unreadCount }})</x-secondary-button>
            </div>
        @endif

        <div class="bg-white rounded-lg shadow divide-y divide-gray-100">
            @forelse ($notifications as $notification)
                <div class="p-4 flex justify-between items-start gap-4 {{ $notification->read_at ? '' : 'bg-indigo-50/50' }}">
                    <div>
                        <p class="text-sm text-gray-800">{{ $notification->data['message'] ?? 'Notification' }}</p>
                        <p class="text-xs text-gray-400 mt-1">{{ $notification->created_at->diffForHumans() }}</p>
                    </div>
                    @unless ($notification->read_at)
                        <button wire:click="markRead('{{ $notification->id }}')" class="text-xs text-indigo-600 hover:underline whitespace-nowrap">Mark read</button>
                    @endunless
                </div>
            @empty
                <p class="p-6 text-center text-gray-400 text-sm">No notifications yet.</p>
            @endforelse
        </div>

        <div>{{ $notifications->links() }}</div>
    </div>
</div>
