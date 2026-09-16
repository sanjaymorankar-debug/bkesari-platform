<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Collection;

/** Spec section 12. Stores `anonymous_ref`, never a `user_id`. */
#[Fillable([
    'course_id', 'school_id', 'academic_year', 'anonymous_ref', 'rater_role',
    'curriculum_relevance', 'course_quality', 'conceptual_learning',
    'practical_learning', 'project_work', 'learning_resources',
    'teaching_quality', 'course_organisation', 'engagement',
    'career_relevance', 'comment', 'submitted_at',
])]
class CourseRating extends Model
{
    /** Section 12's own list, in the order it gives them. */
    public const DIMENSIONS = [
        'curriculum_relevance' => 'Relevance of what is taught',
        'course_quality' => 'Overall course quality',
        'conceptual_learning' => 'Understanding of concepts',
        'practical_learning' => 'Practical, hands-on learning',
        'project_work' => 'Project work',
        'learning_resources' => 'Learning resources',
        'teaching_quality' => 'Teaching quality',
        'course_organisation' => 'How well organised it is',
        'engagement' => 'How engaging it is',
        'career_relevance' => 'Usefulness for the future',
    ];

    /**
     * Dimensions a parent is usually in a position to judge.
     *
     * A parent rarely sees project work or classroom resources first-hand.
     * Asking anyway would manufacture data, so the form shows students the
     * full list and parents this subset — and the rest stay null rather than
     * being filled with a guess.
     */
    public const PARENT_DIMENSIONS = [
        'curriculum_relevance', 'course_quality', 'teaching_quality',
        'course_organisation', 'engagement', 'career_relevance',
    ];

    protected function casts(): array
    {
        return ['submitted_at' => 'datetime'];
    }

    public function course(): BelongsTo
    {
        return $this->belongsTo(Course::class);
    }

    public function school(): BelongsTo
    {
        return $this->belongsTo(School::class);
    }

    /**
     * Per-dimension averages across a set of ratings.
     *
     * Each dimension reports its own response count, because they differ: a
     * course rated by twenty parents and two students has a well-supported
     * teaching-quality figure and a thin project-work one, and a single
     * blended average would hide that.
     *
     * @param  Collection<int, CourseRating>  $ratings
     * @return array<string, array{label: string, average: float|null, responses: int}>
     */
    public static function averages(Collection $ratings): array
    {
        $result = [];

        foreach (self::DIMENSIONS as $key => $label) {
            $scores = $ratings->pluck($key)->filter(fn ($value): bool => $value !== null);

            $result[$key] = [
                'label' => $label,
                'average' => $scores->isEmpty() ? null : round($scores->avg(), 2),
                'responses' => $scores->count(),
            ];
        }

        return $result;
    }
}
