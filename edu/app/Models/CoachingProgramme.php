<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'school_id', 'academic_year', 'programme_name', 'programme_type',
    'provider_type', 'provider_name', 'applicable_classes', 'faculty',
    'duration', 'timing', 'during_school_hours', 'fee',
    'bundled_into_school_fees', 'is_mandatory', 'certification_offered',
    'recorded_by_user_id',
])]
class CoachingProgramme extends Model
{
    public const TYPES = [
        'jee' => 'JEE',
        'neet' => 'NEET',
        'cuet' => 'CUET',
        'clat' => 'CLAT',
        'nda' => 'NDA',
        'olympiad' => 'Olympiad',
        'scholarship' => 'Scholarship exam',
        'coding' => 'Coding',
        'robotics' => 'Robotics',
        'languages' => 'Languages',
        'other' => 'Other',
    ];

    public const PROVIDERS = [
        'school' => 'Run by the school',
        'external_partner' => 'External partner',
    ];

    protected $attributes = [
        'provider_type' => 'school',
        'programme_type' => 'other',
        'during_school_hours' => false,
        'bundled_into_school_fees' => false,
        'is_mandatory' => false,
        'certification_offered' => false,
    ];

    protected function casts(): array
    {
        return [
            'during_school_hours' => 'boolean',
            'bundled_into_school_fees' => 'boolean',
            'is_mandatory' => 'boolean',
            'certification_offered' => 'boolean',
            'fee' => 'decimal:2',
        ];
    }

    public function school(): BelongsTo
    {
        return $this->belongsTo(School::class);
    }

    public function typeLabel(): string
    {
        return self::TYPES[$this->programme_type] ?? $this->programme_type;
    }

    /**
     * A cost a family cannot avoid but which the published fee figure does not
     * include.
     *
     * This is a factual description of two recorded fields, not an allegation:
     * there are legitimate reasons a school bills mandatory coaching
     * separately. It exists so the estimated annual cost in section 9 can be
     * shown as incomplete rather than silently wrong.
     */
    public function isUnbundledMandatoryCost(): bool
    {
        return $this->is_mandatory
            && ! $this->bundled_into_school_fees
            && (float) ($this->fee ?? 0) > 0;
    }

    /** Coaching inside the timetable is not optional in practice, whatever it is called. */
    public function isEffectivelyCompulsory(): bool
    {
        return $this->is_mandatory || $this->during_school_hours;
    }
}
