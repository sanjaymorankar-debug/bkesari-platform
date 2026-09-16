<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'student_user_id', 'school_id', 'recorded_by_user_id', 'skill_area',
    'activity_title', 'activity_description', 'participation_level',
    'academic_term', 'recorded_on',
])]
class LifeSkillRecord extends Model
{
    protected $table = 'life_skills_tracking';

    public const SKILL_AREAS = [
        'financial_literacy' => 'Financial literacy',
        'digital_literacy_safety' => 'Digital literacy & online safety',
        'civic_citizenship' => 'Civic education & citizenship',
        'communication' => 'Communication',
        'leadership' => 'Leadership',
        'critical_thinking' => 'Critical thinking',
        'emotional_intelligence' => 'Emotional intelligence',
        'environmental_awareness' => 'Environment & sustainability',
    ];

    public const PARTICIPATION_LEVELS = [
        'participated' => 'Took part',
        'engaged' => 'Actively engaged',
        'led' => 'Led or helped run it',
    ];

    protected function casts(): array
    {
        return ['recorded_on' => 'date'];
    }

    public function student(): BelongsTo
    {
        return $this->belongsTo(User::class, 'student_user_id');
    }

    public function school(): BelongsTo
    {
        return $this->belongsTo(School::class);
    }

    public function recordedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'recorded_by_user_id');
    }

    public function skillAreaLabel(): string
    {
        return self::SKILL_AREAS[$this->skill_area] ?? $this->skill_area;
    }

    public function participationLabel(): string
    {
        return self::PARTICIPATION_LEVELS[$this->participation_level] ?? $this->participation_level;
    }
}
