@props(['summary', 'scopeLabel' => 'this area'])

{{--
    Spec sections 20 and 32 — the only health view any government role gets.

    Figures computed from fewer than ten records arrive already suppressed from
    HealthAggregateService; this component just renders that state honestly
    rather than falling back to a zero. Shared across the district, state and
    national dashboards so the wording and the suppression treatment cannot
    drift apart between them.
--}}
<div class="bg-white rounded-lg shadow p-6">
    <h3 class="font-semibold text-gray-900 mb-1">Health &amp; wellbeing in {{ $scopeLabel }}</h3>
    <p class="text-xs text-gray-500 mb-4">
        Aggregate figures only. No individual child's health, wellbeing or counselling record is
        accessible from any government view.
    </p>

    <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        @foreach ($summary as $metric)
            <div class="rounded p-4 {{ $metric['suppressed'] ? 'bg-gray-50' : 'bg-indigo-50' }}">
                <div class="text-xs {{ $metric['suppressed'] ? 'text-gray-600' : 'text-indigo-700' }}">
                    {{ $metric['label'] }}
                </div>
                <div class="text-xl font-bold {{ $metric['suppressed'] ? 'text-gray-400' : 'text-indigo-900' }}">
                    @if ($metric['suppressed'])
                        <span class="text-sm font-normal">Withheld</span>
                    @else
                        {{ $metric['value'] }}{{ $metric['unit'] }}
                    @endif
                </div>
                <div class="text-xs {{ $metric['suppressed'] ? 'text-gray-500' : 'text-indigo-700' }} mt-1">
                    {{ $metric['note'] }}
                </div>
            </div>
        @endforeach
    </div>
</div>
