<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'student_user_id', 'school_id', 'observer_user_id', 'observer_role',
    'domain', 'strand', 'observation_type', 'observation', 'evidence_context',
    'academic_term', 'observed_on', 'moderation_status', 'moderated_by_user_id',
    'moderated_at',
])]
class CapabilityObservation extends Model
{
    /**
     * NEP 2020's holistic-development domains, as used by the Holistic
     * Progress Card. Labels are parent-facing on purpose — no jargon.
     */
    public const DOMAINS = [
        'cognitive_scholastic' => 'Learning & thinking',
        'socio_emotional' => 'Working with others & self-understanding',
        'creative_co_scholastic' => 'Creative & expressive',
        'physical_development' => 'Physical & wellbeing',
        'life_skills' => 'Life skills',
    ];

    protected function casts(): array
    {
        return [
            'observed_on' => 'date',
            'moderated_at' => 'datetime',
        ];
    }

    public function student(): BelongsTo
    {
        return $this->belongsTo(User::class, 'student_user_id');
    }

    public function observer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'observer_user_id');
    }

    public function school(): BelongsTo
    {
        return $this->belongsTo(School::class);
    }

    /**
     * Only observations cleared for display. Peer observations start pending
     * and need a teacher to approve them before anyone sees them.
     */
    public function scopeVisible(Builder $query): Builder
    {
        return $query->where('moderation_status', 'approved');
    }

    public function domainLabel(): string
    {
        return self::DOMAINS[$this->domain] ?? $this->domain;
    }
}
