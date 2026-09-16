<?php

namespace App\Services;

use App\Models\School;
use App\Models\SchoolQualityScore;
use App\Models\SchoolRatingComponent;

/**
 * Basic SQI (spec section W/X/Y): weighted average of per-dimension scores
 * pulled from school_feedback.dimension_scores, weights loaded from the
 * admin-editable school_rating_components table rather than hard-coded.
 * Confidence is a simple response-volume heuristic, not a statistical model
 * — good enough for a test/demo dataset, documented as such in ROADMAP.md.
 */
class SchoolQualityIndexService
{
    public function recalculate(School $school): SchoolQualityScore
    {
        $components = SchoolRatingComponent::where('is_active', true)->get();
        $feedback = $school->feedback()->orderByDesc('submitted_at')->limit(500)->get();

        $totalWeight = $components->sum('weight');
        $breakdown = [];
        $weightedSum = 0.0;

        foreach ($components as $component) {
            $scores = $feedback
                ->pluck('dimension_scores.'.$component->key)
                ->filter(fn ($v) => $v !== null);

            $average = $scores->isNotEmpty() ? round($scores->avg(), 2) : null;
            $breakdown[$component->key] = [
                'label' => $component->label,
                'weight' => (float) $component->weight,
                'average' => $average,
                'response_count' => $scores->count(),
            ];

            if ($average !== null && $totalWeight > 0) {
                $weightedSum += ($average / 5) * 100 * ((float) $component->weight / $totalWeight);
            }
        }

        $responseCount = $feedback->count();

        return SchoolQualityScore::create([
            'school_id' => $school->id,
            'score' => round($weightedSum, 2),
            'confidence' => $this->confidenceFor($responseCount),
            'response_count' => $responseCount,
            'component_breakdown' => $breakdown,
            'calculated_at' => now(),
        ]);
    }

    private function confidenceFor(int $responseCount): string
    {
        return match (true) {
            $responseCount >= 30 => 'high',
            $responseCount >= 10 => 'medium',
            $responseCount >= 1 => 'low',
            default => 'insufficient_data',
        };
    }
}
