<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'student_user_id', 'granted_by_user_id', 'purpose', 'notice_text',
    'notice_version', 'status', 'verification_method', 'granted_at',
    'withdrawn_at', 'expires_at', 'ip_address',
])]
class ConsentRecord extends Model
{
    /**
     * The purposes a guardian can consent to, with the plain-language notice
     * shown at the point of consent. DPDP requires the notice to say what is
     * collected and why, in terms the person actually reading it understands.
     */
    public const PURPOSES = [
        'capability_growth' => [
            'label' => 'Growth & capability observations',
            'notice' => 'Teachers, and you, can record short notes about what your child is doing well and what they could use support with, across learning, social-emotional, creative, physical and life-skills areas. These notes are dated observations of moments — never a score, a grade, or a permanent label. They are visible to you, to your child\'s teachers at this school, and to your child in an age-appropriate form. They are never public, never shown to other parents or students, and never used to place your child in an ability group.',
        ],
        'career_pathway' => [
            'label' => 'Career interest exploration',
            'notice' => 'Your child can record what subjects and activities they enjoy, revisited each term as their interests change. The platform may show broad career and study areas to explore based on this. These are always options to look at, never an assigned track, and never a prediction about what your child will become.',
        ],
        'life_skills' => [
            'label' => 'Life-skills participation',
            'notice' => 'The school can record which life-skills activities your child took part in — for example financial literacy, online safety, or civic education — and how they engaged. This records participation only. It is not a test and produces no score.',
        ],
        'physical_health' => [
            'label' => 'Physical health records',
            'notice' => 'School health screenings and related records. Visible only to you, your child, and authorised school health staff.',
        ],
        'mental_wellbeing' => [
            'label' => 'Wellbeing & counselling records',
            'notice' => 'Records kept by an authorised counsellor. Held under a stricter confidentiality tier than other records.',
        ],
        'alumni_outcomes' => [
            'label' => 'Post-school outcomes (optional)',
            'notice' => 'After your child leaves school, broad outcome information (further study, work sector) may be counted in anonymous totals that help schools and government understand whether students go on to good outcomes. Separate and entirely optional.',
        ],
    ];

    protected function casts(): array
    {
        return [
            'granted_at' => 'datetime',
            'withdrawn_at' => 'datetime',
            'expires_at' => 'datetime',
        ];
    }

    public function student(): BelongsTo
    {
        return $this->belongsTo(User::class, 'student_user_id');
    }

    public function grantedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'granted_by_user_id');
    }

    /**
     * Consent that is currently in force — granted, not withdrawn, not past
     * its expiry. Everything that reads or writes a child's development data
     * funnels through this scope via ConsentService.
     */
    public function scopeInForce(Builder $query): Builder
    {
        return $query->where('status', 'granted')
            ->where(function (Builder $q) {
                $q->whereNull('expires_at')->orWhere('expires_at', '>', now());
            });
    }

    public function isInForce(): bool
    {
        return $this->status === 'granted'
            && ($this->expires_at === null || $this->expires_at->isFuture());
    }
}
