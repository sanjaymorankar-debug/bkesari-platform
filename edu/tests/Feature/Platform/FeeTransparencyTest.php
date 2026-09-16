<?php

namespace Tests\Feature\Platform;

use App\Models\Fee;
use App\Models\FeeRevision;
use App\Models\School;
use App\Models\User;
use App\Services\AnnualCostCalculator;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Livewire\Volt\Volt;
use Tests\Feature\Platform\Concerns\SetsUpPlatformData;
use Tests\TestCase;

/**
 * Spec section 9 — true annual cost, and the "never overwrite" rule on fees.
 */
class FeeTransparencyTest extends TestCase
{
    use RefreshDatabase, SetsUpPlatformData;

    private function fee(School $school, User $author, array $attributes = []): Fee
    {
        return Fee::create(array_merge([
            'school_id' => $school->id,
            'academic_year' => '2026-27',
            'category' => 'tuition',
            'label' => 'Tuition',
            'amount' => 1000,
            'frequency' => 'annual',
            'is_mandatory' => true,
            'is_refundable' => false,
            'effective_from' => now()->toDateString(),
            'state_cap_status' => 'not_applicable',
            'recorded_by_user_id' => $author->id,
        ], $attributes));
    }

    public function test_recurring_frequencies_are_annualised(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);
        $calculator = app(AnnualCostCalculator::class);

        $monthly = $this->fee($school, $admin, ['amount' => 100, 'frequency' => 'monthly']);
        $quarterly = $this->fee($school, $admin, ['amount' => 100, 'frequency' => 'quarterly']);
        $annual = $this->fee($school, $admin, ['amount' => 100, 'frequency' => 'annual']);
        $term = $this->fee($school, $admin, ['amount' => 100, 'frequency' => 'term']);

        $this->assertSame(1200.0, $calculator->annualise($monthly));
        $this->assertSame(400.0, $calculator->annualise($quarterly));
        $this->assertSame(100.0, $calculator->annualise($annual));
        $this->assertSame(100.0 * AnnualCostCalculator::TERMS_PER_YEAR, $calculator->annualise($term));
    }

    /**
     * The distinction the whole module turns on: a joining fee makes year one
     * expensive, not every year expensive.
     */
    public function test_one_time_charges_are_separated_from_recurring_ones(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);

        $this->fee($school, $admin, ['amount' => 50000, 'frequency' => 'one_time', 'category' => 'admission', 'label' => 'Admission']);
        $this->fee($school, $admin, ['amount' => 2000, 'frequency' => 'monthly', 'label' => 'Monthly tuition']);

        $summary = app(AnnualCostCalculator::class)->summarise(Fee::all());

        $this->assertSame(24000.0, $summary['continuing_year_total'], 'Continuing years must exclude one-time charges.');
        $this->assertSame(74000.0, $summary['first_year_total'], 'The first year must include them.');
        $this->assertSame(50000.0, $summary['mandatory_one_time']);
    }

    public function test_mandatory_and_optional_are_never_merged(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);

        $this->fee($school, $admin, ['amount' => 30000, 'is_mandatory' => true]);
        $this->fee($school, $admin, ['amount' => 12000, 'is_mandatory' => false, 'category' => 'transport', 'label' => 'Bus']);

        $summary = app(AnnualCostCalculator::class)->summarise(Fee::all());

        $this->assertSame(30000.0, $summary['mandatory_recurring']);
        $this->assertSame(12000.0, $summary['optional_recurring']);
    }

    public function test_school_wide_fees_apply_to_every_class_but_class_fees_do_not_leak(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);

        $this->fee($school, $admin, ['amount' => 1000, 'class_grade' => null, 'label' => 'Applies to all']);
        $this->fee($school, $admin, ['amount' => 500, 'class_grade' => '10', 'label' => 'Class 10 lab']);

        $calculator = app(AnnualCostCalculator::class);

        $classNine = $calculator->forClass(Fee::all(), '9');
        $classTen = $calculator->forClass(Fee::all(), '10');

        $this->assertSame(1000.0, $calculator->summarise($classNine)['recurring_annual']);
        $this->assertSame(1500.0, $calculator->summarise($classTen)['recurring_annual']);
    }

    public function test_a_school_with_no_published_fees_reports_no_data_rather_than_zero(): void
    {
        // Zero would read as "this school is free", which is a lie.
        $summary = app(AnnualCostCalculator::class)->summarise(collect());

        $this->assertFalse($summary['has_data']);
        $this->assertSame(0, $summary['fee_count']);
    }

    public function test_changing_an_amount_preserves_the_previous_one(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);
        $fee = $this->fee($school, $admin, ['amount' => 30000, 'label' => 'Tuition']);

        Volt::actingAs($admin)->test('fees.manage', ['school' => $school])
            ->call('startEdit', $fee->id)
            ->set('editAmount', '45000')
            ->set('editReason', 'Revised after committee approval')
            ->call('saveEdit');

        $revision = FeeRevision::first();

        $this->assertNotNull($revision, 'Spec section 9 forbids overwriting a fee without a trail.');
        $this->assertSame('30000.00', $revision->previous_amount);
        $this->assertSame('45000.00', $revision->new_amount);
        $this->assertSame(30000.0, (float) $revision->previous_snapshot['amount']);
        $this->assertSame('45000.00', $fee->fresh()->amount);
    }

    public function test_changing_an_amount_requires_a_reason(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);
        $fee = $this->fee($school, $admin, ['amount' => 30000]);

        Volt::actingAs($admin)->test('fees.manage', ['school' => $school])
            ->call('startEdit', $fee->id)
            ->set('editAmount', '45000')
            ->set('editReason', '')
            ->call('saveEdit')
            ->assertHasErrors('editReason');

        $this->assertSame(0, FeeRevision::count());
        $this->assertSame('30000.00', $fee->fresh()->amount);
    }

    public function test_previous_years_are_kept_as_separate_records(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);

        $this->fee($school, $admin, ['academic_year' => '2025-26', 'amount' => 30000]);
        $this->fee($school, $admin, ['academic_year' => '2026-27', 'amount' => 36000]);

        $this->assertSame(2, Fee::where('school_id', $school->id)->count());
        $this->assertSame('30000.00', Fee::where('academic_year', '2025-26')->first()->amount);
    }

    public function test_an_admin_of_another_school_cannot_manage_these_fees(): void
    {
        $school = $this->makeSchool();
        $otherAdmin = $this->makeSchoolAdmin($this->makeSchool());

        Volt::actingAs($otherAdmin)->test('fees.manage', ['school' => $school])
            ->assertForbidden();
    }

    public function test_a_parent_cannot_reach_the_fee_management_screen(): void
    {
        $school = $this->makeSchool();
        $parent = $this->makeVerifiedParent($school);

        Volt::actingAs($parent)->test('fees.manage', ['school' => $school])
            ->assertForbidden();
    }

    public function test_school_admin_can_add_a_fee(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);

        Volt::actingAs($admin)->test('fees.manage', ['school' => $school])
            ->set('academicYear', '2026-27')
            ->set('category', 'transport')
            ->set('label', 'School bus')
            ->set('amount', '1500')
            ->set('frequency', 'monthly')
            ->set('isMandatory', false)
            ->call('addFee');

        $fee = Fee::first();

        $this->assertNotNull($fee);
        $this->assertSame('transport', $fee->category);
        $this->assertFalse($fee->is_mandatory);
        $this->assertSame(18000.0, app(AnnualCostCalculator::class)->annualise($fee));
    }

    public function test_the_public_school_page_shows_the_cost_breakdown(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);

        $this->fee($school, $admin, ['amount' => 40000, 'label' => 'Tuition']);

        Volt::test('schools.show', ['school' => $school])
            ->assertOk()
            ->assertSee('What it costs')
            ->assertSee('40,000');
    }

    /** An empty fee section must not read as "this school is cheap". */
    public function test_a_school_with_no_fees_says_so_explicitly(): void
    {
        $school = $this->makeSchool();

        Volt::test('schools.show', ['school' => $school])
            ->assertOk()
            ->assertSee('not evidence of low');
    }
}
