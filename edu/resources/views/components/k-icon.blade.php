@props(['name'])

{{-- An icon from the Kesari 1.1.0 set: the hub's icons.svg sprite (the same
     drawings as the shell and every other project), 24px grid, drawn in the
     current colour. Decorative by design: the text beside it, or the
     control's aria-label, carries the meaning. Names are those of
     packages/kesari-ui/src/icons.json (school, search, users, shield...). --}}
<svg {{ $attributes->merge(['class' => 'k-icon']) }} aria-hidden="true" focusable="false"><use href="{{ config('services.hub.asset_origin') }}/kesari-ui/1.1.0/icons.svg#k-i-{{ $name }}"/></svg>
