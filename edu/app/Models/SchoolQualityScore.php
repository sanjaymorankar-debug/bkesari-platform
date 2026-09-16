<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['school_id', 'score', 'confidence', 'response_count', 'component_breakdown', 'calculated_at'])]
class SchoolQualityScore extends Model
{
    protected function casts(): array
    {
        return [
            'score' => 'decimal:2',
            'component_breakdown' => 'array',
            'calculated_at' => 'datetime',
        ];
    }

    public function school(): BelongsTo
    {
        return $this->belongsTo(School::class);
    }
}
