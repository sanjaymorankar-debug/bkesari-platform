<?php

namespace Tests\Feature\Platform;

use App\Models\CoachingProgramme;
use App\Models\ExternalExam;
use App\Models\Fee;
use App\Models\School;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Livewire\Volt\Volt;
use Tests\Feature\Platform\Concerns\SetsUpPlatformData;
use Tests\TestCase;

/**
 * Spec section 10 — external exams and coaching, and the point where it feeds
 * back into section 9: a compulsory cost billed outside the published fees.
 */
class ExamsAndCoachingTest extends TestCase
{
    use RefreshDatabase, SetsUpPlatformData;

    private const YEAR = '2026-27';

    private function coaching(School $school, User $admin, array $attributes = []): CoachingProgramme
    {
        return CoachingProgramme::create(array_merge([
            'school_id' => $school->id,
            'academic_year' => self::YEAR,
            'programme_name' => 'JEE Foundation',
            'programme_type' => 'jee',
            'provider_type' => 'school',
            'fee' => 40000,
            'is_mandatory' => true,
            'bundled_into_school_fees' => false,
            'recorded_by_user_id' => $admin->id,
        ], $attributes));
    }

    public function test_a_compulsory_unbundled_programme_is_identified_as_a_hidden_cost(): void
    {
        $school = $this->makeSchool();
        $programme = $this->coaching($school, $this->makeSchoolAdmin($school));

        $this->assertTrue($programme->isUnbundledMandatoryCost());
    }

    public function test_a_compulsory_programme_inside_the_fees_is_not_a_hidden_cost(): void
    {
        $school = $this->makeSchool();
        $programme = $this->coaching($school, $this->makeSchoolAdmin($school), [
            'bundled_into_school_fees' => true,
        ]);

        $this->assertFalse($programme->isUnbundledMandatoryCost());
    }

    public function test_an_optional_programme_is_not_a_hidden_cost(): void
    {
        $school = $this->makeSchool();
        $programme = $this->coaching($school, $this->makeSchoolAdmin($school), ['is_mandatory' => false]);

        $this->assertFalse($programme->isUnbundledMandatoryCost());
    }

    public function test_a_free_compulsory_programme_is_not_a_hidden_cost(): void
    {
        $school = $this->makeSchool();
        $programme = $this->coaching($school, $this->makeSchoolAdmin($school), ['fee' => 0]);

        $this->assertFalse($programme->isUnbundledMandatoryCost());
    }

    /** Coaching inside the timetable is not optional in practice. */
    public function test_coaching_during_school_hours_counts_as_effectively_compulsory(): void
    {
        $school = $this->makeSchool();
        $programme = $this->coaching($school, $this->makeSchoolAdmin($school), [
            'is_mandatory' => false,
            'during_school_hours' => true,
        ]);

        $this->assertTrue($programme->isEffectivelyCompulsory());
    }

    /**
     * The point of the whole module: the estimated annual cost must be shown
     * as incomplete rather than looking precise while missing ₹40,000.
     */
    public function test_the_public_profile_flags_compulsory_costs_outside_the_fee_totals(): void
    {
        $school = $this->makeSchool();
        $this->coaching($school, $this->makeSchoolAdmin($school));

        Volt::test('schools.show', ['school' => $school])
            ->assertOk()
            ->assertSee('Not included in the figures above')
            ->assertSee('40,000');
    }

    /**
     * The worst case, and the one this nearly got wrong: a school that
     * publishes no fees at all but charges compulsory coaching. If the flag
     * only appeared alongside published fees, the school with the least
     * transparency would show the least warning.
     */
    public function test_the_flag_appears_even_when_the_school_publishes_no_fees(): void
    {
        $school = $this->makeSchool();
        $this->coaching($school, $this->makeSchoolAdmin($school));

        $this->assertSame(0, Fee::where('school_id', $school->id)->count());

        Volt::test('schools.show', ['school' => $school])
            ->assertOk()
            ->assertSee('Not included in the figures above')
            ->assertSee('any published fee figure')
            ->assertSee('40,000');
    }

    public function test_the_profile_does_not_flag_anything_when_costs_are_bundled(): void
    {
        $school = $this->makeSchool();
        $this->coaching($school, $this->makeSchoolAdmin($school), ['bundled_into_school_fees' => true]);

        Volt::test('schools.show', ['school' => $school])
            ->assertOk()
            ->assertDontSee('Not included in the figures above');
    }

    public function test_the_school_sees_the_same_gap_on_its_own_screen(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);
        $this->coaching($school, $admin);

        Volt::actingAs($admin)->test('exams.manage', ['school' => $school])
            ->set('academicYear', self::YEAR)
            ->assertOk()
            ->assertSee('Compulsory costs outside your published fees')
            // Framing: a gap to account for, not an accusation.
            ->assertSee('may be exactly right for how you bill');
    }

    public function test_an_exam_totals_its_own_fee_plus_preparation(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);

        $exam = ExternalExam::create([
            'school_id' => $school->id,
            'academic_year' => self::YEAR,
            'exam_name' => 'National Science Olympiad',
            'exam_type' => 'olympiad',
            'exam_fee' => 250,
            'preparation_offered' => true,
            'preparation_fee' => 1500,
            'recorded_by_user_id' => $admin->id,
        ]);

        $this->assertSame(1750.0, $exam->totalCost());
    }

    public function test_a_school_admin_can_add_an_exam_and_a_coaching_programme(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);

        $component = Volt::actingAs($admin)->test('exams.manage', ['school' => $school])
            ->set('academicYear', self::YEAR);

        $component->set('examName', 'NTSE')
            ->set('examType', 'scholarship')
            ->set('examFee', '300')
            ->call('addExam');

        $component->set('programmeName', 'NEET Crash Course')
            ->set('programmeType', 'neet')
            ->set('coachingFee', '25000')
            ->call('addCoaching');

        $this->assertSame(1, ExternalExam::count());
        $this->assertSame('NTSE', ExternalExam::first()->exam_name);
        $this->assertSame(1, CoachingProgramme::count());
        $this->assertSame('neet', CoachingProgramme::first()->programme_type);
    }

    public function test_another_schools_admin_cannot_manage_this_schools_exams(): void
    {
        $school = $this->makeSchool();
        $otherAdmin = $this->makeSchoolAdmin($this->makeSchool());

        Volt::actingAs($otherAdmin)->test('exams.manage', ['school' => $school])
            ->assertForbidden();
    }

    public function test_records_are_kept_per_year(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);

        $this->coaching($school, $admin, ['academic_year' => '2025-26', 'fee' => 30000]);
        $this->coaching($school, $admin, ['academic_year' => '2026-27', 'fee' => 40000]);

        $this->assertSame(2, CoachingProgramme::count());
        $this->assertSame('30000.00', CoachingProgramme::where('academic_year', '2025-26')->first()->fee);
    }
}
