<?php

use App\Models\CareerInterestProfile;
use App\Models\User;
use App\Services\CareerPathwayService;
use App\Services\ConsentService;
use App\Services\DevelopmentAccessService;
use Illuminate\Support\Facades\Auth;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

/**
 * Spec section 17 — career interest exploration.
 *
 * Every capture is a new dated row and the page always shows the date, because
 * the rule here is that interests are revisited, not settled. Suggestions are
 * computed live by CareerPathwayService from the child's own stated interests
 * and are labelled as things to look into; nothing on this page is stored as a
 * track, and no part of it is visible to government or to other families.
 */
new #[Layout('layouts.app')] class extends Component
{
    public User $student;

    public array $selectedInterests = [];

    public string $enjoyedActivities = '';

    public string $reflection = '';

    public string $academicTerm = '';

    public string $flash = '';

    public function mount(User $student): void
    {
        $this->student = $student;

        abort_unless(
            app(DevelopmentAccessService::class)->canView(Auth::user(), $student->id, 'career_pathway'),
            403,
            'You do not have access to this career record, or consent is not on record for it.'
        );

        $this->academicTerm = $this->currentTerm();
    }

    private function currentTerm(): string
    {
        $now = now();
        $startYear = $now->month >= 4 ? $now->year : $now->year - 1;

        return $startYear.'-'.substr((string) ($startYear + 1), 2).' Term '.($now->month >= 4 && $now->month <= 9 ? '1' : '2');
    }

    /** Only the child records their own interests — see CareerInterestProfilePolicy. */
    public function canCapture(): bool
    {
        return Auth::id() === $this->student->id;
    }

    public function save(): void
    {
        abort_unless($this->canCapture(), 403, 'Only the student records their own interests.');
        app(ConsentService::class)->requireConsent($this->student->id, 'career_pathway');

        $validated = $this->validate([
            'selectedInterests' => ['required', 'array', 'min:1'],
            'selectedInterests.*' => ['in:'.implode(',', array_keys(CareerInterestProfile::INTEREST_AREAS))],
            'enjoyedActivities' => ['nullable', 'string', 'max:1000'],
            'reflection' => ['nullable', 'string', 'max:2000'],
            'academicTerm' => ['required', 'string', 'max:40'],
        ]);

        CareerInterestProfile::create([
            'student_user_id' => $this->student->id,
            'captured_by_user_id' => Auth::id(),
            'academic_term' => $validated['academicTerm'],
            'interest_areas' => array_values($validated['selectedInterests']),
            'enjoyed_activities' => $validated['enjoyedActivities']
                ? array_values(array_filter(array_map('trim', explode(',', $validated['enjoyedActivities']))))
                : null,
            'reflection' => $validated['reflection'] ?: null,
            'captured_on' => now()->toDateString(),
        ]);

        $this->reset(['selectedInterests', 'enjoyedActivities', 'reflection']);
        $this->flash = 'Saved. You can come back and change this any time — your interests are allowed to change.';
    }

    public function with(): array
    {
        $history = CareerInterestProfile::where('student_user_id', $this->student->id)
            ->orderByDesc('captured_on')
            ->get();

        $latest = $history->first();

        return [
            'interestAreas' => CareerInterestProfile::INTEREST_AREAS,
            'history' => $history,
            'latest' => $latest,
            'suggestions' => $latest ? app(CareerPathwayService::class)->suggestionsForProfile($latest) : [],
            'ncsUrl' => app(CareerPathwayService::class)->nationalCareerServiceUrl(),
            'isSelf' => Auth::id() === $this->student->id,
        ];
    }
}; ?>

<div>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">
            {{ Auth::id() === $student->id ? 'My interests & pathways' : $student->name . ' — interests & pathways' }}
        </h2>
    </x-slot>

    <div class="py-8 max-w-3xl mx-auto sm:px-6 lg:px-8 space-y-6">

        @if ($flash)
            <div role="status" aria-live="polite" class="bg-green-50 border border-green-200 text-green-800 rounded-lg p-4 text-sm">{{ $flash }}</div>
        @endif

        <div class="bg-indigo-50 border border-indigo-100 rounded-lg p-4">
            <p class="text-sm text-indigo-900">
                <strong>Nothing here decides anything.</strong>
                What {{ $isSelf ? 'you like' : 'a child likes' }} at this age is expected to change, and it should.
                The areas below are things to look into and talk about — they are not a stream,
                not a recommendation, and not a prediction.
            </p>
        </div>

        @if ($latest)
            <div class="bg-white rounded-lg shadow p-6">
                <div class="flex items-baseline justify-between mb-3">
                    <h3 class="font-semibold text-gray-900">{{ $isSelf ? 'What you said you enjoy' : 'What they said they enjoy' }}</h3>
                    <span class="text-xs text-gray-400">as of {{ $latest->captured_on->format('j M Y') }}</span>
                </div>
                <div class="flex flex-wrap gap-2">
                    @foreach ($latest->interestLabels() as $label)
                        <span class="text-sm px-3 py-1 rounded-full bg-indigo-100 text-indigo-800">{{ $label }}</span>
                    @endforeach
                </div>
                @if ($latest->reflection)
                    <p class="text-sm text-gray-600 mt-3 italic">"{{ $latest->reflection }}"</p>
                @endif
            </div>

            <div class="bg-white rounded-lg shadow p-6">
                <h3 class="font-semibold text-gray-900 mb-1">Areas worth exploring</h3>
                <p class="text-xs text-gray-500 mb-4">
                    Shown because of what {{ $isSelf ? 'you' : 'they' }} chose above — nothing else. These are
                    wide fields, not job titles, and there is no ranking of how suitable anyone is for them.
                </p>

                @forelse ($suggestions as $suggestion)
                    <div class="border border-gray-200 rounded-lg p-4 mb-3 last:mb-0">
                        <h4 class="text-sm font-semibold text-gray-900">{{ $suggestion['label'] }}</h4>
                        <p class="text-sm text-gray-600 mt-1">{{ $suggestion['description'] }}</p>
                        <p class="text-xs text-gray-500 mt-2">
                            <span class="font-semibold">Routes people take:</span> {{ $suggestion['study_routes'] }}
                        </p>
                        <p class="text-xs text-gray-400 mt-2">
                            Shown because {{ $isSelf ? 'you' : 'they' }} chose: {{ implode(', ', $suggestion['because']) }}
                        </p>
                    </div>
                @empty
                    <p class="text-sm text-gray-400">Choose some interests below to see areas to explore.</p>
                @endforelse

                <p class="text-xs text-gray-500 mt-4 pt-4 border-t">
                    For official government career guidance, see the Ministry of Labour &amp; Employment's
                    <a href="{{ $ncsUrl }}" target="_blank" rel="noopener noreferrer" class="text-indigo-600 hover:underline">National Career Service</a>.
                    This platform links to NCS as a public resource and does not exchange any data with it.
                </p>
            </div>
        @endif

        @if ($this->canCapture())
            <form wire:submit="save" class="bg-white rounded-lg shadow p-6 space-y-5">
                <div>
                    <h3 class="font-semibold text-gray-900">{{ $latest ? 'Changed your mind? Update this' : 'What do you enjoy?' }}</h3>
                    <p class="text-xs text-gray-500 mt-1">Pick as many as you like. There are no wrong answers.</p>
                </div>

                <div class="grid sm:grid-cols-2 gap-2">
                    @foreach ($interestAreas as $key => $label)
                        <label class="flex items-center gap-2 text-sm p-2 rounded hover:bg-gray-50 cursor-pointer">
                            <input type="checkbox" wire:model="selectedInterests" value="{{ $key }}" class="rounded text-indigo-600">
                            {{ $label }}
                        </label>
                    @endforeach
                </div>
                @error('selectedInterests') <p class="text-xs text-red-600">{{ $message }}</p> @enderror

                <div>
                    <label for="enjoyedActivities" class="block text-sm font-medium text-gray-700 mb-1">
                        Subjects or activities you enjoy <span class="text-gray-400 font-normal">(comma separated, optional)</span>
                    </label>
                    <input type="text" wire:model="enjoyedActivities" id="enjoyedActivities" maxlength="1000"
                        class="w-full rounded border-gray-300 text-sm">
                </div>

                <div>
                    <label for="reflection" class="block text-sm font-medium text-gray-700 mb-1">
                        Anything you want to say about it? <span class="text-gray-400 font-normal">(optional)</span>
                    </label>
                    <textarea wire:model="reflection" id="reflection" rows="3" maxlength="2000" class="w-full rounded border-gray-300 text-sm"></textarea>
                </div>

                <div>
                    <label for="academicTerm" class="block text-sm font-medium text-gray-700 mb-1">Term</label>
                    <input type="text" wire:model="academicTerm" id="academicTerm" maxlength="40" class="w-full rounded border-gray-300 text-sm">
                    @error('academicTerm') <p class="text-xs text-red-600 mt-1">{{ $message }}</p> @enderror
                </div>

                <button type="submit" class="px-4 py-2 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-700">Save</button>
            </form>
        @endif

        @if ($history->count() > 1)
            <div class="bg-white rounded-lg shadow p-6">
                <h3 class="font-semibold text-gray-900 mb-1">How this has changed</h3>
                <p class="text-xs text-gray-500 mb-4">Kept on purpose — seeing interests shift over time is the point.</p>
                @foreach ($history as $entry)
                    <div class="flex gap-3 py-2 border-b last:border-0 text-sm">
                        <span class="text-xs text-gray-400 w-24 shrink-0">{{ $entry->captured_on->format('j M Y') }}</span>
                        <span class="text-gray-700">{{ implode(', ', $entry->interestLabels()) }}</span>
                    </div>
                @endforeach
            </div>
        @endif

        <a href="{{ route('growth.show', $student->id) }}" wire:navigate class="inline-block text-sm text-gray-600 hover:underline">
            &larr; Back to growth record
        </a>
    </div>
</div>
