<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'growth_plan_id', 'domain', 'goal_statement', 'support_at_school',
    'support_at_home', 'student_voice', 'status', 'review_note', 'reviewed_at',
])]
class GrowthGoal extends Model
{
    public const STATUSES = [
        'set' => 'Just set',
        'in_progress' => 'Being worked on',
        'achieved' => 'Achieved',
        'continuing' => 'Carrying into next term',
    ];

    protected function casts(): array
    {
        return ['reviewed_at' => 'datetime'];
    }

    public function plan(): BelongsTo
    {
        return $this->belongsTo(GrowthPlan::class, 'growth_plan_id');
    }

    public function statusLabel(): string
    {
        return self::STATUSES[$this->status] ?? $this->status;
    }
}
