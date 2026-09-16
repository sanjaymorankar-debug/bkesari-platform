<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Spec section 18. See the migration for why rows are never overwritten.
 */
#[Fillable([
    'student_user_id', 'school_id', 'academic_year', 'examination_date',
    'examination_type', 'height_cm', 'weight_kg', 'bmi', 'vision_left',
    'vision_right', 'hearing', 'dental', 'general_examination',
    'nutrition_observations', 'health_concerns', 'recommendations',
    'next_due_date', 'recorded_by_user_id', 'recorded_by_designation',
])]
class PhysicalHealthRecord extends Model
{
    public const EXAMINATION_TYPES = [
        'annual_screening' => 'Annual screening',
        'follow_up' => 'Follow-up',
        'incident' => 'Incident',
        'immunisation' => 'Immunisation',
        'other' => 'Other',
    ];

    protected $attributes = ['examination_type' => 'annual_screening'];

    protected function casts(): array
    {
        return [
            'examination_date' => 'date',
            'next_due_date' => 'date',
            'height_cm' => 'decimal:1',
            'weight_kg' => 'decimal:1',
            'bmi' => 'decimal:1',
        ];
    }

    public function student(): BelongsTo
    {
        return $this->belongsTo(User::class, 'student_user_id');
    }

    public function school(): BelongsTo
    {
        return $this->belongsTo(School::class);
    }

    public function recordedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'recorded_by_user_id');
    }

    public function followups(): HasMany
    {
        return $this->hasMany(HealthFollowup::class);
    }

    /**
     * BMI from the recorded measurements, where both exist.
     *
     * Returned as a number only. The platform deliberately does not classify
     * it — "underweight"/"obese" against adult cutoffs is meaningless for a
     * growing child, and a label attached to a child's record is exactly what
     * spec sections 15 and 28 forbid elsewhere. Interpretation belongs to the
     * health professional who took the measurement.
     */
    public function calculatedBmi(): ?float
    {
        $height = (float) $this->height_cm;
        $weight = (float) $this->weight_kg;

        if ($height <= 0 || $weight <= 0) {
            return null;
        }

        return round($weight / (($height / 100) ** 2), 1);
    }
}
