<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

#[Fillable(['user_id', 'school_id', 'context', 'anonymous_ref'])]
class AnonymousIdentity extends Model
{
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function school(): BelongsTo
    {
        return $this->belongsTo(School::class);
    }

    /**
     * A pseudonym with no reversible structure of its own — the only way
     * back to a user is the anonymous_identities row itself, which is why
     * every read of it goes through IdentityAccessLog.
     */
    public static function generateRef(): string
    {
        return 'ANON-'.strtoupper(Str::random(12));
    }
}
