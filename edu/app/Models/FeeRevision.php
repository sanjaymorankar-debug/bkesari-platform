<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'fee_id', 'school_id', 'changed_by_user_id', 'previous_amount',
    'new_amount', 'previous_snapshot', 'reason', 'changed_at',
])]
class FeeRevision extends Model
{
    protected function casts(): array
    {
        return [
            'previous_amount' => 'decimal:2',
            'new_amount' => 'decimal:2',
            'previous_snapshot' => 'array',
            'changed_at' => 'datetime',
        ];
    }

    public function fee(): BelongsTo
    {
        return $this->belongsTo(Fee::class);
    }

    public function school(): BelongsTo
    {
        return $this->belongsTo(School::class);
    }

    public function changedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'changed_by_user_id');
    }

    /** Positive when the fee went up. */
    public function delta(): float
    {
        return (float) $this->new_amount - (float) $this->previous_amount;
    }
}
