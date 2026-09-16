<?php

namespace Tests\Feature\Platform;

use App\Models\Complaint;
use App\Models\FacilityRating;
use App\Models\School;
use App\Services\SchoolImprovementService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Livewire\Volt\Volt;
use Tests\Feature\Platform\Concerns\SetsUpPlatformData;
use Tests\TestCase;

/**
 * Spec section 31 — "Trend, not just snapshot… The platform's purpose is to
 * measure improvement, not only surface criticism."
 */
class SchoolImprovementTest extends TestCase
{
    use RefreshDatabase, SetsUpPlatformData;

    private function rateFacility(School $school, string $year, string $report, int $count, string $prefix = ''): void
    {
        for ($i = 0; $i < $count; $i++) {
            FacilityRating::create([
                'school_id' => $school->id,
                'facility_key' => 'library',
                'academic_year' => $year,
                'anonymous_ref' => 'ANON-'.$prefix.$year.$i,
                'rater_role' => 'parent',
                'availability_report' => $report,
                'submitted_at' => now(),
            ]);
        }
    }

    private function service(): SchoolImprovementService
    {
        return app(SchoolImprovementService::class);
    }

    /** One year is a snapshot. Drawing an arrow from it would invent a direction. */
    public function test_a_single_year_is_not_reported_as_a_trend(): void
    {
        $school = $this->makeSchool();
        $this->rateFacility($school, '2026-27', 'available', 10);

        $trend = $this->service()->trends($school->id)['facility_availability'];

        $this->assertSame('insufficient', $trend['direction']);
        $this->assertStringContainsString('Not enough years', $trend['direction_label']);
    }

    public function test_two_years_of_improvement_are_reported_as_improvement(): void
    {
        $school = $this->makeSchool();

        $this->rateFacility($school, '2025-26', 'not_available', 8, 'a');
        $this->rateFacility($school, '2026-27', 'available', 8, 'b');

        $trend = $this->service()->trends($school->id)['facility_availability'];

        $this->assertSame('up', $trend['direction']);
        $this->assertSame(0.0, $trend['points'][0]['value']);
        $this->assertSame(100.0, $trend['points'][1]['value']);
    }

    public function test_a_decline_is_reported_honestly(): void
    {
        $school = $this->makeSchool();

        $this->rateFacility($school, '2025-26', 'available', 8, 'a');
        $this->rateFacility($school, '2026-27', 'not_available', 8, 'b');

        $this->assertSame('down', $this->service()->trends($school->id)['facility_availability']['direction']);
    }

    /** A movement from a handful of responses is not a direction. */
    public function test_a_movement_from_too_few_responses_is_not_called(): void
    {
        $school = $this->makeSchool();

        $this->rateFacility($school, '2025-26', 'not_available', 2, 'a');
        $this->rateFacility($school, '2026-27', 'available', 2, 'b');

        $trend = $this->service()->trends($school->id)['facility_availability'];

        $this->assertSame('uncertain', $trend['direction']);
        $this->assertStringContainsString('Too few responses', $trend['direction_label']);
    }

    public function test_a_tiny_movement_is_treated_as_noise(): void
    {
        $school = $this->makeSchool();

        // 10 available in one year; 9 available + 1 partial the next — a
        // 5-point move that should not be dressed up as a direction... but is
        // above the threshold, so use a genuinely tiny one instead.
        $this->rateFacility($school, '2025-26', 'available', 10, 'a');
        $this->rateFacility($school, '2026-27', 'available', 10, 'b');

        $this->assertSame('flat', $this->service()->trends($school->id)['facility_availability']['direction']);
    }

    // ---------------------------------------------------------------
    //  Direction is not the same as good or bad
    // ---------------------------------------------------------------

    /**
     * The judgement call that matters most here. A school whose complaint
     * count rises may be getting worse, or may be one where families finally
     * believe reporting is safe — and a count cannot tell those apart.
     * Presenting a rise as a quality decline would punish the schools that
     * built enough trust for people to speak up.
     */
    public function test_rising_complaint_volume_is_never_labelled_a_decline(): void
    {
        $school = $this->makeSchool();
        $category = $this->makeCategory();
        $parent = $this->makeVerifiedParent($school);

        foreach ([['2025-07-01', 5], ['2026-07-01', 20]] as [$date, $count]) {
            for ($i = 0; $i < $count; $i++) {
                $complaint = Complaint::create([
                    'complaint_number' => 'C-'.$date.'-'.$i,
                    'school_id' => $school->id,
                    'district_id' => $school->district_id,
                    'state_id' => $school->state_id,
                    'complaint_category_id' => $category->id,
                    'anonymous_ref' => 'ANON-'.$i,
                    'submitted_role' => 'parent',
                    'subject' => 'A complaint',
                    'description' => 'Description of the issue raised.',
                    'status' => 'submitted',
                ]);

                // Laravel stamps created_at on insert, so backdate afterwards —
                // the academic-year grouping is the whole point of this test.
                $complaint->forceFill(['created_at' => $date])->saveQuietly();
            }
        }

        $trend = $this->service()->trends($school->id)['complaint_volume'];

        $this->assertSame('up', $trend['direction']);
        $this->assertSame('More than last year', $trend['direction_label']);

        // Never the words used for a quality series.
        $this->assertStringNotContainsString('worse', strtolower($trend['direction_label']));
        $this->assertStringNotContainsString('Higher is better', $trend['interpretation']);
        $this->assertStringContainsString('Neither good nor bad', $trend['interpretation']);
        $this->assertStringContainsString('trust the process', $trend['interpretation']);

        unset($parent);
    }

    public function test_quality_series_do_say_which_direction_is_better(): void
    {
        $school = $this->makeSchool();

        $this->assertStringContainsString(
            'Higher is better',
            $this->service()->trends($school->id)['facility_availability']['interpretation']
        );
    }

    /** Cost is shown for context, not scored as quality. */
    public function test_annual_cost_is_not_presented_as_a_quality_measure(): void
    {
        $school = $this->makeSchool();

        $this->assertStringContainsString(
            'Not a quality measure',
            $this->service()->trends($school->id)['annual_cost']['interpretation']
        );
    }

    /** A carried-over growth goal is a normal outcome, not a failure. */
    public function test_growth_goals_are_not_framed_as_targets_missed(): void
    {
        $school = $this->makeSchool();

        $this->assertStringContainsString(
            'not a failure',
            $this->service()->trends($school->id)['growth_goals']['interpretation']
        );
    }

    // ---------------------------------------------------------------
    //  The page
    // ---------------------------------------------------------------

    public function test_the_improvement_page_is_public(): void
    {
        // Improvement should be as visible as criticism; a trend view only the
        // school can see would defeat the point.
        $school = $this->makeSchool();

        $this->get(route('improvement.show', $school))->assertOk();
    }

    public function test_the_page_says_it_compares_a_school_against_its_own_history(): void
    {
        $school = $this->makeSchool();

        Volt::test('improvement.show', ['school' => $school])
            ->assertOk()
            ->assertSee('its own history')
            ->assertSee('not against other');
    }

    public function test_the_page_shows_each_year_with_the_records_behind_it(): void
    {
        $school = $this->makeSchool();

        $this->rateFacility($school, '2025-26', 'not_available', 8, 'a');
        $this->rateFacility($school, '2026-27', 'available', 8, 'b');

        Volt::test('improvement.show', ['school' => $school])
            ->assertOk()
            ->assertSee('2025-26')
            ->assertSee('2026-27')
            ->assertSee('8 records');
    }

    public function test_a_school_with_no_history_says_so_rather_than_showing_zero(): void
    {
        $school = $this->makeSchool();

        Volt::test('improvement.show', ['school' => $school])
            ->assertOk()
            ->assertSee('Nothing recorded yet')
            ->assertSee('Not enough years yet');
    }
}
