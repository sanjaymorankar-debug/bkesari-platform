<?php

namespace App\Models;

use App\Support\FacilityTaxonomy;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'school_id', 'facility_key', 'academic_year', 'anonymous_ref', 'rater_role',
    'availability_report', 'quality', 'equipment', 'usage_frequency',
    'staff_support', 'overall_usefulness', 'comment', 'submitted_at',
])]
class FacilityRating extends Model
{
    /** Spec section 12's structured questions, rather than one star rating. */
    public const DIMENSIONS = [
        'quality' => 'Quality',
        'equipment' => 'Equipment & condition',
        'usage_frequency' => 'How often students actually use it',
        'staff_support' => 'Staff support',
        'overall_usefulness' => 'Overall usefulness',
    ];

    public const AVAILABILITY_REPORTS = [
        'available' => 'Yes, available',
        'partially_available' => 'Partly — limited or occasional',
        'not_available' => 'No, not available',
    ];

    protected function casts(): array
    {
        return ['submitted_at' => 'datetime'];
    }

    public function school(): BelongsTo
    {
        return $this->belongsTo(School::class);
    }

    public function label(): string
    {
        return FacilityTaxonomy::label($this->facility_key);
    }
}
