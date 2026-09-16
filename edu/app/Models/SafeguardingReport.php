<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Str;

/**
 * Spec section 25. See the migration for why this is a separate table from
 * complaints and why the external-reporting columns exist.
 */
#[Fillable([
    'reference', 'school_id', 'district_id', 'state_id', 'anonymous_ref',
    'reporter_role', 'category', 'description', 'immediate_danger',
    'legal_duty_shown_at',
])]
class SafeguardingReport extends Model
{
    /**
     * Categories that engage the POCSO Act section 19 reporting duty
     * specifically. Others are still serious and still restricted, but the
     * POCSO wording is legally specific and must not be attached to cases it
     * doesn't cover.
     */
    public const POCSO_CATEGORIES = ['child_sexual_abuse'];

    public const CATEGORIES = [
        'child_sexual_abuse' => 'Sexual abuse of a child',
        'physical_abuse' => 'Physical abuse',
        'emotional_abuse' => 'Emotional abuse',
        'neglect' => 'Neglect',
        'serious_violence' => 'Serious violence',
        'immediate_danger' => 'A child is in immediate danger',
        'serious_harassment' => 'Serious harassment',
        'criminal_allegation' => 'Criminal allegation',
        'other_serious_concern' => 'Another serious concern about a child\'s safety',
    ];

    public const STATUSES = [
        'submitted' => 'Submitted',
        'acknowledged' => 'Received by the Child Safety Officer',
        'external_report_confirmed' => 'External report recorded',
        'under_investigation' => 'Under investigation',
        'closed' => 'Closed',
    ];

    public const EXTERNAL_CHANNELS = [
        'police' => 'Police',
        'sjpu' => 'Special Juvenile Police Unit',
        'childline_1098' => 'Childline (1098)',
        'cwc' => 'Child Welfare Committee',
        'other' => 'Other authority',
    ];

    /**
     * The database carries these defaults too, but a freshly created model
     * would otherwise hold null for them until refreshed — which meant a case
     * rendered immediately after submission had no status to display.
     */
    protected $attributes = [
        'status' => 'submitted',
        'immediate_danger' => false,
    ];

    protected function casts(): array
    {
        return [
            'immediate_danger' => 'boolean',
            'legal_duty_shown_at' => 'datetime',
            'external_report_acknowledged_at' => 'datetime',
            'acknowledged_at' => 'datetime',
            'closed_at' => 'datetime',
        ];
    }

    public function school(): BelongsTo
    {
        return $this->belongsTo(School::class);
    }

    public function district(): BelongsTo
    {
        return $this->belongsTo(District::class);
    }

    public function events(): HasMany
    {
        return $this->hasMany(SafeguardingEvent::class);
    }

    public function assignedOfficer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assigned_officer_user_id');
    }

    public static function generateReference(): string
    {
        do {
            $reference = 'SG-'.strtoupper(Str::random(10));
        } while (self::where('reference', $reference)->exists());

        return $reference;
    }

    /** Whether this case engages the POCSO section 19 duty specifically. */
    public function engagesPocsoDuty(): bool
    {
        return in_array($this->category, self::POCSO_CATEGORIES, true);
    }

    public function hasExternalReport(): bool
    {
        return $this->external_report_acknowledged_at !== null;
    }

    public function categoryLabel(): string
    {
        return self::CATEGORIES[$this->category] ?? $this->category;
    }

    public function statusLabel(): string
    {
        return self::STATUSES[$this->status] ?? $this->status;
    }
}
