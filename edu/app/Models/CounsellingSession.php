<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Spec section 19 — counselling records, under the stricter confidentiality
 * tier.
 *
 * `session_notes` is counsellor-only. `shareable_summary` is what a guardian
 * sees, and it exists as a separate field the counsellor writes deliberately
 * rather than as an extract of the notes — a child who knows their exact words
 * go home stops talking, and the platform should not be the reason that
 * happens.
 */
#[Fillable([
    'student_user_id', 'school_id', 'wellbeing_concern_id', 'session_date',
    'session_type', 'session_notes', 'shareable_summary', 'support_plan',
    'interventions', 'referred_externally', 'referral_detail',
    'next_session_date', 'counsellor_user_id',
])]
class CounsellingSession extends Model
{
    public const SESSION_TYPES = [
        'initial' => 'Initial session',
        'follow_up' => 'Follow-up',
        'group' => 'Group session',
        'parent_meeting' => 'Meeting with parent',
        'crisis' => 'Crisis support',
        'other' => 'Other',
    ];

    protected $attributes = [
        'session_type' => 'follow_up',
        'referred_externally' => false,
    ];

    protected function casts(): array
    {
        return [
            'session_date' => 'date',
            'next_session_date' => 'date',
            'referred_externally' => 'boolean',
        ];
    }

    public function student(): BelongsTo
    {
        return $this->belongsTo(User::class, 'student_user_id');
    }

    public function counsellor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'counsellor_user_id');
    }

    public function concern(): BelongsTo
    {
        return $this->belongsTo(WellbeingConcern::class, 'wellbeing_concern_id');
    }

    /**
     * What a guardian may see of this session.
     *
     * Never falls back to the raw notes. If the counsellor has not written a
     * summary, the guardian is told the session happened and that a summary is
     * pending — which is honest, and keeps the choice with the professional.
     *
     * @return array<string, mixed>
     */
    public function guardianView(): array
    {
        return [
            'session_date' => $this->session_date,
            'session_type' => self::SESSION_TYPES[$this->session_type] ?? $this->session_type,
            'summary' => $this->shareable_summary,
            'support_plan' => $this->support_plan,
            'referred_externally' => $this->referred_externally,
            'has_summary' => $this->shareable_summary !== null,
        ];
    }
}
