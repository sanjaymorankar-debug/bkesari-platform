<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** Spec sections 8 and 12. */
#[Fillable([
    'school_id', 'academic_year', 'name', 'course_type', 'applicable_classes',
    'stream', 'description', 'recorded_by_user_id',
])]
class Course extends Model
{
    public const TYPES = [
        'core_subject' => 'Core subject',
        'elective' => 'Elective',
        'stream' => 'Stream',
        'vocational' => 'Vocational',
        'language' => 'Language',
        'programme' => 'Programme',
        'other' => 'Other',
    ];

    protected $attributes = ['course_type' => 'core_subject'];

    public function school(): BelongsTo
    {
        return $this->belongsTo(School::class);
    }

    public function ratings(): HasMany
    {
        return $this->hasMany(CourseRating::class);
    }

    public function typeLabel(): string
    {
        return self::TYPES[$this->course_type] ?? $this->course_type;
    }
}
