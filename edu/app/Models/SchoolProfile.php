<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['school_id', 'about', 'facilities', 'sports', 'fees', 'policies', 'has_transport', 'has_hostel'])]
class SchoolProfile extends Model
{
    protected function casts(): array
    {
        return [
            'facilities' => 'array',
            'sports' => 'array',
            'fees' => 'array',
            'has_transport' => 'boolean',
            'has_hostel' => 'boolean',
        ];
    }

    public function school(): BelongsTo
    {
        return $this->belongsTo(School::class);
    }
}
