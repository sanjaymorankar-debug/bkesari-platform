<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable([
    'student_user_id', 'school_id', 'created_by_user_id', 'academic_term',
    'status', 'summary_for_parent', 'shared_with_parent_at',
    'parent_acknowledged_at', 'reviewed_at',
])]
class GrowthPlan extends Model
{
    /** Spec section 16 — a term carries at most three goals, so the loop stays actionable. */
    public const MAX_GOALS = 3;

    protected function casts(): array
    {
        return [
            'shared_with_parent_at' => 'datetime',
            'parent_acknowledged_at' => 'datetime',
            'reviewed_at' => 'datetime',
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

    public function createdBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by_user_id');
    }

    public function goals(): HasMany
    {
        return $this->hasMany(GrowthGoal::class);
    }

    public function isSharedWithParent(): bool
    {
        return $this->shared_with_parent_at !== null;
    }

    public function hasGoalCapacity(): bool
    {
        return $this->goals()->count() < self::MAX_GOALS;
    }
}
