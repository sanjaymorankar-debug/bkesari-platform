<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['flag_type', 'subject_type', 'subject_id', 'details', 'status', 'reviewed_by_user_id', 'reviewed_at'])]
class FraudFlag extends Model
{
    protected function casts(): array
    {
        return [
            'details' => 'array',
            'reviewed_at' => 'datetime',
        ];
    }

    public function reviewedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reviewed_by_user_id');
    }

    /**
     * Resolves the flagged School or teacher User — subject_type/subject_id
     * isn't a real polymorphic pair since only two fixed subject types
     * exist, kept simple rather than reaching for morphTo.
     */
    public function subject(): School|User|null
    {
        return match ($this->subject_type) {
            'school' => School::find($this->subject_id),
            'teacher' => User::find($this->subject_id),
            default => null,
        };
    }
}
