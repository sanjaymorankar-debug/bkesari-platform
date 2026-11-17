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

    /** The empty state's one action: start the search again. */
    public function clearFilters(): void
    {
        $this->reset('search', 'stateId', 'districtId', 'board');
        $this->resetPage();
    }

    public function updatedStateId(): void
    {
        // A district from the previous state would match nothing.
        $this->districtId = '';
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
    @php
        $filtered = $search !== '' || $stateId !== '' || $districtId !== '' || $board !== '';
        // On the landing the search sits under an h2, on /schools it is the page's h1.
        $cardHeading = $isHome ? 'h3' : 'h2';
    @endphp
    @if ($isHome)
        {{-- Landing: what Education is, in one screen, then straight into the search. --}}
        <section class="k-hero edu-landing-hero" aria-labelledby="edu-hero-title">
            <div>
                <p class="k-eyebrow"><x-k-icon name="education" /> {{ __('Education') }}</p>
                <h1 id="edu-hero-title">{{ __('Know your school. Be heard, safely.') }}</h1>
                <p class="k-hero__lead">{{ __('Search verified schools, see what families actually experience, and raise a concern without your name ever reaching the school.') }}</p>
                <div class="k-hero__actions">
                    @auth
                        <a href="{{ route('dashboard') }}" wire:navigate class="k-btn">{{ __('Go to your dashboard') }}</a>
                        <a href="#school-search" class="k-link-arrow">{{ __('Find a school') }} <x-k-icon name="arrow-right" /></a>
                    @else
                        <a href="#school-search" class="k-btn"><x-k-icon name="search" /> {{ __('Find a school') }}</a>
                        <a href="{{ route('sign-up') }}" wire:navigate class="k-btn k-btn--secondary">{{ __('Create a free account') }}</a>
                    @endauth
                </div>
            </div>

            {{-- A picture of the promise: a school's public record, with the
                 fees and facilities families can check, and a faceless report
                 beside it. Decorative; the text says all of it. --}}
            <div class="k-hero__art hidden lg:block" aria-hidden="true">
                <svg class="edu-art" viewBox="0 0 440 360" focusable="false">
                    <circle cx="250" cy="180" r="160" class="edu-art__blob" />
                    <rect x="300" y="28" width="118" height="40" rx="20" class="edu-art__card" />
                    <circle cx="324" cy="47" r="8" class="edu-art__stroke" />
                    <path d="M330 53l7 7" class="edu-art__stroke" />
                    <rect x="344" y="42" width="58" height="10" rx="5" class="edu-art__line" />
                    <rect x="90" y="84" width="290" height="226" rx="22" class="edu-art__card" />
                    <rect x="114" y="108" width="56" height="56" rx="16" class="edu-art__tile" />
                    <path d="M124 130l18-12 18 12M128 130v20h28v-20M138 150v-10h8v10" class="edu-art__stroke" />
                    <rect x="186" y="114" width="132" height="12" rx="6" class="edu-art__ink" />
                    <rect x="186" y="136" width="88" height="10" rx="5" class="edu-art__line" />
                    <circle cx="352" cy="120" r="14" class="edu-art__ok" />
                    <path d="M345 120l5 5 9-10" class="edu-art__tick" />
                    <rect x="114" y="186" width="72" height="8" rx="4" class="edu-art__line" />
                    <rect x="114" y="200" width="242" height="12" rx="6" class="edu-art__track" />
                    <rect x="114" y="200" width="176" height="12" rx="6" class="edu-art__fill" />
                    <rect x="114" y="226" width="96" height="8" rx="4" class="edu-art__line" />
                    <rect x="114" y="240" width="242" height="12" rx="6" class="edu-art__track" />
                    <rect x="114" y="240" width="118" height="12" rx="6" class="edu-art__fill" />
                    <rect x="114" y="266" width="60" height="8" rx="4" class="edu-art__line" />
                    <rect x="114" y="280" width="242" height="12" rx="6" class="edu-art__track" />
                    <rect x="114" y="280" width="208" height="12" rx="6" class="edu-art__fill" />
                    <rect x="28" y="250" width="176" height="78" rx="18" class="edu-art__card" />
                    <rect x="44" y="268" width="42" height="42" rx="12" class="edu-art__tile" />
                    <path d="M65 278l-11 4.5v7.5c0 7 4.6 11 11 13 6.4-2 11-6 11-13v-7.5z" class="edu-art__stroke" />
                    <rect x="98" y="276" width="88" height="10" rx="5" class="edu-art__ink" />
                    <rect x="98" y="294" width="62" height="8" rx="4" class="edu-art__line" />
                </svg>
            </div>
        </section>

        <ul class="k-features" role="list">
            <li class="k-feature">
                <span class="k-picon"><x-k-icon name="school" /></span>
                <h2 class="edu-feature-title">{{ __('Compare schools honestly') }}</h2>
                <p>{{ __('Fees year by year, the facilities a school claims next to what families report, and how it has changed over time.') }}</p>
            </li>
            <li class="k-feature">
                <span class="k-picon"><x-k-icon name="shield" /></span>
                <h2 class="edu-feature-title">{{ __('Raise a concern safely') }}</h2>
                <p>{{ __('Complaints are faceless: the school sees that a verified parent or student raised it, never who. Follow it until it is actually resolved.') }}</p>
            </li>
            <li class="k-feature">
                <span class="k-picon"><x-k-icon name="sprout" /></span>
                <h2 class="edu-feature-title">{{ __('Follow your child’s growth') }}</h2>
                <p>{{ __('With your consent, teachers and family keep a shared record of what is going well and what comes next. No ranks, no labels.') }}</p>
            </li>
        </ul>
    @else
        <nav class="k-breadcrumbs" aria-label="{{ __('Breadcrumb') }}">
            <ol>
                <li><a href="{{ route('home') }}" wire:navigate>{{ __('Education') }}</a></li>
                <li><span aria-current="page">{{ __('Schools') }}</span></li>
            </ol>
        </nav>
    @endif

    <section id="school-search" aria-labelledby="school-search-title" class="edu-search {{ $isHome ? 'k-section' : '' }}">
        <div class="k-section-head">
            @if ($isHome)
                <h2 id="school-search-title">{{ __('School Search') }}</h2>
            @else
                <h1 id="school-search-title">{{ __('School Search') }}</h1>
            @endif
            <p>{{ __('Only schools verified by a District or State Officer are listed. Search by name, city or PIN code, or narrow it down by state, district and board.') }}</p>
        </div>

        <form class="k-card edu-filters" role="search" aria-label="{{ __('Search schools') }}" x-data x-on:submit.prevent>
            <div class="k-field edu-filters__query">
                <x-input-label for="search" :value="__('Name, city or PIN')" />
                <div class="k-search">
                    <x-text-input wire:model.live.debounce.400ms="search" id="search" type="search" autocomplete="off" :placeholder="__('Search schools...')" />
                </div>
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
                <select wire:model.live="districtId" id="districtId" class="k-select" @disabled($stateId === '') aria-describedby="districtId-hint">
                    <option value="">{{ __('All districts') }}</option>
                    @foreach ($districts as $district)
                        <option value="{{ $district->id }}">{{ $district->name }}</option>
                    @endforeach
                </select>
                @if ($stateId === '')
                    <p id="districtId-hint" class="k-hint">{{ __('Choose a state first.') }}</p>
                @else
                    <p id="districtId-hint" class="k-hint">{{ trans_choice(':count district|:count districts', $districts->count()) }}</p>
                @endif
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
        </form>

        {{-- Error state: Livewire cannot reach the server, so the list below
             will not change until it can. --}}
        <div wire:offline class="k-banner k-banner--danger" role="alert">
            <x-k-icon name="alert" />
            <p>{{ __('You are offline, so the results below cannot update. Check your connection; the search runs again as soon as you are back online.') }}</p>
        </div>

        <div class="edu-results-bar">
            <p class="edu-results-count" role="status">
                <span wire:loading.remove wire:target="search,stateId,districtId,board,clearFilters,gotoPage,nextPage,previousPage">{{ trans_choice(':count school found|:count schools found', $schools->total()) }}</span>
                <span wire:loading wire:target="search,stateId,districtId,board,clearFilters,gotoPage,nextPage,previousPage">{{ __('Searching…') }}</span>
            </p>
            @if ($filtered)
                <button type="button" wire:click="clearFilters" class="k-btn k-btn--ghost">
                    <x-k-icon name="close" /> {{ __('Clear search and filters') }}
                </button>
            @endif
        </div>

        {{-- Loading state: placeholders in the shape of the cards, shown
             only when a search takes long enough to notice. --}}
        <ul class="edu-school-grid hidden" wire:loading.delay.grid wire:target="search,stateId,districtId,board,clearFilters,gotoPage,nextPage,previousPage" role="list" aria-hidden="true">
            @for ($i = 0; $i < 3; $i++)
                <li class="k-card"><span class="k-skel k-skel--line w-1/3"></span><span class="k-skel k-skel--line w-3/4"></span><span class="k-skel k-skel--line w-1/2"></span></li>
            @endfor
        </ul>

        <div wire:loading.delay.remove wire:target="search,stateId,districtId,board,clearFilters,gotoPage,nextPage,previousPage">
            @if ($schools->isEmpty())
                <div class="k-card k-empty">
                    <span class="k-picon k-picon--lg"><x-k-icon name="search" /></span>
                    <{{ $cardHeading }} class="edu-empty-title">{{ __('No schools match your search.') }}</{{ $cardHeading }}>
                    <p>{{ __('Try fewer words, another district, or register the school if it is missing.') }}</p>
                    @if ($filtered)
                        <button type="button" wire:click="clearFilters" class="k-btn k-btn--secondary">{{ __('Clear search and filters') }}</button>
                    @else
                        <a href="{{ route('schools.register') }}" wire:navigate class="k-btn k-btn--secondary">{{ __('Register a School') }}</a>
                    @endif
                </div>
            @else
                <ul class="edu-school-grid" role="list">
                    @foreach ($schools as $school)
                        <li wire:key="school-{{ $school->id }}">
                            <article class="k-card edu-school-card">
                                <div class="edu-school-card__head">
                                    <span class="k-picon k-picon--sm"><x-k-icon name="school" /></span>
                                    <span class="k-chip k-chip--accent k-chip--plain">{{ $school->board }}</span>
                                </div>
                                <{{ $cardHeading }} class="edu-school-card__name">
                                    <a href="{{ route('schools.show', $school) }}" wire:navigate class="edu-stretch">{{ $school->name }}</a>
                                </{{ $cardHeading }}>
                                <p class="edu-meta"><x-k-icon name="map-pin" class="k-icon--sm" /> {{ $school->city }}, {{ $school->district->name }}, {{ $school->state->name }}</p>
                                <div class="edu-school-card__foot">
                                    @if ($school->latestQualityScore)
                                        <p class="edu-sqi">
                                            <span class="edu-sqi__value">{{ $school->latestQualityScore->score }}</span>
                                            <span class="edu-sqi__label">{{ __('School Quality Index') }}</span>
                                        </p>
                                        <span class="k-chip">{{ __(':level confidence', ['level' => str_replace('_', ' ', $school->latestQualityScore->confidence)]) }}</span>
                                    @else
                                        <p class="edu-sqi edu-sqi--none">{{ __('No rating data yet') }}</p>
                                    @endif
                                </div>
                            </article>
                        </li>
                    @endforeach
                </ul>
            @endif
        </div>

        {{ $schools->links('pagination.kesari', ['scrollTo' => '#school-search']) }}
    </section>

    @if ($isHome)
        <section class="k-section" aria-labelledby="how-title">
            <div class="k-section-head">
                <h2 id="how-title">{{ __('How it works') }}</h2>
                <p>{{ __('Education is not a review site. Every voice belongs to a verified parent, student or teacher, and the school never learns who.') }}</p>
            </div>
            <ol class="k-steps edu-steps">
                <li>
                    <h3>{{ __('Find your school') }}</h3>
                    <p>{{ __('Search by name, city or PIN. Fees, facilities and complaint trends are public, with no account needed.') }}</p>
                </li>
                <li>
                    <h3>{{ __('Link your account') }}</h3>
                    <p>{{ __('Parents, students and teachers link their account to their school. The school approves the link.') }}</p>
                </li>
                <li>
                    <h3>{{ __('Speak up, faceless') }}</h3>
                    <p>{{ __('Rate the school or raise a concern. The school sees that a verified parent or student raised it, never who.') }}</p>
                </li>
                <li>
                    <h3>{{ __('Follow it to the end') }}</h3>
                    <p>{{ __('Track every concern, confirm whether it was actually resolved, and appeal if it was not.') }}</p>
                </li>
            </ol>
        </section>
    @endif

    <section class="k-cta" aria-labelledby="register-cta-title">
        <div>
            <h2 id="register-cta-title">{{ __('Is your school missing?') }}</h2>
            <p>{{ __('Don’t see your school? Register it and get verified by a District Officer.') }}</p>
        </div>
        <a href="{{ route('schools.register') }}" wire:navigate class="k-btn k-btn--secondary">{{ __('Register a School') }}</a>
    </section>
</div>
