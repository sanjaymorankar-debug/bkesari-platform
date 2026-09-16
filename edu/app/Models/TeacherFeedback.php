<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['teacher_user_id', 'school_id', 'anonymous_ref', 'rater_role', 'dimension_scores', 'overall_comment', 'submitted_at'])]
class TeacherFeedback extends Model
{
    protected function casts(): array
    {
        return [
            'dimension_scores' => 'array',
            'submitted_at' => 'datetime',
        ];
    }

    public function teacher(): BelongsTo
    {
        return $this->belongsTo(User::class, 'teacher_user_id');
    }

    public function school(): BelongsTo
    {
        return $this->belongsTo(School::class);
    }
}
