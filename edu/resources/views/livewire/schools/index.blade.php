<?php

use App\Models\District;
use App\Models\School;
use App\Models\State;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;
use Livewire\WithPagination;

new #[Layout('layouts.app')] class extends Component
{
    use WithPagination;

    public string $search = '';
    public string $stateId = '';
    public string $districtId = '';
    public string $board = '';

    public function updating($property): void
    {
        if (in_array($property, ['search', 'stateId', 'districtId', 'board'], true)) {
            $this->resetPage();
        }
    }

    public function with(): array
    {
        $query = School::query()->with(['state', 'district', 'latestQualityScore'])
            ->where('recognition_status', 'verified');

        if ($this->search !== '') {
            $query->where(function ($q) {
                $q->where('name', 'like', "%{$this->search}%")
                    ->orWhere('city', 'like', "%{$this->search}%")
                    ->orWhere('pincode', 'like', "%{$this->search}%");
            });
        }

        if ($this->stateId !== '') {
            $query->where('state_id', $this->stateId);
        }

        if ($this->districtId !== '') {
            $query->where('district_id', $this->districtId);
        }

        if ($this->board !== '') {
            $query->where('board', $this->board);
        }

        return [
            'schools' => $query->orderBy('name')->paginate(12),
            'states' => State::orderBy('name')->get(),
            'districts' => $this->stateId !== ''
                ? District::where('state_id', $this->stateId)->orderBy('name')->get()
                : collect(),
        ];
    }
}; ?>

<div>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">School Search</h2>
    </x-slot>

    <div class="py-8 max-w-7xl mx-auto sm:px-6 lg:px-8">
        <div class="bg-indigo-50 border border-indigo-100 rounded-lg p-4 mb-6 flex flex-wrap items-center justify-between gap-3">
            <p class="text-sm text-indigo-900">Don't see your school? Register it and get verified by a District Officer.</p>
            <a href="{{ route('schools.register') }}" wire:navigate class="inline-flex items-center px-4 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700 shrink-0">Register a School</a>
        </div>

        <div class="bg-white p-6 rounded-lg shadow mb-6 grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
                <x-input-label for="search" value="Name, city or PIN" />
                <x-text-input wire:model.live.debounce.400ms="search" id="search" class="mt-1 w-full" placeholder="Search schools..." />
            </div>
            <div>
                <x-input-label for="stateId" value="State" />
                <select wire:model.live="stateId" id="stateId" class="border-gray-300 focus:border-indigo-500 focus:ring-indigo-500 rounded-md shadow-sm mt-1 w-full">
                    <option value="">All states</option>
                    @foreach ($states as $state)
                        <option value="{{ $state->id }}">{{ $state->name }}</option>
                    @endforeach
                </select>
            </div>
            <div>
                <x-input-label for="districtId" value="District" />
                <select wire:model.live="districtId" id="districtId" class="border-gray-300 focus:border-indigo-500 focus:ring-indigo-500 rounded-md shadow-sm mt-1 w-full">
                    <option value="">All districts</option>
                    @foreach ($districts as $district)
                        <option value="{{ $district->id }}">{{ $district->name }}</option>
                    @endforeach
                </select>
            </div>
            <div>
                <x-input-label for="board" value="Board" />
                <select wire:model.live="board" id="board" class="border-gray-300 focus:border-indigo-500 focus:ring-indigo-500 rounded-md shadow-sm mt-1 w-full">
                    <option value="">All boards</option>
                    @foreach (['CBSE', 'ICSE', 'STATE', 'IB', 'OTHER'] as $b)
                        <option value="{{ $b }}">{{ $b }}</option>
                    @endforeach
                </select>
            </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            @forelse ($schools as $school)
                <a href="{{ route('schools.show', $school) }}" wire:navigate class="block bg-white rounded-lg shadow hover:shadow-md transition p-6">
                    <div class="flex justify-between items-start">
                        <h3 class="font-semibold text-lg text-gray-900">{{ $school->name }}</h3>
                        <span class="text-xs font-medium px-2 py-1 rounded bg-indigo-50 text-indigo-700">{{ $school->board }}</span>
                    </div>
                    <p class="text-sm text-gray-500 mt-1">{{ $school->city }}, {{ $school->district->name }}, {{ $school->state->name }}</p>
                    <div class="mt-4 flex items-center justify-between">
                        @if ($school->latestQualityScore)
                            <span class="text-sm font-medium text-gray-700">
                                SQI: {{ $school->latestQualityScore->score }}
                                <span class="text-xs text-gray-400">({{ str_replace('_', ' ', $school->latestQualityScore->confidence) }} confidence)</span>
                            </span>
                        @else
                            <span class="text-sm text-gray-400">No rating data yet</span>
                        @endif
                    </div>
                </a>
            @empty
                <p class="text-gray-500 col-span-3">No schools match your search.</p>
            @endforelse
        </div>

        <div class="mt-6">{{ $schools->links() }}</div>
    </div>
</div>
