<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['complaint_id', 'responder_type', 'responder_user_id', 'message'])]
class ComplaintResponse extends Model
{
    public function complaint(): BelongsTo
    {
        return $this->belongsTo(Complaint::class);
    }

    public function responder(): BelongsTo
    {
        return $this->belongsTo(User::class, 'responder_user_id');
    }
}
