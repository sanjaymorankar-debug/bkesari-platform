<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['teacher_user_id', 'score', 'confidence', 'response_count', 'component_breakdown', 'calculated_at'])]
class TeacherEffectivenessScore extends Model
{
    protected function casts(): array
    {
        return [
            'score' => 'decimal:2',
            'component_breakdown' => 'array',
            'calculated_at' => 'datetime',
        ];
    }

    public function teacher(): BelongsTo
    {
        return $this->belongsTo(User::class, 'teacher_user_id');
    }
}
