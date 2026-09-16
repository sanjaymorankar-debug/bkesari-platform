<?php

use App\Models\Complaint;
use App\Models\IdentityAccessLog;
use App\Models\School;
use App\Models\User;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

new #[Layout('layouts.app')] class extends Component
{
    public function with(): array
    {
        return [
            'stats' => [
                'users' => User::count(),
                'schools' => School::count(),
                'complaints' => Complaint::count(),
                'identity_accesses' => IdentityAccessLog::count(),
            ],
        ];
    }
}; ?>

<div>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">System Admin</h2>
    </x-slot>

    <div class="py-8 max-w-5xl mx-auto sm:px-6 lg:px-8 space-y-6">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div class="bg-white rounded-lg shadow p-4"><div class="text-2xl font-bold text-gray-900">{{ $stats['users'] }}</div><div class="text-xs text-gray-500">Users</div></div>
            <div class="bg-white rounded-lg shadow p-4"><div class="text-2xl font-bold text-gray-900">{{ $stats['schools'] }}</div><div class="text-xs text-gray-500">Schools</div></div>
            <div class="bg-white rounded-lg shadow p-4"><div class="text-2xl font-bold text-gray-900">{{ $stats['complaints'] }}</div><div class="text-xs text-gray-500">Complaints</div></div>
            <div class="bg-white rounded-lg shadow p-4"><div class="text-2xl font-bold text-gray-900">{{ $stats['identity_accesses'] }}</div><div class="text-xs text-gray-500">Identity Accesses Logged</div></div>
        </div>

        <div class="bg-white rounded-lg shadow p-6">
            <h3 class="font-semibold text-gray-900 mb-4">Admin Panel</h3>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <a href="{{ route('admin.rating-weights') }}" wire:navigate class="block border rounded-lg p-4 hover:bg-gray-50">
                    <div class="font-medium text-gray-900">School Rating Weights</div>
                    <div class="text-xs text-gray-500 mt-1">Configure School Quality Index dimension weights</div>
                </a>
                <a href="{{ route('admin.categories') }}" wire:navigate class="block border rounded-lg p-4 hover:bg-gray-50">
                    <div class="font-medium text-gray-900">Complaint Categories</div>
                    <div class="text-xs text-gray-500 mt-1">Add, rename, or retire complaint categories</div>
                </a>
                <a href="{{ route('admin.audit-log') }}" wire:navigate class="block border rounded-lg p-4 hover:bg-gray-50">
                    <div class="font-medium text-gray-900">Audit Log</div>
                    <div class="text-xs text-gray-500 mt-1">Review system actions and identity-access log</div>
                </a>
                <a href="{{ route('admin.fraud-flags') }}" wire:navigate class="block border rounded-lg p-4 hover:bg-gray-50">
                    <div class="font-medium text-gray-900">Fraud Flags</div>
                    <div class="text-xs text-gray-500 mt-1">Review coordinated-review / spike signals</div>
                </a>
                <a href="{{ route('admin.roles') }}" wire:navigate class="block border rounded-lg p-4 hover:bg-gray-50">
                    <div class="font-medium text-gray-900">Roles & Permissions</div>
                    <div class="text-xs text-gray-500 mt-1">Manage role permissions and user role assignments</div>
                </a>
                <a href="{{ route('admin.moderation') }}" wire:navigate class="block border rounded-lg p-4 hover:bg-gray-50">
                    <div class="font-medium text-gray-900">Moderation Settings</div>
                    <div class="text-xs text-gray-500 mt-1">Configure coordinated-review detection thresholds</div>
                </a>
            </div>
        </div>
    </div>
</div>
