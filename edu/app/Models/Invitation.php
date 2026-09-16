<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

#[Fillable(['school_id', 'invited_by_user_id', 'email', 'role', 'student_name', 'token', 'status', 'accepted_by_user_id', 'accepted_at'])]
class Invitation extends Model
{
    protected function casts(): array
    {
        return ['accepted_at' => 'datetime'];
    }

    public function school(): BelongsTo
    {
        return $this->belongsTo(School::class);
    }

    public function invitedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'invited_by_user_id');
    }

    public function acceptedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'accepted_by_user_id');
    }

    public static function generateToken(): string
    {
        return Str::random(48);
    }
}
