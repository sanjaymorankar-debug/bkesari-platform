@props(['status'])

{{-- A complaint's status as a Kesari chip, in words (never colour alone):
     done is green, escalated amber, anything being worked on blue, and a
     complaint nobody has picked up yet neutral. --}}
@php
    $labels = [
        'submitted' => __('Submitted'),
        'under_review' => __('Under review'),
        'school_responded' => __('School responded'),
        'escalated' => __('Escalated'),
        'investigating' => __('Investigating'),
        'action_taken' => __('Action taken'),
        'resolved' => __('Resolved'),
        'closed' => __('Closed'),
    ];
    $tone = match ($status) {
        'resolved', 'closed' => 'k-chip--success',
        'escalated' => 'k-chip--warning',
        'submitted' => '',
        default => 'k-chip--info',
    };
@endphp
<span {{ $attributes->merge(['class' => trim('k-chip '.$tone)]) }}>{{ $labels[$status] ?? ucfirst(str_replace('_', ' ', $status)) }}</span>
