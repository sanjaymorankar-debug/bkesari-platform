<?php

namespace Tests\Feature\Platform;

use App\Models\CapabilityObservation;
use App\Models\ConsentRecord;
use App\Services\ConsentService;
use App\Services\DevelopmentAccessService;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Livewire\Volt\Volt;
use Tests\Feature\Platform\Concerns\SetsUpPlatformData;
use Tests\TestCase;

/**
 * DPDP Act 2023 Section 9. Every assertion here is about the same rule: a
 * child's development data may not be collected or read without verifiable
 * guardian consent in force at that moment.
 */
class ConsentGateTest extends TestCase
{
    use RefreshDatabase, SetsUpPlatformData;

    public function test_teacher_cannot_view_growth_record_without_guardian_consent(): void
    {
        $school = $this->makeSchool();
        $student = $this->makeVerifiedStudent($school);
        $teacher = $this->makeVerifiedTeacher($school);

        Volt::actingAs($teacher)->test('growth.show', ['student' => $student])
            ->assertForbidden();
    }

    public function test_teacher_can_view_growth_record_once_guardian_consents(): void
    {
        $school = $this->makeSchool();
        $student = $this->makeVerifiedStudent($school);
        $guardian = $this->makeGuardianOf($school, $student);
        $teacher = $this->makeVerifiedTeacher($school);

        app(ConsentService::class)->grant($guardian, $student->id, 'capability_growth');

        Volt::actingAs($teacher)->test('growth.show', ['student' => $student])
            ->assertOk();
    }

    public function test_withdrawing_consent_immediately_blocks_further_access(): void
    {
        $school = $this->makeSchool();
        $student = $this->makeVerifiedStudent($school);
        $guardian = $this->makeGuardianOf($school, $student);
        $teacher = $this->makeVerifiedTeacher($school);
        $consent = app(ConsentService::class);

        $consent->grant($guardian, $student->id, 'capability_growth');
        $this->assertTrue($consent->hasConsent($student->id, 'capability_growth'));

        $consent->withdraw($guardian, $student->id, 'capability_growth');

        $this->assertFalse($consent->hasConsent($student->id, 'capability_growth'));

        Volt::actingAs($teacher)->test('growth.show', ['student' => $student])
            ->assertForbidden();
    }

    public function test_withdrawal_preserves_the_record_that_consent_once_existed(): void
    {
        $school = $this->makeSchool();
        $student = $this->makeVerifiedStudent($school);
        $guardian = $this->makeGuardianOf($school, $student);
        $consent = app(ConsentService::class);

        $consent->grant($guardian, $student->id, 'capability_growth');
        $consent->withdraw($guardian, $student->id, 'capability_growth');

        // The row survives as a withdrawn grant — the platform still has to be
        // able to show data collected last term was lawfully collected.
        $record = ConsentRecord::where('student_user_id', $student->id)->first();
        $this->assertNotNull($record);
        $this->assertSame('withdrawn', $record->status);
        $this->assertNotNull($record->withdrawn_at);
        $this->assertNotNull($record->granted_at);
    }

    public function test_an_adult_who_is_not_a_verified_guardian_cannot_grant_consent(): void
    {
        $school = $this->makeSchool();
        $student = $this->makeVerifiedStudent($school);
        // A verified parent at the same school, but not of this child.
        $strangerParent = $this->makeVerifiedParent($school);

        $this->expectException(AuthorizationException::class);

        app(ConsentService::class)->grant($strangerParent, $student->id, 'capability_growth');
    }

    public function test_consent_is_per_purpose_and_does_not_leak_across_modules(): void
    {
        $school = $this->makeSchool();
        $student = $this->makeVerifiedStudent($school);
        $guardian = $this->makeGuardianOf($school, $student);
        $consent = app(ConsentService::class);

        $consent->grant($guardian, $student->id, 'capability_growth');

        // Agreeing to growth observations is not agreeing to career profiling.
        $this->assertTrue($consent->hasConsent($student->id, 'capability_growth'));
        $this->assertFalse($consent->hasConsent($student->id, 'career_pathway'));
        $this->assertFalse($consent->hasConsent($student->id, 'life_skills'));
    }

    public function test_observation_cannot_be_written_without_consent(): void
    {
        $school = $this->makeSchool();
        $student = $this->makeVerifiedStudent($school);
        $teacher = $this->makeVerifiedTeacher($school);

        $this->assertFalse(
            app(DevelopmentAccessService::class)
                ->canRecordObservation($teacher, $student->id, $school->id)
        );

        // And the form itself refuses to even open.
        Volt::actingAs($teacher)->test('growth.observe', ['student' => $student])
            ->assertForbidden();

        $this->assertSame(0, CapabilityObservation::count());
    }

    public function test_consent_granted_twice_does_not_reset_the_original_date(): void
    {
        $school = $this->makeSchool();
        $student = $this->makeVerifiedStudent($school);
        $guardian = $this->makeGuardianOf($school, $student);
        $consent = app(ConsentService::class);

        $first = $consent->grant($guardian, $student->id, 'capability_growth');
        $second = $consent->grant($guardian, $student->id, 'capability_growth');

        $this->assertSame($first->id, $second->id);
        $this->assertSame(1, ConsentRecord::where('student_user_id', $student->id)->count());
    }

    public function test_guardian_can_manage_consent_through_the_screen(): void
    {
        $school = $this->makeSchool();
        $student = $this->makeVerifiedStudent($school);
        $guardian = $this->makeGuardianOf($school, $student);

        Volt::actingAs($guardian)->test('consent.manage')
            ->assertOk()
            ->call('grant', 'capability_growth');

        $this->assertTrue(app(ConsentService::class)->hasConsent($student->id, 'capability_growth'));
    }

    public function test_child_can_always_see_their_own_record_even_before_consent(): void
    {
        $school = $this->makeSchool();
        $student = $this->makeVerifiedStudent($school);

        // Consent governs collection by the school. It is not a lock the
        // school holds over the child's view of their own record.
        Volt::actingAs($student)->test('growth.show', ['student' => $student])
            ->assertOk();
    }

    /**
     * A guardian who switched tracking off is not an intruder. They see an
     * explanation and a way back, not a 403 telling them they have no access
     * to their own child's record.
     */
    public function test_guardian_who_withdrew_consent_sees_an_explanation_not_a_denial(): void
    {
        $school = $this->makeSchool();
        $student = $this->makeVerifiedStudent($school);
        $guardian = $this->makeGuardianOf($school, $student);
        $consent = app(ConsentService::class);

        $consent->grant($guardian, $student->id, 'capability_growth');
        $consent->withdraw($guardian, $student->id, 'capability_growth');

        Volt::actingAs($guardian)->test('growth.show', ['student' => $student])
            ->assertOk()
            ->assertSet('consentOff', true)
            ->assertSee('Growth tracking is turned off');
    }

    /** But the school still gets nothing at all. */
    public function test_teacher_still_sees_nothing_after_withdrawal(): void
    {
        $school = $this->makeSchool();
        $student = $this->makeVerifiedStudent($school);
        $guardian = $this->makeGuardianOf($school, $student);
        $teacher = $this->makeVerifiedTeacher($school);
        $consent = app(ConsentService::class);

        $consent->grant($guardian, $student->id, 'capability_growth');
        $consent->withdraw($guardian, $student->id, 'capability_growth');

        Volt::actingAs($teacher)->test('growth.show', ['student' => $student])
            ->assertForbidden();
    }

    public function test_unknown_consent_purpose_is_rejected(): void
    {
        $school = $this->makeSchool();
        $student = $this->makeVerifiedStudent($school);
        $guardian = $this->makeGuardianOf($school, $student);

        $this->expectException(AuthorizationException::class);

        app(ConsentService::class)->grant($guardian, $student->id, 'sell_to_advertisers');
    }
}
