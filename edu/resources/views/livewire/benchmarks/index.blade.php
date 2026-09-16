<?php

use App\Models\BenchmarkReference;
use App\Services\BenchmarkService;
use Livewire\Attributes\Layout;
use Livewire\Volt\Component;

/**
 * Spec section 3 — the public "How India Compares" view.
 *
 * The page leads with what it is *not*: there is no Indian PISA score here,
 * because India does not currently participate. Putting that first is the
 * whole point — a benchmarking page that buries its own limitation at the
 * bottom is a benchmarking page nobody reads honestly.
 *
 * Domestic measured data and structural practice are rendered in visually
 * distinct blocks and never combined into a single figure.
 */
new #[Layout('layouts.app')] class extends Component
{
    public function with(): array
    {
        $service = app(BenchmarkService::class);

        return [
            'position' => BenchmarkService::INTERNATIONAL_ASSESSMENT_POSITION,
            'measures' => collect($service->domesticMeasures())->groupBy('dimension'),
            'references' => $service->structuralReferences(),
            'dimensions' => BenchmarkReference::DIMENSIONS,
            'hasUnverified' => $service->hasUnverifiedSources(),
        ];
    }
}; ?>

<div>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">How India Compares</h2>
    </x-slot>

    <div class="py-8 max-w-4xl mx-auto sm:px-6 lg:px-8 space-y-6">

        {{-- The limitation comes first, not last. --}}
        <div class="bg-white rounded-lg shadow border-l-4 border-indigo-500 p-6">
            <h3 class="font-semibold text-gray-900 mb-2">There is no Indian PISA score on this page</h3>
            <p class="text-sm text-gray-700 mb-3">{{ $position['statement'] }}</p>
            <p class="text-xs text-gray-500">
                {{ $position['source_name'] }} &middot; {{ $position['source_year'] }}
            </p>
        </div>

        <div class="bg-white rounded-lg shadow p-6">
            <h3 class="font-semibold text-gray-900 mb-2">How to read this page</h3>
            <div class="grid sm:grid-cols-2 gap-4 text-sm">
                <div class="bg-indigo-50 rounded p-4">
                    <div class="font-medium text-indigo-900 mb-1">Measured here</div>
                    <p class="text-indigo-900">
                        Numbers this platform computed from its own records. Each one shows what it was
                        computed from, because a percentage drawn from a handful of schools is not a national
                        statistic.
                    </p>
                </div>
                <div class="bg-gray-50 rounded p-4">
                    <div class="font-medium text-gray-900 mb-1">Structural comparison</div>
                    <p class="text-gray-700">
                        What high-performing systems <em>do</em>, from published and dated sources. Never what
                        they scored — this platform does not rank India against other countries.
                    </p>
                </div>
            </div>
        </div>

        @if ($hasUnverified)
            <div class="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900">
                <strong>Some citations on this page are pending verification.</strong> They are drawn from the
                platform's reference list and have not yet been re-checked against the original published
                source. They are shown so the comparison can be reviewed, not as settled fact.
            </div>
        @endif

        @foreach ($dimensions as $key => $label)
            @php
                $dimensionMeasures = $measures->get($key, collect());
                $dimensionRefs = $references->get($key, collect());
            @endphp

            @if ($dimensionMeasures->isNotEmpty() || $dimensionRefs->isNotEmpty())
                <div class="bg-white rounded-lg shadow p-6">
                    <h3 class="font-semibold text-gray-900 mb-4">{{ $label }}</h3>

                    @if ($dimensionMeasures->isNotEmpty())
                        <div class="mb-5">
                            <div class="text-xs font-medium text-indigo-700 uppercase tracking-wide mb-2">Measured here</div>
                            @foreach ($dimensionMeasures as $measure)
                                <div class="bg-indigo-50 rounded p-4 mb-2">
                                    <div class="flex flex-wrap items-baseline justify-between gap-2">
                                        <span class="text-sm text-indigo-900">{{ $measure['label'] }}</span>
                                        <span class="text-xl font-bold text-indigo-900">
                                            @if ($measure['value'] === null)
                                                <span class="text-sm font-normal">not enough data yet</span>
                                            @else
                                                {{ $measure['value'] }}{{ $measure['unit'] }}
                                            @endif
                                        </span>
                                    </div>
                                    <p class="text-xs text-indigo-900 mt-1">{{ $measure['description'] }}</p>
                                    <p class="text-xs text-indigo-700 mt-1">
                                        From {{ $measure['coverage'] }}
                                        @if ($measure['provenance'] === 'school_reported')
                                            &middot; school-reported, not independently verified
                                        @else
                                            &middot; measured by this platform
                                        @endif
                                        @unless ($measure['meaningful'])
                                            &middot; <strong>too little data to read as representative</strong>
                                        @endunless
                                    </p>
                                </div>
                            @endforeach
                        </div>
                    @endif

                    @if ($dimensionRefs->isNotEmpty())
                        <div>
                            <div class="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                                What other systems do
                            </div>
                            @foreach ($dimensionRefs as $reference)
                                <div class="border-l-2 border-gray-200 pl-4 py-2 mb-2">
                                    <div class="flex flex-wrap items-center gap-2">
                                        <span class="text-sm font-medium text-gray-900">{{ $reference->system_name }}</span>
                                        <span class="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                                            {{ $reference->system_type === 'framework' ? 'Framework' : 'Country' }}
                                        </span>
                                        @unless ($reference->source_verified)
                                            <span class="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-900">
                                                citation pending verification
                                            </span>
                                        @endunless
                                    </div>
                                    <p class="text-sm text-gray-700 mt-1">{{ $reference->practice }}</p>
                                    @if ($reference->relevance)
                                        <p class="text-sm text-gray-500 mt-1">
                                            <span class="text-gray-400">Why it's here:</span> {{ $reference->relevance }}
                                        </p>
                                    @endif
                                    <p class="text-xs text-gray-400 mt-1">{{ $reference->citation() }}</p>
                                </div>
                            @endforeach
                        </div>
                    @endif
                </div>
            @endif
        @endforeach

        <div class="bg-white rounded-lg shadow p-6">
            <h3 class="font-semibold text-gray-900 mb-2">What this page deliberately does not do</h3>
            <ul class="text-sm text-gray-700 space-y-1 list-disc list-inside">
                <li>It does not rank Indian schools against schools in other countries.</li>
                <li>It does not compare any individual child to anything.</li>
                <li>It does not present a score India has not produced.</li>
                <li>It does not treat a structural practice as a measurement, or the reverse.</li>
            </ul>
        </div>
    </div>
</div>
