<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Spec section 19 — "Teacher Observation / Concern", never a diagnosis.
 *
 * The class carries no clinical vocabulary at all, matching its table. If you
 * are here to add a severity, risk level, or condition field: that belongs to
 * a counsellor in CounsellingSession, and a schema test will fail if it lands
 * here.
 */
#[Fillable([
    'student_user_id', 'school_id', 'observation', 'context', 'observed_on',
    'raised_by_user_id', 'raised_by_role',
])]
class WellbeingConcern extends Model
{
    public const REFERRAL_STATUSES = [
        'raised' => 'Raised, awaiting counsellor',
        'seen_by_counsellor' => 'Seen by counsellor',
        'closed_without_referral' => 'Closed without referral',
    ];

    protected $attributes = ['referral_status' => 'raised'];

    protected function casts(): array
    {
        return [
            'observed_on' => 'date',
            'seen_at' => 'datetime',
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

    public function raisedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'raised_by_user_id');
    }

    /**
     * Picked up by a counsellor. Routing only — this records that a
     * professional has looked at it, not what they concluded.
     */
    public function markSeenBy(User $counsellor): void
    {
        $this->forceFill([
            'referral_status' => 'seen_by_counsellor',
            'seen_at' => now(),
            'seen_by_user_id' => $counsellor->id,
        ])->save();
    }

    public function statusLabel(): string
    {
        return self::REFERRAL_STATUSES[$this->referral_status] ?? $this->referral_status;
    }
}
