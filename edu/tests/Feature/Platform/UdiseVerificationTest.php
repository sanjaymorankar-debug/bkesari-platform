<?php

namespace Tests\Feature\Platform;

use App\Models\School;
use Database\Seeders\LocationSeeder;
use Database\Seeders\SchoolSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Livewire\Volt\Volt;
use Tests\Feature\Platform\Concerns\SetsUpPlatformData;
use Tests\TestCase;

/**
 * Spec sections 5 and 8, and rule 44's "never claim government verification
 * without evidence". A school typing a UDISE code into a form is making a
 * claim; only a confirmation against government data earns the badge.
 */
class UdiseVerificationTest extends TestCase
{
    use RefreshDatabase, SetsUpPlatformData;

    public function test_a_school_with_no_udise_code_shows_none_on_record(): void
    {
        $school = $this->makeSchool();

        Volt::test('schools.show', ['school' => $school])
            ->assertOk()
            ->assertSee('No UDISE code on record')
            ->assertDontSee('UDISE Verified');
    }

    public function test_an_unconfirmed_code_is_shown_as_unconfirmed_not_verified(): void
    {
        $school = $this->makeSchool();
        $school->update(['udise_code' => '27250100123']);

        $this->assertFalse($school->fresh()->isUdiseVerified());

        Volt::test('schools.show', ['school' => $school])
            ->assertOk()
            ->assertSee('not yet confirmed')
            ->assertDontSee('UDISE Verified');
    }

    public function test_the_badge_appears_only_once_the_code_is_actually_confirmed(): void
    {
        $school = $this->makeSchool();
        $officer = $this->makeDistrictOfficer($school);

        $school->update(['udise_code' => '27250100123']);
        $school->markUdiseVerified($officer);

        $this->assertTrue($school->fresh()->isUdiseVerified());

        Volt::test('schools.show', ['school' => $school])
            ->assertOk()
            ->assertSee('UDISE Verified');
    }

    /**
     * The verification columns are not mass-assignable, so a school editing
     * its own profile cannot hand itself a government verification.
     */
    public function test_verification_cannot_be_mass_assigned(): void
    {
        $school = $this->makeSchool();

        $school->update([
            'udise_code' => '27250100123',
            'udise_verified_at' => now(),
            'udise_verified_by_user_id' => 1,
        ]);

        $this->assertFalse(
            $school->fresh()->isUdiseVerified(),
            'A school must not be able to mass-assign itself a UDISE verification.'
        );
    }

    public function test_a_school_without_a_code_cannot_be_marked_verified(): void
    {
        $school = $this->makeSchool();
        $officer = $this->makeDistrictOfficer($school);

        $this->expectException(\LogicException::class);

        $school->markUdiseVerified($officer);
    }

    /** A verification timestamp with no code is not a verified school. */
    public function test_a_verification_timestamp_without_a_code_does_not_earn_the_badge(): void
    {
        $school = $this->makeSchool();
        $school->forceFill(['udise_verified_at' => now()])->save();

        $this->assertFalse($school->fresh()->isUdiseVerified());
    }

    /** Nothing in the seeders may fabricate a government confirmation. */
    public function test_seeded_schools_are_never_marked_udise_verified(): void
    {
        $this->seed(LocationSeeder::class);
        $this->seed(SchoolSeeder::class);

        $this->assertSame(
            0,
            School::whereNotNull('udise_verified_at')->count(),
            'Seed data must never claim a government verification that did not happen.'
        );
    }
}
