<?php

namespace Tests\Feature\Platform;

use App\Models\ComplaintCategory;
use App\Services\AIAssistService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Collection;
use Tests\Feature\Platform\Concerns\SetsUpPlatformData;
use Tests\TestCase;

class AIAssistServiceTest extends TestCase
{
    use RefreshDatabase, SetsUpPlatformData;

    public function test_suggests_category_based_on_keywords(): void
    {
        ComplaintCategory::create(['name' => 'Transport', 'slug' => 'transport', 'is_active' => true]);
        ComplaintCategory::create(['name' => 'Fees', 'slug' => 'fees', 'is_active' => true]);

        $suggestion = app(AIAssistService::class)->suggestCategory(
            'Bus is always late',
            'The school bus consistently arrives 30 minutes late every morning.'
        );

        $this->assertNotNull($suggestion);
        $this->assertSame('Transport', $suggestion->name);
    }

    public function test_returns_null_suggestion_when_no_keywords_match(): void
    {
        ComplaintCategory::create(['name' => 'Fees', 'slug' => 'fees', 'is_active' => true]);

        $suggestion = app(AIAssistService::class)->suggestCategory('xyz', 'abc def ghi jkl');

        $this->assertNull($suggestion);
    }

    public function test_flags_a_highly_similar_recent_complaint_as_possible_duplicate(): void
    {
        $school = $this->makeSchool();
        $category = $this->makeCategory();

        $original = \App\Models\Complaint::create([
            'complaint_number' => \App\Models\Complaint::generateComplaintNumber($school->state, $school->district),
            'school_id' => $school->id,
            'complaint_category_id' => $category->id,
            'district_id' => $school->district_id,
            'state_id' => $school->state_id,
            'anonymous_ref' => 'ANON-ORIGINAL01',
            'submitted_role' => 'parent',
            'subject' => 'Bus late',
            'description' => 'The school bus arrives forty five minutes late almost every single school day this term.',
            'severity' => 'medium',
            'status' => 'submitted',
        ]);

        $duplicate = app(AIAssistService::class)->findPossibleDuplicate(
            $school,
            'The school bus arrives forty five minutes late almost every single school day this term.'
        );

        $this->assertNotNull($duplicate);
        $this->assertTrue($duplicate->is($original));
    }

    public function test_does_not_flag_dissimilar_complaints_as_duplicates(): void
    {
        $school = $this->makeSchool();
        $category = $this->makeCategory();

        \App\Models\Complaint::create([
            'complaint_number' => \App\Models\Complaint::generateComplaintNumber($school->state, $school->district),
            'school_id' => $school->id,
            'complaint_category_id' => $category->id,
            'district_id' => $school->district_id,
            'state_id' => $school->state_id,
            'anonymous_ref' => 'ANON-ORIGINAL02',
            'submitted_role' => 'parent',
            'subject' => 'Bus late',
            'description' => 'The school bus arrives forty five minutes late almost every single school day this term.',
            'severity' => 'medium',
            'status' => 'submitted',
        ]);

        $duplicate = app(AIAssistService::class)->findPossibleDuplicate(
            $school,
            'The cafeteria food has been cold and undercooked for the past two weeks.'
        );

        $this->assertNull($duplicate);
    }

    public function test_summarize_truncates_long_text(): void
    {
        $long = str_repeat('word ', 100);

        $summary = app(AIAssistService::class)->summarize($long, 50);

        $this->assertLessThanOrEqual(50, mb_strlen($summary));
        $this->assertStringEndsWith('…', $summary);
    }

    public function test_detects_feedback_spike_within_window(): void
    {
        $now = now();
        $timestamps = new Collection([
            $now, $now->copy()->addMinutes(1), $now->copy()->addMinutes(2),
            $now->copy()->addMinutes(3), $now->copy()->addMinutes(4),
        ]);

        $flagged = app(AIAssistService::class)->detectFeedbackSpike($timestamps, windowMinutes: 10, threshold: 5);

        $this->assertTrue($flagged);
    }

    public function test_does_not_flag_normally_spaced_feedback(): void
    {
        $now = now();
        $timestamps = new Collection([
            $now, $now->copy()->addDays(3), $now->copy()->addDays(6), $now->copy()->addDays(9),
        ]);

        $flagged = app(AIAssistService::class)->detectFeedbackSpike($timestamps, windowMinutes: 10, threshold: 5);

        $this->assertFalse($flagged);
    }
}
