{{--
    Kesari's pager (.k-pager) for a Livewire list: $list->links('pagination.kesari', ['scrollTo' => '#id']).

    Every control is a real <button> with a name that includes its visible
    number (WCAG 2.5.3), 48px square; the current page is marked
    aria-current="page". The pager Livewire ships put an aria-label on a bare
    <span> for the disabled "Previous", which axe reports as a serious
    violation (aria-prohibited-attr); a disabled button says the same thing
    properly.
--}}
@php
    $scrollTo = $scrollTo ?? 'body';
    $scrollJs = $scrollTo !== false
        ? "(\$el.closest('{$scrollTo}') || document.querySelector('{$scrollTo}'))?.scrollIntoView()"
        : '';
    $pageName = $paginator->getPageName();
@endphp

<div>
    @if ($paginator->hasPages())
        <nav class="edu-pager" aria-label="{{ __('Pages of results') }}">
            <p class="edu-pager__summary">
                {{ __('Showing :first to :last of :total', ['first' => $paginator->firstItem(), 'last' => $paginator->lastItem(), 'total' => $paginator->total()]) }}
            </p>

            <div class="k-pager">
                @if ($paginator->onFirstPage())
                    <button type="button" disabled aria-label="{{ __('Previous page') }}"><x-k-icon name="arrow-left" /></button>
                @else
                    <button type="button" wire:click="previousPage('{{ $pageName }}')" x-on:click="{{ $scrollJs }}" wire:loading.attr="disabled"
                        aria-label="{{ __('Previous page') }}"><x-k-icon name="arrow-left" /></button>
                @endif

                @foreach ($elements as $element)
                    @if (is_string($element))
                        <span aria-hidden="true">{{ $element }}</span>
                    @endif

                    @if (is_array($element))
                        @foreach ($element as $page => $url)
                            @if ($page == $paginator->currentPage())
                                <button type="button" aria-current="page" aria-label="{{ __('Page :page, current page', ['page' => $page]) }}" wire:key="paginator-{{ $pageName }}-page-{{ $page }}">{{ $page }}</button>
                            @else
                                <button type="button" wire:key="paginator-{{ $pageName }}-page-{{ $page }}" wire:click="gotoPage({{ $page }}, '{{ $pageName }}')"
                                    x-on:click="{{ $scrollJs }}" aria-label="{{ __('Go to page :page', ['page' => $page]) }}">{{ $page }}</button>
                            @endif
                        @endforeach
                    @endif
                @endforeach

                @if ($paginator->hasMorePages())
                    <button type="button" wire:click="nextPage('{{ $pageName }}')" x-on:click="{{ $scrollJs }}" wire:loading.attr="disabled"
                        aria-label="{{ __('Next page') }}"><x-k-icon name="arrow-right" /></button>
                @else
                    <button type="button" disabled aria-label="{{ __('Next page') }}"><x-k-icon name="arrow-right" /></button>
                @endif
            </div>
        </nav>
    @endif
</div>
