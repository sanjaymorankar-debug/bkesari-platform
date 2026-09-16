<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'student_user_id', 'captured_by_user_id', 'academic_term',
    'interest_areas', 'enjoyed_activities', 'reflection', 'captured_on',
])]
class CareerInterestProfile extends Model
{
    /**
     * Child-facing interest areas rather than job titles or aptitude bands.
     * A 12-year-old picking "building and making things" is describing what
     * they enjoy today, which is all this is allowed to mean.
     */
    public const INTEREST_AREAS = [
        'building_making' => 'Building and making things',
        'helping_people' => 'Helping and caring for people',
        'numbers_patterns' => 'Numbers, patterns and puzzles',
        'nature_environment' => 'Nature, animals and the environment',
        'words_stories' => 'Words, stories and languages',
        'art_design' => 'Art, design and visual things',
        'music_performance' => 'Music, dance and performing',
        'computers_technology' => 'Computers and technology',
        'organising_leading' => 'Organising things and leading others',
        'science_experiments' => 'Science and finding out how things work',
        'sport_movement' => 'Sport and physical activity',
        'business_trade' => 'Business, buying and selling',
    ];

    protected function casts(): array
    {
        return [
            'interest_areas' => 'array',
            'enjoyed_activities' => 'array',
            'captured_on' => 'date',
        ];
    }

    public function student(): BelongsTo
    {
        return $this->belongsTo(User::class, 'student_user_id');
    }

    public function capturedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'captured_by_user_id');
    }

    public function interestLabels(): array
    {
        return array_map(
            fn (string $key): string => self::INTEREST_AREAS[$key] ?? $key,
            $this->interest_areas ?? []
        );
    }
}
