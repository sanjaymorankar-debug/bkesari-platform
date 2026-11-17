@props(['role'])

{{-- A role's name in words people use, in the page's language. --}}
@php
    $labels = [
        'parent' => __('Parent'),
        'student' => __('Student'),
        'teacher' => __('Teacher'),
        'school_admin' => __('School admin'),
        'school_nurse' => __('School nurse'),
        'counsellor' => __('Counsellor'),
        'career_mentor' => __('Career mentor'),
        'child_safety_officer' => __('Child safety officer'),
        'district_officer' => __('District officer'),
        'state_officer' => __('State officer'),
        'national_admin' => __('National admin'),
        'researcher' => __('Researcher'),
        'data_protection_officer' => __('Data protection officer'),
        'system_admin' => __('System admin'),
    ];
@endphp
{{ $labels[$role] ?? ucfirst(str_replace('_', ' ', $role)) }}
