@props(['messages'])

@if ($messages)
    <ul {{ $attributes->merge(['class' => 'space-y-1', 'role' => 'alert']) }}>
        @foreach ((array) $messages as $message)
            <li class="k-error">{{ $message }}</li>
        @endforeach
    </ul>
@endif
