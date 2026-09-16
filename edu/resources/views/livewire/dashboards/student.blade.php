<?php

use App\Models\AnonymousIdentity;
use App\Models\StudentSchoolRelationship;
use Illuminate\Support\Facades\Auth;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

new #[Layout('layouts.app')] class extends Component
{
    public function with(): array
    {
        $user = Auth::user();

        $myRefs = AnonymousIdentity::where('user_id', $user->id)->pluck('anonymous_ref');

        $myComplaints = \App\Models\Complaint::whereIn('anonymous_ref', $myRefs)
            ->with('school:id,name')->latest()->get();

        $mySchools = StudentSchoolRelationship::where('user_id', $user->id)
            ->with('school:id,name,city')->get();

        return compact('myComplaints', 'mySchools');
    }
}; ?>

<div>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">My Dashboard</h2>
    </x-slot>

    <div class="py-8 max-w-5xl mx-auto sm:px-6 lg:px-8 space-y-6">
        <div class="bg-white rounded-lg shadow p-6">
            <div class="flex justify-between items-center mb-4">
                <h3 class="font-semibold text-gray-900">My School</h3>
                <a href="{{ route('schools.index') }}" wire:navigate class="text-sm text-indigo-600 hover:underline">Find School</a>
            </div>
            @forelse ($mySchools as $rel)
                <div class="flex justify-between py-2 border-b last:border-0 text-sm">
                    <a href="{{ route('schools.show', $rel->school_id) }}" wire:navigate class="text-indigo-600 hover:underline">{{ $rel->school->name }}</a>
                    <span class="text-gray-400">{{ ucfirst($rel->status) }}</span>
                </div>
            @empty
                <p class="text-sm text-gray-400">No linked school yet. Use "Find School" to link one.</p>
            @endforelse
        </div>

        <div class="bg-white rounded-lg shadow p-6">
            <h3 class="font-semibold text-gray-900 mb-2">My Growth</h3>
            <p class="text-sm text-gray-600 mb-3">
                What you're doing well, what you're working on, and what you're interested in.
                This is yours — it isn't a grade, and nobody is ranked by it.
            </p>
            <div class="flex flex-wrap gap-3">
                <a href="{{ route('growth.show', Auth::id()) }}" wire:navigate
                    class="inline-flex items-center px-4 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700">My Growth</a>
                <a href="{{ route('career.show', Auth::id()) }}" wire:navigate
                    class="inline-flex items-center px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded-md hover:bg-gray-50">My Interests</a>
            </div>
        </div>

        <div class="bg-white rounded-lg shadow p-6">
            <div class="flex justify-between items-center mb-4">
                <h3 class="font-semibold text-gray-900">Report a Problem</h3>
            </div>
            <p class="text-sm text-gray-600 mb-3">
                If something isn't right at school — teaching, safety, bullying, anything — you can report it
                privately. The school never sees your name, only that a verified student reported it.
            </p>
            <div class="flex flex-wrap gap-3">
                <a href="{{ route('complaints.create') }}" wire:navigate class="inline-flex items-center px-4 py-2 bg-red-600 text-white text-sm rounded-md hover:bg-red-700">Report a Problem</a>
                <a href="{{ route('retaliation.create') }}" wire:navigate class="inline-flex items-center px-4 py-2 bg-gray-800 text-white text-sm rounded-md hover:bg-gray-700">Report Retaliation</a>
            </div>
        </div>

        <div class="bg-white rounded-lg shadow p-6">
            <h3 class="font-semibold text-gray-900 mb-4">My Reports</h3>
            @forelse ($myComplaints as $complaint)
                <a href="{{ route('complaints.show', $complaint) }}" wire:navigate class="flex justify-between py-2 border-b last:border-0 text-sm hover:bg-gray-50 -mx-2 px-2 rounded">
                    <span>{{ $complaint->complaint_number }} — {{ $complaint->subject }}</span>
                    <span class="text-gray-400">{{ str_replace('_', ' ', $complaint->status) }}</span>
                </a>
            @empty
                <p class="text-sm text-gray-400">You haven't submitted any reports.</p>
            @endforelse
        </div>
    </div>
</div>
