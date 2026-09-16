<?php

use App\Models\AuditLog;
use App\Models\IdentityAccessLog;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;
use Livewire\WithPagination;

new #[Layout('layouts.app')] class extends Component
{
    use WithPagination;

    public string $tab = 'audit';

    public function with(): array
    {
        return [
            'auditLogs' => $this->tab === 'audit'
                ? AuditLog::with('user:id,name')->latest('created_at')->paginate(25)
                : null,
            'identityLogs' => $this->tab === 'identity'
                ? IdentityAccessLog::with('officer:id,name')->latest('created_at')->paginate(25)
                : null,
        ];
    }
}; ?>

<div>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">Audit Log</h2>
    </x-slot>

    <div class="py-8 max-w-5xl mx-auto sm:px-6 lg:px-8 space-y-6">
        <div class="flex gap-2">
            <button wire:click="$set('tab', 'audit')" class="px-3 py-1.5 text-sm rounded-md {{ $tab === 'audit' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700' }}">General Actions</button>
            <button wire:click="$set('tab', 'identity')" class="px-3 py-1.5 text-sm rounded-md {{ $tab === 'identity' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700' }}">Identity Access</button>
        </div>

        @if ($tab === 'audit')
            <div class="bg-white rounded-lg shadow p-6">
                <table class="w-full text-sm">
                    <thead>
                        <tr class="text-left text-gray-500 border-b">
                            <th class="py-2">Time</th>
                            <th>User</th>
                            <th>Action</th>
                            <th>Subject</th>
                        </tr>
                    </thead>
                    <tbody>
                        @foreach ($auditLogs as $log)
                            <tr class="border-b last:border-0">
                                <td class="py-2 text-gray-500">{{ $log->created_at->diffForHumans() }}</td>
                                <td>{{ $log->user->name ?? 'System' }}</td>
                                <td>{{ $log->action }}</td>
                                <td class="text-gray-500">{{ $log->auditable_type ? class_basename($log->auditable_type).' #'.$log->auditable_id : '—' }}</td>
                            </tr>
                        @endforeach
                    </tbody>
                </table>
                <div class="mt-4">{{ $auditLogs->links() }}</div>
            </div>
        @else
            <div class="bg-white rounded-lg shadow p-6">
                <p class="text-xs text-gray-500 mb-3">Every reversal of an anonymized reference back to a real identity — officer, time, record, reason, action (spec section I).</p>
                <table class="w-full text-sm">
                    <thead>
                        <tr class="text-left text-gray-500 border-b">
                            <th class="py-2">Time</th>
                            <th>Officer</th>
                            <th>Action</th>
                            <th>Reference</th>
                            <th>Reason</th>
                        </tr>
                    </thead>
                    <tbody>
                        @foreach ($identityLogs as $log)
                            <tr class="border-b last:border-0">
                                <td class="py-2 text-gray-500">{{ $log->created_at->diffForHumans() }}</td>
                                <td>{{ $log->officer->name ?? '—' }}</td>
                                <td>{{ $log->action }}</td>
                                <td class="text-gray-500 font-mono text-xs">{{ $log->anonymous_ref }}</td>
                                <td class="text-gray-500">{{ $log->reason ?? '—' }}</td>
                            </tr>
                        @endforeach
                    </tbody>
                </table>
                <div class="mt-4">{{ $identityLogs->links() }}</div>
            </div>
        @endif
    </div>
</div>
