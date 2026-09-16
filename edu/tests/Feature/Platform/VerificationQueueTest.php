<?php

namespace Tests\Feature\Platform;

use App\Models\AuditLog;
use App\Models\FacilityClaim;
use App\Models\School;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Livewire\Volt\Volt;
use Tests\Feature\Platform\Concerns\SetsUpPlatformData;
use Tests\TestCase;

/**
 * Spec sections 5 and 8 — the officer queue that actually grants the
 * verifications the rest of the platform displays.
 */
class VerificationQueueTest extends TestCase
{
    use RefreshDatabase, SetsUpPlatformData;

    private function schoolWithUnverifiedCode(): School
    {
        $school = $this->makeSchool();
        $school->update(['udise_code' => '27250100'.$school->id]);

        return $school;
    }

    private function pendingClaim(School $school, User $admin): FacilityClaim
    {
        return FacilityClaim::create([
            'school_id' => $school->id,
            'facility_key' => 'robotics',
            'academic_year' => '2026-27',
            'is_offered' => true,
            'availability' => 'all_students',
            'evidence_note' => 'Lab commissioned March 2026, inspection report available.',
            'verification_status' => 'pending',
            'recorded_by_user_id' => $admin->id,
        ]);
    }

    // ---------------------------------------------------------------
    //  Verifying is a deliberate act
    // ---------------------------------------------------------------

    /**
     * Rule 44 forbids claiming a government verification without evidence. A
     * single click labelled "Verify" makes granting one on a glance far too
     * easy, so the officer must first tick that they checked.
     */
    public function test_a_udise_code_is_not_verified_without_the_explicit_confirmation(): void
    {
        $school = $this->schoolWithUnverifiedCode();
        $officer = $this->makeDistrictOfficer($school);

        Volt::actingAs($officer)->test('verification.queue')
            ->call('confirmUdise', $school->id)
            ->assertSee('Tick the confirmation first');

        $this->assertFalse($school->fresh()->isUdiseVerified());
    }

    public function test_ticking_the_confirmation_then_verifying_grants_the_badge(): void
    {
        $school = $this->schoolWithUnverifiedCode();
        $officer = $this->makeDistrictOfficer($school);

        Volt::actingAs($officer)->test('verification.queue')
            ->set('confirmedUdise.'.$school->id, true)
            ->call('confirmUdise', $school->id);

        $fresh = $school->fresh();

        $this->assertTrue($fresh->isUdiseVerified());
        $this->assertSame($officer->id, $fresh->udise_verified_by_user_id);
    }

    public function test_verifying_a_udise_code_is_audit_logged(): void
    {
        $school = $this->schoolWithUnverifiedCode();
        $officer = $this->makeDistrictOfficer($school);

        Volt::actingAs($officer)->test('verification.queue')
            ->set('confirmedUdise.'.$school->id, true)
            ->call('confirmUdise', $school->id);

        $this->assertTrue(
            AuditLog::where('action', 'udise.verified')->where('user_id', $officer->id)->exists()
        );
    }

    // ---------------------------------------------------------------
    //  Jurisdiction
    // ---------------------------------------------------------------

    public function test_an_officer_cannot_verify_a_school_outside_their_jurisdiction(): void
    {
        $school = $this->schoolWithUnverifiedCode();
        $outsideOfficer = $this->makeDistrictOfficer($this->makeSchool());

        Volt::actingAs($outsideOfficer)->test('verification.queue')
            ->set('confirmedUdise.'.$school->id, true)
            ->call('confirmUdise', $school->id)
            ->assertForbidden();

        $this->assertFalse($school->fresh()->isUdiseVerified());
    }

    public function test_the_queue_lists_only_schools_in_jurisdiction(): void
    {
        $mine = $this->schoolWithUnverifiedCode();
        $theirs = $this->schoolWithUnverifiedCode();
        $officer = $this->makeDistrictOfficer($mine);

        Volt::actingAs($officer)->test('verification.queue')
            ->assertOk()
            ->assertSee($mine->name)
            ->assertDontSee($theirs->name);
    }

    public function test_a_school_admin_cannot_open_the_queue(): void
    {
        $school = $this->makeSchool();

        Volt::actingAs($this->makeSchoolAdmin($school))->test('verification.queue')
            ->assertForbidden();
    }

    public function test_a_parent_cannot_open_the_queue(): void
    {
        $school = $this->makeSchool();

        Volt::actingAs($this->makeVerifiedParent($school))->test('verification.queue')
            ->assertForbidden();
    }

    // ---------------------------------------------------------------
    //  What the queue does and doesn't list
    // ---------------------------------------------------------------

    /** A school with no code has nothing to check, so it isn't a queue item. */
    public function test_schools_with_no_code_are_not_queued(): void
    {
        $school = $this->makeSchool();
        $officer = $this->makeDistrictOfficer($school);

        Volt::actingAs($officer)->test('verification.queue')
            ->assertOk()
            ->assertSee('Nothing awaiting confirmation');
    }

    public function test_an_already_verified_school_leaves_the_queue(): void
    {
        $school = $this->schoolWithUnverifiedCode();
        $officer = $this->makeDistrictOfficer($school);

        $component = Volt::actingAs($officer)->test('verification.queue')->assertSee($school->name);

        $component->set('confirmedUdise.'.$school->id, true)->call('confirmUdise', $school->id);

        Volt::actingAs($officer)->test('verification.queue')
            ->assertSee('Nothing awaiting confirmation');
    }

    // ---------------------------------------------------------------
    //  Facility evidence
    // ---------------------------------------------------------------

    public function test_an_officer_can_check_submitted_facility_evidence(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);
        $claim = $this->pendingClaim($school, $admin);
        $officer = $this->makeDistrictOfficer($school);

        Volt::actingAs($officer)->test('verification.queue')
            ->assertSee('Lab commissioned March 2026')
            ->call('verifyClaim', $claim->id);

        $fresh = $claim->fresh();

        $this->assertSame('verified', $fresh->verification_status);
        $this->assertSame($officer->id, $fresh->verified_by_user_id);
        $this->assertNotNull($fresh->verified_at);
    }

    public function test_returning_a_claim_changes_only_its_evidence_status(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);
        $claim = $this->pendingClaim($school, $admin);
        $officer = $this->makeDistrictOfficer($school);

        Volt::actingAs($officer)->test('verification.queue')
            ->call('returnClaim', $claim->id);

        $fresh = $claim->fresh();

        $this->assertSame('unverified', $fresh->verification_status);
        // The claim itself stands — an officer rejecting evidence is not the
        // same as the school withdrawing what it offers.
        $this->assertTrue((bool) $fresh->is_offered);
        $this->assertSame('robotics', $fresh->facility_key);
    }

    public function test_an_officer_cannot_touch_a_claim_outside_their_jurisdiction(): void
    {
        $school = $this->makeSchool();
        $claim = $this->pendingClaim($school, $this->makeSchoolAdmin($school));
        $outsideOfficer = $this->makeDistrictOfficer($this->makeSchool());

        Volt::actingAs($outsideOfficer)->test('verification.queue')
            ->call('verifyClaim', $claim->id)
            ->assertForbidden();

        $this->assertSame('pending', $claim->fresh()->verification_status);
    }

    /**
     * Checking evidence is a statement about paperwork, not about whether
     * families can actually use the facility — that is what the
     * claimed-vs-experienced comparison is for, and conflating them would let
     * a verified badge paper over a real gap.
     */
    public function test_the_queue_distinguishes_evidence_from_experience(): void
    {
        $school = $this->makeSchool();
        $this->pendingClaim($school, $this->makeSchoolAdmin($school));
        $officer = $this->makeDistrictOfficer($school);

        Volt::actingAs($officer)->test('verification.queue')
            ->assertOk()
            ->assertSee('not a statement about whether families can actually use');
    }
}
