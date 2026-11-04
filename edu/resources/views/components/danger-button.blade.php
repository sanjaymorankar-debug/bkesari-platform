<button {{ $attributes->merge(['type' => 'submit', 'class' => 'k-btn k-btn--danger']) }}>
    {{ $slot }}
</button>
