<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['complaint_id', 'uploaded_by', 'original_filename', 'stored_filename', 'mime_type', 'size_bytes', 'disk'])]
class ComplaintEvidence extends Model
{
    public function complaint(): BelongsTo
    {
        return $this->belongsTo(Complaint::class);
    }
}
