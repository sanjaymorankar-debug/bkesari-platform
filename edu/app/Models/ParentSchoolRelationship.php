<?php

namespace App\Models;

use App\Models\Concerns\RecordsVerificationDecision;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['user_id', 'school_id', 'student_user_id', 'status', 'verified_at'])]
class ParentSchoolRelationship extends Model
{
    use RecordsVerificationDecision;

    protected function casts(): array
    {
        return [
            'verified_at' => 'datetime',
            'decided_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function school(): BelongsTo
    {
        return $this->belongsTo(School::class);
    }

    public function student(): BelongsTo
    {
        return $this->belongsTo(User::class, 'student_user_id');
    }
}
