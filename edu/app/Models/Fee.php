<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable([
    'school_id', 'academic_year', 'class_grade', 'stream', 'category', 'label',
    'amount', 'frequency', 'is_mandatory', 'is_refundable', 'conditions',
    'effective_from', 'state_cap_status', 'recorded_by_user_id',
])]
class Fee extends Model
{
    /** Spec section 9's fee categories, with parent-facing labels. */
    public const CATEGORIES = [
        'admission' => 'Admission',
        'registration' => 'Registration',
        'tuition' => 'Tuition',
        'annual' => 'Annual charges',
        'development' => 'Development',
        'term' => 'Term / semester',
        'examination' => 'Examination',
        'assessment' => 'Assessment',
        'laboratory' => 'Laboratory',
        'computer' => 'Computer / technology',
        'library' => 'Library',
        'sports' => 'Sports',
        'activity' => 'Activities',
        'transport' => 'Transport',
        'hostel' => 'Hostel',
        'meals' => 'Meals',
        'books' => 'Books',
        'uniform' => 'Uniform',
        'id_card' => 'ID card',
        'diary' => 'Diary',
        'field_trips' => 'Field trips',
        'competitions' => 'Competitions',
        'external_exam' => 'External exam fee',
        'certification' => 'Certification',
        'coaching' => 'Coaching / preparation',
        'other' => 'Other charges',
    ];

    public const FREQUENCIES = [
        'one_time' => 'One time',
        'monthly' => 'Per month',
        'quarterly' => 'Per quarter',
        'term' => 'Per term',
        'annual' => 'Per year',
    ];

    public const CAP_STATUSES = [
        'not_applicable' => 'No state cap recorded',
        'within_cap' => 'Within state-approved cap',
        'pending_review' => 'Pending committee review',
        'exceeds_cap' => 'Reported above state cap',
    ];

    protected function casts(): array
    {
        return [
            'amount' => 'decimal:2',
            'is_mandatory' => 'boolean',
            'is_refundable' => 'boolean',
            'effective_from' => 'date',
        ];
    }

    public function school(): BelongsTo
    {
        return $this->belongsTo(School::class);
    }

    public function recordedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'recorded_by_user_id');
    }

    public function revisions(): HasMany
    {
        return $this->hasMany(FeeRevision::class);
    }

    public function categoryLabel(): string
    {
        return self::CATEGORIES[$this->category] ?? $this->category;
    }

    public function frequencyLabel(): string
    {
        return self::FREQUENCIES[$this->frequency] ?? $this->frequency;
    }
}
