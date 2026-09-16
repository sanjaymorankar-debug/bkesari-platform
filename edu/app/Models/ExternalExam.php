<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'school_id', 'academic_year', 'exam_name', 'conducting_body', 'exam_type',
    'applicable_classes', 'eligibility', 'registration_process', 'through_school',
    'exam_fee', 'preparation_offered', 'preparation_fee', 'is_mandatory',
    'frequency', 'recorded_by_user_id',
])]
class ExternalExam extends Model
{
    public const TYPES = [
        'olympiad' => 'Olympiad',
        'scholarship' => 'Scholarship exam',
        'competitive' => 'Competitive exam',
        'entrance' => 'Entrance exam',
        'international' => 'International exam',
        'language' => 'Language exam',
        'skill_certification' => 'Skill certification',
        'other' => 'Other recognised exam',
    ];

    public const FREQUENCIES = [
        'annual' => 'Once a year',
        'biannual' => 'Twice a year',
        'termly' => 'Every term',
        'one_off' => 'One off',
    ];

    protected $attributes = [
        'through_school' => true,
        'preparation_offered' => false,
        'is_mandatory' => false,
        'frequency' => 'annual',
        'exam_type' => 'other',
    ];

    protected function casts(): array
    {
        return [
            'through_school' => 'boolean',
            'preparation_offered' => 'boolean',
            'is_mandatory' => 'boolean',
            'exam_fee' => 'decimal:2',
            'preparation_fee' => 'decimal:2',
        ];
    }

    public function school(): BelongsTo
    {
        return $this->belongsTo(School::class);
    }

    public function typeLabel(): string
    {
        return self::TYPES[$this->exam_type] ?? $this->exam_type;
    }

    /** Exam fee plus preparation fee, where both are charged. */
    public function totalCost(): float
    {
        return (float) ($this->exam_fee ?? 0) + (float) ($this->preparation_fee ?? 0);
    }
}
