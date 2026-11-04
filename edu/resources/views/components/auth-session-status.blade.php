@props(['status'])

@if ($status)
    <div {{ $attributes->merge(['class' => 'k-banner k-banner--success', 'role' => 'status']) }}>
        <p>{{ $status }}</p>
    </div>
@endif
