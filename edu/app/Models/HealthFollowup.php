<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Spec section 21's follow-up lifecycle. */
#[Fillable([
    'student_user_id', 'school_id', 'physical_health_record_id', 'area',
    'finding', 'recommended_action', 'status', 'identified_on', 'due_on',
    'completed_on', 'outcome', 'opened_by_user_id',
])]
class HealthFollowup extends Model
{
    public const STATUSES = [
        'identified' => 'Identified',
        'referred' => 'Referred',
        'follow_up' => 'Follow-up in progress',
        'completed' => 'Completed',
        'closed' => 'Closed',
    ];

    public const AREAS = [
        'vision' => 'Vision',
        'hearing' => 'Hearing',
        'dental' => 'Dental',
        'nutrition' => 'Nutrition',
        'general' => 'General',
        'other' => 'Other',
    ];

    protected $attributes = ['status' => 'identified', 'area' => 'general'];

    protected function casts(): array
    {
        return [
            'identified_on' => 'date',
            'due_on' => 'date',
            'completed_on' => 'date',
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

    public function healthRecord(): BelongsTo
    {
        return $this->belongsTo(PhysicalHealthRecord::class, 'physical_health_record_id');
    }

    public function isOpen(): bool
    {
        return ! in_array($this->status, ['completed', 'closed'], true);
    }

    /**
     * Open, and past the date it was meant to be dealt with. This is the query
     * that makes "we found a vision problem in March" answerable in November.
     */
    public function isOverdue(): bool
    {
        return $this->isOpen()
            && $this->due_on !== null
            && $this->due_on->isPast();
    }

    public function statusLabel(): string
    {
        return self::STATUSES[$this->status] ?? $this->status;
    }
}
