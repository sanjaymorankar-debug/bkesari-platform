<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['complaint_id', 'resolution_summary', 'confirmed_by_submitter', 'confirmed_at', 'escalated'])]
class ComplaintResolution extends Model
{
    protected function casts(): array
    {
        return [
            'confirmed_at' => 'datetime',
            'escalated' => 'boolean',
        ];
    }

    public function complaint(): BelongsTo
    {
        return $this->belongsTo(Complaint::class);
    }
}
