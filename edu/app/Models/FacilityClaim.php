<?php

namespace App\Models;

use App\Support\FacilityTaxonomy;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'school_id', 'facility_key', 'academic_year', 'is_offered', 'description',
    'applicable_classes', 'availability', 'capacity', 'fee_amount',
    'is_mandatory', 'provider', 'evidence_path', 'evidence_note',
    'verification_status', 'recorded_by_user_id',
])]
class FacilityClaim extends Model
{
    public const AVAILABILITY = [
        'all_students' => 'Available to all students',
        'selected_classes' => 'Selected classes only',
        'optional_enrolment' => 'Optional, on enrolment',
        'limited' => 'Limited availability',
    ];

    public const VERIFICATION_STATUSES = [
        'unverified' => 'Not yet checked',
        'pending' => 'Evidence submitted, awaiting check',
        'verified' => 'Evidence checked',
    ];

    protected function casts(): array
    {
        return [
            'is_offered' => 'boolean',
            'is_mandatory' => 'boolean',
            'fee_amount' => 'decimal:2',
            'verified_at' => 'datetime',
        ];
    }

    public function school(): BelongsTo
    {
        return $this->belongsTo(School::class);
    }

    /**
     * Verification is set by whoever checked the evidence, never by the school
     * itself — hence the absence of `verified_by_user_id`/`verified_at` from
     * the fillable list.
     */
    public function markVerified(User $verifier): void
    {
        $this->forceFill([
            'verification_status' => 'verified',
            'verified_by_user_id' => $verifier->id,
            'verified_at' => now(),
        ])->save();
    }

    public function label(): string
    {
        return FacilityTaxonomy::label($this->facility_key);
    }

    public function groupLabel(): string
    {
        return FacilityTaxonomy::groupLabel($this->facility_key);
    }

    public function hasEvidence(): bool
    {
        return $this->evidence_path !== null || $this->evidence_note !== null;
    }
}
