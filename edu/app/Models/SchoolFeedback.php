<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['school_id', 'anonymous_ref', 'rater_role', 'dimension_scores', 'overall_comment', 'submitted_at'])]
class SchoolFeedback extends Model
{
    protected function casts(): array
    {
        return [
            'dimension_scores' => 'array',
            'submitted_at' => 'datetime',
        ];
    }

    public function school(): BelongsTo
    {
        return $this->belongsTo(School::class);
    }
}
