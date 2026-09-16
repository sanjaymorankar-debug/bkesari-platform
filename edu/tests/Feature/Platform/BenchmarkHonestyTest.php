<?php

namespace Tests\Feature\Platform;

use App\Models\BenchmarkReference;
use App\Services\BenchmarkService;
use Database\Seeders\BenchmarkReferenceSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;
use Livewire\Volt\Volt;
use Tests\Feature\Platform\Concerns\SetsUpPlatformData;
use Tests\TestCase;

/**
 * Spec section 3 and rule 44 — "never fabricate an international benchmark
 * score India has not produced".
 *
 * These tests are almost entirely about what the page must NOT do.
 */
class BenchmarkHonestyTest extends TestCase
{
    use RefreshDatabase, SetsUpPlatformData;

    /**
     * The structural enforcement: there is nowhere to put a score, so an
     * invented ranking cannot be stored even by mistake.
     */
    public function test_the_reference_table_has_no_numeric_score_column(): void
    {
        $columns = Schema::getColumnListing('benchmark_references');

        foreach (['score', 'rank', 'ranking', 'value', 'points', 'percentile', 'index'] as $forbidden) {
            $this->assertNotContains(
                $forbidden,
                $columns,
                "benchmark_references must never carry '{$forbidden}' — spec rule 44 forbids fabricating an "
                    .'international benchmark score.'
            );
        }
    }

    public function test_the_platform_states_it_does_not_participate_in_pisa(): void
    {
        $this->assertFalse(BenchmarkService::INTERNATIONAL_ASSESSMENT_POSITION['participates_in_pisa']);
    }

    /** The limitation is the headline, not a footnote. */
    public function test_the_page_leads_with_the_absence_of_a_pisa_score(): void
    {
        Volt::test('benchmarks.index')
            ->assertOk()
            ->assertSee('There is no Indian PISA score on this page')
            ->assertSee('does not currently participate in PISA');
    }

    public function test_the_page_never_shows_an_indian_rank(): void
    {
        $this->seed(BenchmarkReferenceSeeder::class);

        $component = Volt::test('benchmarks.index')->assertOk();

        foreach (['PISA rank', 'India ranks', 'ranked #', 'India scored'] as $forbidden) {
            $component->assertDontSee($forbidden);
        }
    }

    public function test_the_page_says_what_it_deliberately_does_not_do(): void
    {
        Volt::test('benchmarks.index')
            ->assertOk()
            ->assertSee('does not rank Indian schools against schools in other countries')
            ->assertSee('does not compare any individual child');
    }

    // ---------------------------------------------------------------
    //  Provenance: measured vs structural must stay distinguishable
    // ---------------------------------------------------------------

    public function test_measured_data_and_structural_practice_are_labelled_separately(): void
    {
        $this->seed(BenchmarkReferenceSeeder::class);

        Volt::test('benchmarks.index')
            ->assertOk()
            ->assertSee('Measured here')
            ->assertSee('What other systems do')
            ->assertSee('Never what');
    }

    public function test_every_domestic_measure_declares_its_provenance_and_coverage(): void
    {
        $this->makeSchool();

        foreach (app(BenchmarkService::class)->domesticMeasures() as $measure) {
            $this->assertContains($measure['provenance'], ['platform_measured', 'school_reported']);
            $this->assertNotSame('', $measure['coverage']);
            $this->assertArrayHasKey('meaningful', $measure);
        }
    }

    /**
     * A percentage drawn from a handful of schools must not read as a national
     * statistic — the platform has ~20 schools, nowhere near the threshold.
     */
    public function test_thin_coverage_is_flagged_rather_than_presented_as_national(): void
    {
        $this->makeSchool();

        $measures = collect(app(BenchmarkService::class)->domesticMeasures());
        $adoption = $measures->firstWhere('label', 'Schools using holistic growth plans');

        $this->assertFalse($adoption['meaningful']);

        Volt::test('benchmarks.index')
            ->assertOk()
            ->assertSee('too little data to read as representative');
    }

    public function test_school_reported_figures_are_not_presented_as_verified(): void
    {
        $this->makeSchool();

        $measures = collect(app(BenchmarkService::class)->domesticMeasures());
        $ratio = $measures->firstWhere('label', 'Students per teacher');

        $this->assertSame('school_reported', $ratio['provenance']);

        Volt::test('benchmarks.index')
            ->assertOk()
            ->assertSee('not independently verified');
    }

    // ---------------------------------------------------------------
    //  Citations
    // ---------------------------------------------------------------

    public function test_every_seeded_reference_is_sourced_and_dated(): void
    {
        $this->seed(BenchmarkReferenceSeeder::class);

        $this->assertGreaterThan(0, BenchmarkReference::count());

        foreach (BenchmarkReference::all() as $reference) {
            $this->assertNotSame('', $reference->source_name);
            $this->assertGreaterThan(1990, $reference->source_year);
            $this->assertStringContainsString((string) $reference->source_year, $reference->citation());
        }
    }

    /**
     * Seeded citations have not been checked against the original sources, and
     * the platform says so rather than implying authority it hasn't earned.
     */
    public function test_unverified_citations_are_declared_as_such(): void
    {
        $this->seed(BenchmarkReferenceSeeder::class);

        $this->assertSame(
            0,
            BenchmarkReference::where('source_verified', true)->count(),
            'Seed data must not mark a citation verified — a human has to check it first.'
        );

        Volt::test('benchmarks.index')
            ->assertOk()
            ->assertSee('pending verification');
    }

    public function test_a_verified_citation_drops_the_pending_warning(): void
    {
        BenchmarkReference::create([
            'dimension' => 'teaching_quality',
            'system_name' => 'Test System',
            'practice' => 'A described structural practice.',
            'source_name' => 'A published source',
            'source_year' => 2020,
            'source_verified' => true,
        ]);

        $this->assertFalse(app(BenchmarkService::class)->hasUnverifiedSources());

        Volt::test('benchmarks.index')
            ->assertOk()
            ->assertDontSee('citation pending verification');
    }

    public function test_the_page_is_reachable_without_an_account(): void
    {
        // Aggregate, anonymised, public by design (spec section 3).
        $this->get(route('benchmarks.index'))->assertOk();
    }
}
