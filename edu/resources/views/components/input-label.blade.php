@props(['value'])

<label {{ $attributes->merge(['class' => 'k-label block']) }}>
    {{ $value ?? $slot }}
</label>
