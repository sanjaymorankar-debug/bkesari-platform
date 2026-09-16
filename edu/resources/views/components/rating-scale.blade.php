@props(['name', 'label', 'model', 'max' => 5])

{{--
    An accessible 1-5 rating scale (WCAG 2.1 AA / RPWD Act 2016).

    The visually hidden radio + styled span pattern is fine to look at but was
    failing three separate criteria before this component existed, so all three
    fixes live here rather than being re-remembered at each call site:

    - **1.3.1 / 3.3.2.** The dimension name sat in a sibling <span>, so a
      screen reader announced "1, radio button" with no idea what was being
      rated. The group is now a real fieldset with a legend, and each radio
      carries an aria-label naming the dimension and the value.
    - **2.4.7 Focus Visible.** `sr-only` radios showed a checked state but no
      focus state, so a keyboard user could not see where they were. The
      `peer-focus-visible` ring fixes that.
    - **4.1.2.** `aria-label` gives each option a name that stands alone, since
      "3" out of context tells a user nothing.

    `$model` is the wire:model path, e.g. "scores.practical_learning".
--}}
<fieldset class="flex flex-wrap items-center justify-between gap-2">
    <legend class="sr-only">{{ $label }}</legend>

    <span aria-hidden="true" class="text-sm text-gray-700">{{ $label }}</span>

    <div class="flex gap-1">
        @foreach (range(1, $max) as $value)
            <label class="cursor-pointer">
                <input
                    type="radio"
                    wire:model="{{ $model }}"
                    value="{{ $value }}"
                    name="{{ $name }}"
                    aria-label="{{ $label }}: {{ $value }} out of {{ $max }}"
                    class="sr-only peer">
                <span class="inline-flex items-center justify-center w-8 h-8 text-xs rounded border border-gray-300
                    peer-checked:bg-indigo-600 peer-checked:text-white peer-checked:border-indigo-600
                    peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500 peer-focus-visible:ring-offset-1">
                    {{ $value }}
                </span>
            </label>
        @endforeach
    </div>
</fieldset>
