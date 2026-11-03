{{-- Kesari primary button: the Education teal, 48px tall, Kesari's focus ring. --}}
<button {{ $attributes->merge(['type' => 'submit', 'class' => 'k-btn']) }}>
    {{ $slot }}
</button>
