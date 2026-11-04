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

    /** The bkesari.com/edu front page shows the welcome above the search. */
    public bool $isHome = false;

    public function mount(): void
    {
        $this->isHome = request()->routeIs('home');
    }

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
            // whereLike() is case-insensitive on every driver (ILIKE on
            // PostgreSQL), matching the search behaviour users expect.
            $query->where(function ($q) {
                $q->whereLike('name', "%{$this->search}%")
                    ->orWhereLike('city', "%{$this->search}%")
                    ->orWhereLike('pincode', "%{$this->search}%");
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
    @if ($isHome)
        <section class="edu-hero" aria-labelledby="edu-hero-title">
            <p class="k-chip k-chip--accent">{{ __('Education') }}</p>
            <h1 id="edu-hero-title" class="mt-3">{{ __('Know your school. Be heard, safely.') }}</h1>
            <p class="k-lead">{{ __('Search verified schools, see what families actually experience, and raise a concern without your name ever reaching the school.') }}</p>
            <div class="k-row mt-4">
                @auth
                    <a href="{{ route('dashboard') }}" wire:navigate class="k-btn">{{ __('Go to your dashboard') }}</a>
                @else
                    <a href="{{ route('sign-up') }}" wire:navigate class="k-btn">{{ __('Create a free account') }}</a>
                    <a href="{{ route('sign-in') }}" wire:navigate class="k-btn k-btn--secondary">{{ __('Sign in') }}</a>
                @endauth
                <a href="#school-search" class="k-btn k-btn--ghost">{{ __('Find a school') }}</a>
            </div>

            <ul class="grid gap-4 md:grid-cols-3 mt-6 list-none p-0" role="list">
                <li class="k-card">
                    <h3>{{ __('Compare schools honestly') }}</h3>
                    <p class="k-muted mb-0">{{ __('Fees year by year, the facilities a school claims next to what families report, and how it has changed over time.') }}</p>
                </li>
                <li class="k-card">
                    <h3>{{ __('Raise a concern safely') }}</h3>
                    <p class="k-muted mb-0">{{ __('Complaints are faceless: the school sees that a verified parent or student raised it, never who. Follow it until it is actually resolved.') }}</p>
                </li>
                <li class="k-card">
                    <h3>{{ __('Follow your child’s growth') }}</h3>
                    <p class="k-muted mb-0">{{ __('With your consent, teachers and family keep a shared record of what is going well and what comes next. No ranks, no labels.') }}</p>
                </li>
            </ul>
        </section>
    @endif

    <section id="school-search" aria-labelledby="school-search-title" class="{{ $isHome ? 'mt-10' : '' }}">
        @if ($isHome)
            <h2 id="school-search-title" class="text-2xl font-bold text-gray-900">{{ __('School Search') }}</h2>
        @else
            <h1 id="school-search-title" class="text-2xl font-bold text-gray-900">{{ __('School Search') }}</h1>
        @endif

        <div class="k-banner mt-4 flex-wrap items-center justify-between">
            <p>{{ __('Don’t see your school? Register it and get verified by a District Officer.') }}</p>
            <a href="{{ route('schools.register') }}" wire:navigate class="k-btn k-btn--secondary shrink-0">{{ __('Register a School') }}</a>
        </div>

        <div class="k-card mb-6 grid grid-cols-1 md:grid-cols-4 gap-x-4">
            <div class="k-field">
                <x-input-label for="search" :value="__('Name, city or PIN')" />
                <x-text-input wire:model.live.debounce.400ms="search" id="search" type="search" :placeholder="__('Search schools...')" />
            </div>
            <div class="k-field">
                <x-input-label for="stateId" :value="__('State')" />
                <select wire:model.live="stateId" id="stateId" class="k-select">
                    <option value="">{{ __('All states') }}</option>
                    @foreach ($states as $state)
                        <option value="{{ $state->id }}">{{ $state->name }}</option>
                    @endforeach
                </select>
            </div>
            <div class="k-field">
                <x-input-label for="districtId" :value="__('District')" />
                <select wire:model.live="districtId" id="districtId" class="k-select">
                    <option value="">{{ __('All districts') }}</option>
                    @foreach ($districts as $district)
                        <option value="{{ $district->id }}">{{ $district->name }}</option>
                    @endforeach
                </select>
            </div>
            <div class="k-field">
                <x-input-label for="board" :value="__('Board')" />
                <select wire:model.live="board" id="board" class="k-select">
                    <option value="">{{ __('All boards') }}</option>
                    @foreach (['CBSE', 'ICSE', 'STATE', 'IB', 'OTHER'] as $b)
                        <option value="{{ $b }}">{{ $b }}</option>
                    @endforeach
                </select>
            </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" wire:loading.class="opacity-60" wire:target="search,stateId,districtId,board">
            @forelse ($schools as $school)
                <a href="{{ route('schools.show', $school) }}" wire:navigate class="k-card k-card--link">
                    <div class="flex justify-between items-start gap-3">
                        <h3 class="font-semibold text-lg text-gray-900">{{ $school->name }}</h3>
                        <span class="k-chip k-chip--accent k-chip--plain shrink-0">{{ $school->board }}</span>
                    </div>
                    <p class="text-sm text-gray-600 mt-1 mb-0">{{ $school->city }}, {{ $school->district->name }}, {{ $school->state->name }}</p>
                    <div class="mt-4 flex items-center justify-between">
                        @if ($school->latestQualityScore)
                            <span class="text-sm font-semibold text-gray-800">
                                {{ __('SQI') }}: {{ $school->latestQualityScore->score }}
                                <span class="text-xs font-normal text-gray-600">({{ __(':level confidence', ['level' => str_replace('_', ' ', $school->latestQualityScore->confidence)]) }})</span>
                            </span>
                        @else
                            <span class="text-sm text-gray-600">{{ __('No rating data yet') }}</span>
                        @endif
                    </div>
                </a>
            @empty
                <div class="k-empty col-span-full">
                    <h3>{{ __('No schools match your search.') }}</h3>
                    <p>{{ __('Try fewer words, another district, or register the school if it is missing.') }}</p>
                </div>
            @endforelse
        </div>

        <div class="mt-6">{{ $schools->links() }}</div>
    </section>
</div>
