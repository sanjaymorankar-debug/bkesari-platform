<?php

namespace Tests\Feature\Platform;

use App\Models\FacilityClaim;
use App\Models\FacilityRating;
use App\Models\School;
use App\Models\User;
use App\Services\ClaimedVsExperiencedService;
use App\Support\FacilityTaxonomy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;
use Livewire\Volt\Volt;
use Tests\Feature\Platform\Concerns\SetsUpPlatformData;
use Tests\TestCase;

/**
 * Spec sections 8, 11, 12 and 26 — the claimed-vs-experienced comparison, and
 * the anonymity it has to preserve while making it.
 */
class ClaimedVsExperiencedTest extends TestCase
{
    use RefreshDatabase, SetsUpPlatformData;

    private const YEAR = '2026-27';

    private function claim(School $school, User $admin, string $key = 'science_laboratory'): FacilityClaim
    {
        return FacilityClaim::create([
            'school_id' => $school->id,
            'facility_key' => $key,
            'academic_year' => self::YEAR,
            'is_offered' => true,
            'availability' => 'all_students',
            'recorded_by_user_id' => $admin->id,
        ]);
    }

    private function rate(School $school, string $report, string $ref, string $key = 'science_laboratory'): FacilityRating
    {
        return FacilityRating::create([
            'school_id' => $school->id,
            'facility_key' => $key,
            'academic_year' => self::YEAR,
            'anonymous_ref' => $ref,
            'rater_role' => 'parent',
            'availability_report' => $report,
            'submitted_at' => now(),
        ]);
    }

    public function test_a_claim_everyone_confirms_reads_as_consistent(): void
    {
        $school = $this->makeSchool();
        $this->claim($school, $this->makeSchoolAdmin($school));

        foreach (['A', 'B', 'C', 'D'] as $ref) {
            $this->rate($school, 'available', 'ANON-'.$ref);
        }

        $row = app(ClaimedVsExperiencedService::class)->compareSchool($school->id, self::YEAR)[0];

        $this->assertSame('consistent', $row['status']);
        $this->assertSame(4, $row['report_count']);
    }

    public function test_a_claim_most_families_contradict_is_reported_as_a_discrepancy(): void
    {
        $school = $this->makeSchool();
        $this->claim($school, $this->makeSchoolAdmin($school));

        foreach (['A', 'B', 'C'] as $ref) {
            $this->rate($school, 'not_available', 'ANON-'.$ref);
        }
        $this->rate($school, 'available', 'ANON-D');

        $row = app(ClaimedVsExperiencedService::class)->compareSchool($school->id, self::YEAR)[0];

        $this->assertSame('significant_discrepancy', $row['status']);
        $this->assertSame(3, $row['not_available']);
    }

    /**
     * The single most important guard here: one unhappy family must never be
     * able to brand a school's claim as false.
     */
    public function test_one_or_two_reports_are_never_enough_to_label_a_claim(): void
    {
        $school = $this->makeSchool();
        $this->claim($school, $this->makeSchoolAdmin($school));

        $this->rate($school, 'not_available', 'ANON-A');
        $this->rate($school, 'not_available', 'ANON-B');

        $row = app(ClaimedVsExperiencedService::class)->compareSchool($school->id, self::YEAR)[0];

        $this->assertSame('insufficient_reports', $row['status']);
        $this->assertSame('insufficient', $row['confidence']);
        $this->assertLessThan(ClaimedVsExperiencedService::MIN_REPORTS, $row['report_count']);
    }

    /** Silence is not agreement — an unrated claim is not "consistent". */
    public function test_a_claim_with_no_reports_is_not_treated_as_confirmed(): void
    {
        $school = $this->makeSchool();
        $this->claim($school, $this->makeSchoolAdmin($school));

        $row = app(ClaimedVsExperiencedService::class)->compareSchool($school->id, self::YEAR)[0];

        $this->assertSame('no_reports', $row['status']);
        $this->assertNotSame('consistent', $row['status']);
    }

    public function test_partly_available_counts_as_half_agreement(): void
    {
        $school = $this->makeSchool();
        $this->claim($school, $this->makeSchoolAdmin($school));

        foreach (['A', 'B', 'C', 'D'] as $ref) {
            $this->rate($school, 'partially_available', 'ANON-'.$ref);
        }

        $row = app(ClaimedVsExperiencedService::class)->compareSchool($school->id, self::YEAR)[0];

        $this->assertSame(0.5, $row['available_share']);
        $this->assertSame('partially_consistent', $row['status']);
    }

    public function test_significant_gaps_are_surfaced_for_the_schools_right_of_reply(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);
        $this->claim($school, $admin, 'swimming');
        $this->claim($school, $admin, 'library');

        foreach (['A', 'B', 'C'] as $ref) {
            $this->rate($school, 'not_available', 'ANON-'.$ref, 'swimming');
            $this->rate($school, 'available', 'ANON-'.$ref, 'library');
        }

        $needsReply = app(ClaimedVsExperiencedService::class)
            ->discrepanciesNeedingReply($school->id, self::YEAR);

        $this->assertCount(1, $needsReply);
        $this->assertSame('swimming', $needsReply[0]['facility_key']);
    }

    /** Spec section 26 — the ratings table must not be able to identify anyone. */
    public function test_facility_ratings_carry_no_user_identifying_column(): void
    {
        $columns = Schema::getColumnListing('facility_ratings');

        foreach (['user_id', 'email', 'name', 'parent_user_id', 'student_user_id'] as $forbidden) {
            $this->assertNotContains(
                $forbidden,
                $columns,
                "facility_ratings must not store {$forbidden} — see spec section 26."
            );
        }

        $this->assertContains('anonymous_ref', $columns);
    }

    public function test_a_verified_parent_can_rate_and_is_stored_anonymously(): void
    {
        $school = $this->makeSchool();
        $this->claim($school, $this->makeSchoolAdmin($school));
        $parent = $this->makeVerifiedParent($school);

        Volt::actingAs($parent)->test('facilities.rate', ['school' => $school])
            ->set('academicYear', self::YEAR)
            ->set('facilityKey', 'science_laboratory')
            ->set('availabilityReport', 'available')
            ->set('scores.quality', '4')
            ->call('submit');

        $rating = FacilityRating::first();

        $this->assertNotNull($rating);
        $this->assertSame(4, $rating->quality);
        $this->assertNotSame((string) $parent->id, $rating->anonymous_ref);
        $this->assertStringStartsNotWith($parent->email, $rating->anonymous_ref);
    }

    public function test_resubmitting_updates_the_same_report_rather_than_stacking(): void
    {
        $school = $this->makeSchool();
        $this->claim($school, $this->makeSchoolAdmin($school));
        $parent = $this->makeVerifiedParent($school);

        foreach (['available', 'not_available'] as $report) {
            Volt::actingAs($parent)->test('facilities.rate', ['school' => $school])
                ->set('academicYear', self::YEAR)
                ->set('facilityKey', 'science_laboratory')
                ->set('availabilityReport', $report)
                ->call('submit');
        }

        $this->assertSame(1, FacilityRating::count(), 'A single family must not be able to vote twice.');
        $this->assertSame('not_available', FacilityRating::first()->availability_report);
    }

    public function test_an_unverified_user_cannot_rate_this_schools_facilities(): void
    {
        $school = $this->makeSchool();
        $outsider = $this->makeVerifiedParent($this->makeSchool());

        Volt::actingAs($outsider)->test('facilities.rate', ['school' => $school])
            ->assertForbidden();
    }

    public function test_a_facility_the_school_never_listed_cannot_be_rated(): void
    {
        $school = $this->makeSchool();
        $this->claim($school, $this->makeSchoolAdmin($school));
        $parent = $this->makeVerifiedParent($school);

        Volt::actingAs($parent)->test('facilities.rate', ['school' => $school])
            ->set('academicYear', self::YEAR)
            ->set('facilityKey', 'swimming')
            ->set('availabilityReport', 'not_available')
            ->call('submit')
            ->assertStatus(422);

        $this->assertSame(0, FacilityRating::count());
    }

    public function test_a_school_cannot_mark_its_own_claim_verified(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);

        Volt::actingAs($admin)->test('facilities.manage', ['school' => $school])
            ->set('academicYear', self::YEAR)
            ->set('facilityKey', 'robotics')
            ->set('evidenceNote', 'Lab commissioned March 2026')
            ->call('addClaim');

        $claim = FacilityClaim::first();

        $this->assertSame(
            'pending',
            $claim->verification_status,
            'Submitting evidence queues a claim for checking; it must never self-verify.'
        );
    }

    public function test_only_a_reviewer_can_mark_a_claim_verified(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);
        $officer = $this->makeDistrictOfficer($school);
        $claim = $this->claim($school, $admin);

        $claim->update(['verification_status' => 'verified']);
        $this->assertNull($claim->fresh()->verified_at, 'Status alone is not a verification record.');

        $claim->markVerified($officer);

        $this->assertSame('verified', $claim->fresh()->verification_status);
        $this->assertSame($officer->id, $claim->fresh()->verified_by_user_id);
        $this->assertNotNull($claim->fresh()->verified_at);
    }

    /**
     * A school must learn about a reported gap on its own dashboard, not from
     * its public profile — that is where section 29's right of reply starts.
     */
    public function test_the_school_sees_reported_gaps_on_its_own_facilities_page(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);
        $this->claim($school, $admin, 'swimming');

        foreach (['A', 'B', 'C'] as $ref) {
            $this->rate($school, 'not_available', 'ANON-'.$ref, 'swimming');
        }

        Volt::actingAs($admin)->test('facilities.manage', ['school' => $school])
            ->set('academicYear', self::YEAR)
            ->assertOk()
            ->assertSee('Families are reporting something different')
            ->assertSee('Swimming')
            // The framing rule: reported, not proven.
            ->assertSee('not a finding against your school');
    }

    public function test_a_school_with_no_reported_gaps_sees_no_warning_panel(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);
        $this->claim($school, $admin, 'library');

        foreach (['A', 'B', 'C'] as $ref) {
            $this->rate($school, 'available', 'ANON-'.$ref, 'library');
        }

        Volt::actingAs($admin)->test('facilities.manage', ['school' => $school])
            ->set('academicYear', self::YEAR)
            ->assertOk()
            ->assertDontSee('Families are reporting something different');
    }

    /** The public profile must show the comparison, not just the claim. */
    public function test_the_public_profile_shows_the_comparison(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);
        $this->claim($school, $admin, 'swimming');

        foreach (['A', 'B', 'C'] as $ref) {
            $this->rate($school, 'not_available', 'ANON-'.$ref, 'swimming');
        }

        Volt::test('schools.show', ['school' => $school])
            ->assertOk()
            ->assertSee('Significant discrepancy reported')
            ->assertSee('reported difference');
    }

    public function test_the_taxonomy_is_shared_by_claims_and_ratings(): void
    {
        // Section 12's requirement: one canonical list, or the comparison is
        // meaningless.
        $this->assertTrue(FacilityTaxonomy::exists('science_laboratory'));
        $this->assertFalse(FacilityTaxonomy::exists('science lab'));

        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);

        Volt::actingAs($admin)->test('facilities.manage', ['school' => $school])
            ->set('academicYear', self::YEAR)
            ->set('facilityKey', 'not_a_real_facility')
            ->call('addClaim')
            ->assertHasErrors('facilityKey');
    }
}
