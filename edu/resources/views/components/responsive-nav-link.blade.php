@props(['active'])

<a {{ $attributes->merge(['class' => 'flex items-center w-full min-h-12 ps-3 pe-4 border-l-4 text-start font-semibold transition duration-150 ease-in-out '.(($active ?? false) ? 'border-indigo-600 text-indigo-700 bg-indigo-50' : 'border-transparent text-gray-700 hover:text-gray-900 hover:bg-gray-100')]) }} @if ($active ?? false) aria-current="page" @endif>
    {{ $slot }}
</a>
