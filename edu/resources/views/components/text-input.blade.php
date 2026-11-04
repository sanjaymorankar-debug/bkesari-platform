@props(['disabled' => false])

{{-- Kesari text input. Callers keep passing their own layout classes
     (block, mt-1, w-full); an invalid field is marked when its name has an
     error, so the red border and the message below arrive together. --}}
@php($invalid = isset($errors) && $attributes->has('wire:model') && $errors->has($attributes->get('wire:model')))
<input @disabled($disabled) @if ($invalid) aria-invalid="true" @endif {{ $attributes->merge(['class' => 'k-input']) }}>
