@props(['active'])

{{-- A tab-style link (Kesari k-tabs): the current page carries aria-current. --}}
<a {{ $attributes->merge(['class' => 'inline-flex items-center min-h-12 px-3 border-b-[3px] font-semibold transition duration-150 ease-in-out '.(($active ?? false) ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-600 hover:text-gray-900')]) }} @if ($active ?? false) aria-current="page" @endif>
    {{ $slot }}
</a>
