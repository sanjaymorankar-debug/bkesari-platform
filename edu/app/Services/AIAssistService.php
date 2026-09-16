<?php

namespace App\Services;

use App\Models\Complaint;
use App\Models\ComplaintCategory;
use App\Models\RetaliationReport;
use App\Models\School;
use Illuminate\Support\Collection;

/**
 * AI-assisted features (spec section AF): categorization, duplicate
 * detection, summarization. No AI provider API key is configured for this
 * environment (see SETUP_REQUIRED.md) — every method here is a rule-based
 * stand-in, not a real model call. This class is the seam where a real
 * provider integration would plug in later without touching call sites.
 *
 * Hard constraint from spec section AF: AI may only suggest. It must never
 * determine guilt, punish a school, or make a final decision — every method
 * here returns an advisory value the human submitter/reviewer can ignore or
 * override, nothing is auto-applied.
 */
class AIAssistService
{
    /**
     * Suggests a complaint category by keyword overlap with each active
     * category's name — a human still picks the final category in the form.
     */
    public function suggestCategory(string $subject, string $description): ?ComplaintCategory
    {
        $text = strtolower($subject.' '.$description);

        $keywordMap = [
            'teaching' => ['teaching', 'curriculum', 'syllabus', 'lesson'],
            'teacher-behaviour' => ['teacher behavior', 'teacher behaviour', 'rude teacher', 'shouted'],
            'fees' => ['fee', 'fees', 'payment', 'receipt', 'refund'],
            'books' => ['book', 'books', 'textbook'],
            'uniform' => ['uniform'],
            'stationery' => ['stationery', 'stationary supplies'],
            'transport' => ['bus', 'transport', 'van', 'pickup'],
            'infrastructure' => ['building', 'infrastructure', 'classroom condition', 'toilet', 'washroom'],
            'safety' => ['safety', 'unsafe', 'danger', 'injury'],
            'bullying' => ['bully', 'bullying', 'bullied'],
            'harassment' => ['harass'],
            'discrimination' => ['discriminat'],
            'food' => ['food', 'canteen', 'meal', 'lunch'],
            'hygiene' => ['hygiene', 'unclean', 'dirty'],
            'sports' => ['sport', 'sports', 'playground', 'ground'],
            'counselling' => ['counsel', 'mental health'],
            'special-needs' => ['special need', 'disability', 'accommodation'],
            'attendance' => ['attendance', 'absent'],
            'communication' => ['communication', 'no response', 'unresponsive'],
            'management' => ['management', 'principal', 'administration'],
            'career-guidance' => ['career', 'guidance counsel'],
        ];

        $bestSlug = null;
        $bestScore = 0;

        foreach ($keywordMap as $slug => $keywords) {
            $score = collect($keywords)->filter(fn ($kw) => str_contains($text, $kw))->count();
            if ($score > $bestScore) {
                $bestScore = $score;
                $bestSlug = $slug;
            }
        }

        return $bestSlug ? ComplaintCategory::where('slug', 'like', $bestSlug.'%')->first() : null;
    }

    /**
     * Flags complaints at the same school, submitted within the lookback
     * window, whose description is textually very similar — advisory only,
     * shown to the submitter as "you may be reporting the same thing as
     * complaint #X", never blocks submission.
     */
    public function findPossibleDuplicate(School $school, string $description, int $lookbackDays = 14): ?Complaint
    {
        $candidates = Complaint::where('school_id', $school->id)
            ->where('created_at', '>=', now()->subDays($lookbackDays))
            ->get();

        foreach ($candidates as $candidate) {
            similar_text(strtolower($description), strtolower($candidate->description), $percent);
            if ($percent >= 70.0) {
                return $candidate;
            }
        }

        return null;
    }

    /**
     * Advisory check on the school-registration form: warns a registrant if
     * a similarly-named school already exists in the same city, to catch
     * accidental duplicate registrations before they create two School Admin
     * accounts for the same physical school. Never blocks submission.
     */
    public function findPossibleDuplicateSchool(string $name, string $city): ?School
    {
        if (trim($name) === '' || trim($city) === '') {
            return null;
        }

        $candidates = School::where('city', $city)->get();

        foreach ($candidates as $candidate) {
            similar_text(strtolower($name), strtolower($candidate->name), $percent);
            if ($percent >= 80.0) {
                return $candidate;
            }
        }

        return null;
    }

    /**
     * Same textual-similarity heuristic as findPossibleDuplicate(), applied
     * to retaliation reports at the same school instead of complaints.
     */
    public function findPossibleDuplicateRetaliationReport(School $school, string $description, int $lookbackDays = 30): ?RetaliationReport
    {
        $candidates = RetaliationReport::where('school_id', $school->id)
            ->where('created_at', '>=', now()->subDays($lookbackDays))
            ->get();

        foreach ($candidates as $candidate) {
            similar_text(strtolower($description), strtolower($candidate->description), $percent);
            if ($percent >= 70.0) {
                return $candidate;
            }
        }

        return null;
    }

    /**
     * One-sentence summary for dashboard lists — naive truncation, not a
     * real abstractive summary.
     */
    public function summarize(string $text, int $maxLength = 140): string
    {
        $text = trim(preg_replace('/\s+/', ' ', $text));

        if (mb_strlen($text) <= $maxLength) {
            return $text;
        }

        return mb_substr($text, 0, $maxLength - 1).'…';
    }

    /**
     * Coordinated-review heuristic: flags a school if an unusual share of
     * its recent feedback rows arrived within a short window of each other.
     * A crude anti-manipulation signal (spec section AE) — flags for human
     * review, never auto-removes anything.
     */
    public function detectFeedbackSpike(Collection $submittedAtTimestamps, int $windowMinutes = 10, int $threshold = 5): bool
    {
        $sorted = $submittedAtTimestamps->sort()->values();

        for ($i = 0; $i < $sorted->count(); $i++) {
            $windowEnd = $sorted[$i]->copy()->addMinutes($windowMinutes);
            $countInWindow = $sorted->slice($i)->takeWhile(fn ($t) => $t->lte($windowEnd))->count();

            if ($countInWindow >= $threshold) {
                return true;
            }
        }

        return false;
    }
}
