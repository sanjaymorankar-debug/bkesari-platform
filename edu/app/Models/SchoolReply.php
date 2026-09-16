<?php

namespace App\Models;

use App\Support\FacilityTaxonomy;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Spec section 29. Append-only — see the migration for why.
 */
#[Fillable([
    'school_id', 'context_type', 'context_key', 'academic_year', 'body',
    'author_user_id',
])]
class SchoolReply extends Model
{
    public const CONTEXT_TYPES = [
        'facility_discrepancy' => 'A facility families reported differently',
        'course_feedback' => 'Feedback on a course',
        'general_feedback' => 'General feedback about the school',
    ];

    public function school(): BelongsTo
    {
        return $this->belongsTo(School::class);
    }

    public function author(): BelongsTo
    {
        return $this->belongsTo(User::class, 'author_user_id');
    }

    public function course(): BelongsTo
    {
        return $this->belongsTo(Course::class, 'context_key');
    }

    /** What this reply is answering, in words a reader will recognise. */
    public function subjectLabel(): string
    {
        return match ($this->context_type) {
            'facility_discrepancy' => FacilityTaxonomy::label((string) $this->context_key),
            'course_feedback' => Course::find($this->context_key)?->name ?? 'A course',
            default => 'Feedback about the school',
        };
    }
}
