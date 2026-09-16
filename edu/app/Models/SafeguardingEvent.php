<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Append-only. Nothing in the application updates or deletes these rows.
 */
#[Fillable([
    'safeguarding_report_id', 'event_type', 'actor_user_id', 'actor_role',
    'detail', 'occurred_at',
])]
class SafeguardingEvent extends Model
{
    protected function casts(): array
    {
        return ['occurred_at' => 'datetime'];
    }

    public function report(): BelongsTo
    {
        return $this->belongsTo(SafeguardingReport::class, 'safeguarding_report_id');
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_user_id');
    }
}
