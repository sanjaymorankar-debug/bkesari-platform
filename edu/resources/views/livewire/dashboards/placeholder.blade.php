<?php

use Illuminate\Support\Facades\Auth;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

new #[Layout('layouts.app')] class extends Component
{
    public function with(): array
    {
        return ['role' => Auth::user()->getRoleNames()->first() ?? 'user'];
    }
}; ?>

<div>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">Dashboard</h2>
    </x-slot>

    <div class="py-8 max-w-3xl mx-auto sm:px-6 lg:px-8">
        <div class="bg-white rounded-lg shadow p-6">
            <p class="text-gray-700">You're signed in as <strong>{{ str_replace('_', ' ', $role) }}</strong>.</p>
            <p class="text-sm text-gray-500 mt-2">
                A full dashboard for this role is planned but not yet built in this phase — see <code>ROADMAP.md</code>.
                Role, permissions and login all work correctly; only the dashboard UI is pending.
            </p>
        </div>
    </div>
</div>
