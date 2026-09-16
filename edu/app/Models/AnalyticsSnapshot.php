<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;

#[Fillable(['scope', 'scope_id', 'metrics', 'calculated_at'])]
class AnalyticsSnapshot extends Model
{
    protected function casts(): array
    {
        return [
            'metrics' => 'array',
            'calculated_at' => 'datetime',
        ];
    }

    public static function latestNational(): ?self
    {
        return static::where('scope', 'national')->latest('calculated_at')->first();
    }

    public static function latestForState(int $stateId): ?self
    {
        return static::where('scope', 'state')->where('scope_id', $stateId)->latest('calculated_at')->first();
    }
}
