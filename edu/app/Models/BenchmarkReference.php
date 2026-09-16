<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;

/**
 * Spec section 3. A published, dated description of what a high-performing
 * system does — never what it scored. See the migration for why this class
 * has no numeric field.
 */
#[Fillable([
    'dimension', 'system_name', 'system_type', 'practice', 'relevance',
    'source_name', 'source_url', 'source_year', 'source_verified',
])]
class BenchmarkReference extends Model
{
    /**
     * Dimensions, aligned with the School Quality Index (section 14) so the
     * platform's own measured data can sit beside the structural comparison
     * without a translation step.
     */
    public const DIMENSIONS = [
        'teaching_quality' => 'Teaching & teacher quality',
        'holistic_assessment' => 'Holistic assessment',
        'tracking_and_streaming' => 'Ability grouping & streaming',
        'digital_access' => 'Digital access & curriculum',
        'student_wellbeing' => 'Student wellbeing',
        'grievance_and_accountability' => 'Grievance & accountability',
        'career_readiness' => 'Career & life readiness',
    ];

    protected $attributes = ['system_type' => 'country', 'source_verified' => false];

    protected function casts(): array
    {
        return ['source_verified' => 'boolean'];
    }

    public function dimensionLabel(): string
    {
        return self::DIMENSIONS[$this->dimension] ?? $this->dimension;
    }

    /**
     * How a citation should be rendered. Always includes the year — an undated
     * claim about another country's system is not a benchmark.
     */
    public function citation(): string
    {
        return $this->source_name.' ('.$this->source_year.')';
    }
}
