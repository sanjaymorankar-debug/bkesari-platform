<?php

namespace App\Services;

use App\Models\StudentAcademicRecord;
use App\Models\TeacherEffectivenessScore;
use App\Models\TeacherRatingComponent;
use App\Models\TeacherSchoolRelationship;
use App\Models\User;

/**
 * Basic TEI (spec section AB): weighted average of per-dimension scores
 * from teacher_feedback.dimension_scores, weights from the admin-editable
 * teacher_rating_components table, blended with an approximate value-add
 * component from student_academic_records (see valueAddComponent()). Same
 * confidence heuristic as SQI.
 *
 * Deliberately NOT included yet (see ROADMAP.md): classroom observation,
 * professional development — spec section AC/AD call for these but they
 * need data sources this build doesn't have.
 */
class TeacherEffectivenessIndexService
{
    public function recalculate(User $teacher): TeacherEffectivenessScore
    {
        $components = TeacherRatingComponent::where('is_active', true)->get();
        $feedback = $teacher->receivedTeacherFeedback()->orderByDesc('submitted_at')->limit(500)->get();

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

        $valueAdd = $this->valueAddComponent($teacher);
        if ($valueAdd !== null) {
            $breakdown['value_add'] = $valueAdd;
            $weightedSum = ($weightedSum * 0.8) + ($valueAdd['scaled_score'] * 0.2);
        }

        $responseCount = $feedback->count();

        return TeacherEffectivenessScore::create([
            'teacher_user_id' => $teacher->id,
            'score' => round($weightedSum, 2),
            'confidence' => $this->confidenceFor($responseCount),
            'response_count' => $responseCount,
            'component_breakdown' => $breakdown,
            'calculated_at' => now(),
        ]);
    }

    /**
     * Approximate value-add: compares each student's earliest vs most recent
     * recorded score, in the teacher's own subject_specialization, at a
     * school the teacher is verified at. This is NOT a real teacher-to-
     * student roster linkage (none exists in this build) — it's a
     * school+subject proxy, documented here rather than presented as exact.
     * Contributes 20% of the blended score when data exists; feedback alone
     * still drives the score when it doesn't (e.g. no records logged yet).
     */
    private function valueAddComponent(User $teacher): ?array
    {
        $subject = $teacher->teacherProfile?->subject_specialization;
        if (! $subject) {
            return null;
        }

        $schoolIds = TeacherSchoolRelationship::where('user_id', $teacher->id)
            ->where('status', 'verified')->pluck('school_id');
        if ($schoolIds->isEmpty()) {
            return null;
        }

        $bySubject = StudentAcademicRecord::whereIn('school_id', $schoolIds)
            ->where('subject', $subject)
            ->orderBy('recorded_at')
            ->get()
            ->groupBy('student_user_id');

        $improvements = [];
        foreach ($bySubject as $studentRecords) {
            $sorted = $studentRecords->sortBy('recorded_at')->values();
            if ($sorted->count() < 2) {
                continue;
            }

            $first = $sorted->first();
            $last = $sorted->last();
            if ((float) $first->max_score <= 0 || (float) $last->max_score <= 0) {
                continue;
            }

            $firstPct = ((float) $first->score / (float) $first->max_score) * 100;
            $lastPct = ((float) $last->score / (float) $last->max_score) * 100;
            $improvements[] = $lastPct - $firstPct;
        }

        if (empty($improvements)) {
            return null;
        }

        $avgImprovement = array_sum($improvements) / count($improvements);
        // Maps a -20..+20 percentage-point swing onto 0..100, clamped at the edges.
        $scaled = max(0, min(100, 50 + ($avgImprovement * 2.5)));

        return [
            'label' => 'Student Score Improvement (approx.)',
            'average_improvement_pct' => round($avgImprovement, 2),
            'scaled_score' => round($scaled, 2),
            'student_count' => count($improvements),
            'source' => 'academic_records',
            'note' => "Approximation: compares each student's earliest vs latest recorded score in {$subject} at the teacher's school — not a verified teacher-student roster link.",
        ];
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
