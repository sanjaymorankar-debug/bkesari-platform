<?php

namespace Tests\Feature\Platform;

use App\Models\CounsellingSession;
use App\Models\HealthAccessLog;
use App\Models\HealthFollowup;
use App\Models\PhysicalHealthRecord;
use App\Models\School;
use App\Models\SchoolStaff;
use App\Models\User;
use App\Models\WellbeingConcern;
use App\Services\ConsentService;
use App\Services\HealthAccessService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Livewire\Volt\Volt;
use Tests\Feature\Platform\Concerns\SetsUpPlatformData;
use Tests\TestCase;

/**
 * Spec sections 18-21 as the screens actually behave — particularly the
 * confidentiality boundary a guardian could otherwise walk straight through.
 */
class HealthPortalTest extends TestCase
{
    use RefreshDatabase, SetsUpPlatformData;

    private School $school;

    private User $child;

    private User $guardian;

    protected function setUp(): void
    {
        parent::setUp();

        $this->school = $this->makeSchool();
        $this->child = $this->makeVerifiedStudent($this->school);
        $this->guardian = $this->makeGuardianOf($this->school, $this->child);
    }

    private function staffMember(string $role): User
    {
        $user = User::factory()->create();
        $user->assignRole($role);

        SchoolStaff::create([
            'user_id' => $user->id,
            'school_id' => $this->school->id,
            'designation' => ucfirst(str_replace('_', ' ', $role)),
        ]);

        return $user;
    }

    private function grantConsent(string $purpose): void
    {
        app(ConsentService::class)->grant($this->guardian, $this->child->id, $purpose);
    }

    // ---------------------------------------------------------------
    //  The boundary that matters most
    // ---------------------------------------------------------------

    /**
     * The guardian has legitimate access to the wellbeing area and still must
     * never see the counsellor's raw notes through it.
     */
    public function test_the_guardian_page_never_renders_raw_counselling_notes(): void
    {
        $this->grantConsent(HealthAccessService::PURPOSE_PHYSICAL);
        $this->grantConsent(HealthAccessService::PURPOSE_WELLBEING);

        $counsellor = $this->staffMember('counsellor');

        CounsellingSession::create([
            'student_user_id' => $this->child->id,
            'school_id' => $this->school->id,
            'session_date' => now()->toDateString(),
            'session_notes' => 'RAWCLINICALNOTE-zzqq',
            'shareable_summary' => 'We talked about settling in.',
            'counsellor_user_id' => $counsellor->id,
        ]);

        Volt::actingAs($this->guardian)->test('health.show', ['student' => $this->child])
            ->assertOk()
            ->assertSee('We talked about settling in.')
            ->assertDontSee('RAWCLINICALNOTE-zzqq');
    }

    public function test_a_session_without_a_summary_shares_nothing_rather_than_falling_back(): void
    {
        $this->grantConsent(HealthAccessService::PURPOSE_PHYSICAL);
        $this->grantConsent(HealthAccessService::PURPOSE_WELLBEING);

        $counsellor = $this->staffMember('counsellor');

        CounsellingSession::create([
            'student_user_id' => $this->child->id,
            'school_id' => $this->school->id,
            'session_date' => now()->toDateString(),
            'session_notes' => 'RAWCLINICALNOTE-zzqq',
            'shareable_summary' => null,
            'counsellor_user_id' => $counsellor->id,
        ]);

        Volt::actingAs($this->guardian)->test('health.show', ['student' => $this->child])
            ->assertOk()
            ->assertDontSee('RAWCLINICALNOTE-zzqq')
            ->assertSee('written a summary for this session yet');
    }

    public function test_a_guardian_without_wellbeing_consent_sees_no_counselling_area(): void
    {
        // Physical consent only.
        $this->grantConsent(HealthAccessService::PURPOSE_PHYSICAL);

        $counsellor = $this->staffMember('counsellor');

        CounsellingSession::create([
            'student_user_id' => $this->child->id,
            'school_id' => $this->school->id,
            'session_date' => now()->toDateString(),
            'session_notes' => 'notes',
            'shareable_summary' => 'SHARED-SUMMARY-zzqq',
            'counsellor_user_id' => $counsellor->id,
        ]);

        Volt::actingAs($this->guardian)->test('health.show', ['student' => $this->child])
            ->assertOk()
            ->assertDontSee('SHARED-SUMMARY-zzqq');
    }

    // ---------------------------------------------------------------
    //  Who can open the record at all
    // ---------------------------------------------------------------

    public function test_another_familys_parent_gets_a_403(): void
    {
        $this->grantConsent(HealthAccessService::PURPOSE_PHYSICAL);
        $otherParent = $this->makeVerifiedParent($this->school);

        Volt::actingAs($otherParent)->test('health.show', ['student' => $this->child])
            ->assertForbidden();
    }

    public function test_a_teacher_cannot_open_the_health_record(): void
    {
        $this->grantConsent(HealthAccessService::PURPOSE_PHYSICAL);
        $teacher = $this->staffMember('teacher');

        Volt::actingAs($teacher)->test('health.show', ['student' => $this->child])
            ->assertForbidden();
    }

    public function test_a_guardian_without_any_consent_cannot_open_it(): void
    {
        Volt::actingAs($this->guardian)->test('health.show', ['student' => $this->child])
            ->assertForbidden();
    }

    public function test_the_child_can_open_their_own_record(): void
    {
        Volt::actingAs($this->child)->test('health.show', ['student' => $this->child])
            ->assertOk();
    }

    // ---------------------------------------------------------------
    //  Recording
    // ---------------------------------------------------------------

    public function test_a_nurse_can_record_a_screening_and_open_a_followup(): void
    {
        $this->grantConsent(HealthAccessService::PURPOSE_PHYSICAL);
        $nurse = $this->staffMember('school_nurse');

        Volt::actingAs($nurse)->test('health.record', ['student' => $this->child])
            ->set('heightCm', '150')
            ->set('weightKg', '45')
            ->set('visionLeft', '6/12')
            ->set('healthConcerns', 'Reduced vision in the left eye.')
            ->set('openFollowup', true)
            ->set('followupArea', 'vision')
            ->set('followupFinding', 'Left eye 6/12, needs an eye test.')
            ->call('save');

        $record = PhysicalHealthRecord::first();

        $this->assertNotNull($record);
        $this->assertSame('20.0', $record->bmi, 'BMI should be stored alongside the measurements.');
        $this->assertSame(1, HealthFollowup::count());
        $this->assertSame('vision', HealthFollowup::first()->area);
        $this->assertSame('identified', HealthFollowup::first()->status);
    }

    public function test_a_followup_requires_a_finding(): void
    {
        $this->grantConsent(HealthAccessService::PURPOSE_PHYSICAL);
        $nurse = $this->staffMember('school_nurse');

        Volt::actingAs($nurse)->test('health.record', ['student' => $this->child])
            ->set('openFollowup', true)
            ->set('followupFinding', '')
            ->call('save')
            ->assertHasErrors('followupFinding');

        $this->assertSame(0, PhysicalHealthRecord::count());
    }

    public function test_a_screening_cannot_be_dated_in_the_future(): void
    {
        $this->grantConsent(HealthAccessService::PURPOSE_PHYSICAL);
        $nurse = $this->staffMember('school_nurse');

        Volt::actingAs($nurse)->test('health.record', ['student' => $this->child])
            ->set('examinationDate', now()->addWeek()->toDateString())
            ->call('save')
            ->assertHasErrors('examinationDate');
    }

    public function test_a_teacher_cannot_reach_the_screening_form(): void
    {
        $this->grantConsent(HealthAccessService::PURPOSE_PHYSICAL);
        $teacher = $this->staffMember('teacher');

        Volt::actingAs($teacher)->test('health.record', ['student' => $this->child])
            ->assertForbidden();
    }

    // ---------------------------------------------------------------
    //  Teacher observations
    // ---------------------------------------------------------------

    public function test_a_teacher_can_raise_an_observation_and_is_told_what_it_is_not(): void
    {
        $this->grantConsent(HealthAccessService::PURPOSE_WELLBEING);
        $teacher = $this->staffMember('teacher');

        Volt::actingAs($teacher)->test('wellbeing.concern', ['student' => $this->child])
            ->assertOk()
            ->assertSee('not what you think it means')
            ->assertSee('nowhere to record a diagnosis')
            ->set('observation', 'Has sat alone at break for the last two weeks and stopped joining group work.')
            ->call('save');

        $concern = WellbeingConcern::first();

        $this->assertNotNull($concern);
        $this->assertSame('raised', $concern->referral_status);
        $this->assertSame($teacher->id, $concern->raised_by_user_id);
    }

    public function test_an_observation_needs_enough_detail_to_act_on(): void
    {
        $this->grantConsent(HealthAccessService::PURPOSE_WELLBEING);
        $teacher = $this->staffMember('teacher');

        Volt::actingAs($teacher)->test('wellbeing.concern', ['student' => $this->child])
            ->set('observation', 'sad')
            ->call('save')
            ->assertHasErrors('observation');

        $this->assertSame(0, WellbeingConcern::count());
    }

    public function test_a_teacher_cannot_raise_an_observation_without_consent(): void
    {
        $teacher = $this->staffMember('teacher');

        Volt::actingAs($teacher)->test('wellbeing.concern', ['student' => $this->child])
            ->assertForbidden();
    }

    // ---------------------------------------------------------------
    //  Counsellor portal
    // ---------------------------------------------------------------

    public function test_the_portal_lists_observations_nobody_has_picked_up(): void
    {
        $this->grantConsent(HealthAccessService::PURPOSE_WELLBEING);
        $teacher = $this->staffMember('teacher');
        $counsellor = $this->staffMember('counsellor');

        WellbeingConcern::create([
            'student_user_id' => $this->child->id,
            'school_id' => $this->school->id,
            'observation' => 'UNSEEN-OBSERVATION-zzqq',
            'observed_on' => now()->subWeek()->toDateString(),
            'raised_by_user_id' => $teacher->id,
            'raised_by_role' => 'teacher',
        ]);

        Volt::actingAs($counsellor)->test('counselling.portal')
            ->assertOk()
            ->assertSee('UNSEEN-OBSERVATION-zzqq');
    }

    public function test_recording_a_session_marks_the_linked_observation_seen(): void
    {
        $this->grantConsent(HealthAccessService::PURPOSE_WELLBEING);
        $teacher = $this->staffMember('teacher');
        $counsellor = $this->staffMember('counsellor');

        $concern = WellbeingConcern::create([
            'student_user_id' => $this->child->id,
            'school_id' => $this->school->id,
            'observation' => 'A described observation of behaviour.',
            'observed_on' => now()->subWeek()->toDateString(),
            'raised_by_user_id' => $teacher->id,
            'raised_by_role' => 'teacher',
        ]);

        Volt::actingAs($counsellor)->test('counselling.portal')
            ->call('startSession', $this->child->id, $concern->id)
            ->set('sessionNotes', 'Met with the student; will follow up next week.')
            ->call('saveSession');

        $this->assertSame(1, CounsellingSession::count());
        $this->assertSame('seen_by_counsellor', $concern->fresh()->referral_status);
    }

    public function test_a_non_counsellor_cannot_open_the_portal(): void
    {
        $nurse = $this->staffMember('school_nurse');

        Volt::actingAs($nurse)->test('counselling.portal')->assertForbidden();
    }

    // ---------------------------------------------------------------
    //  Audit
    // ---------------------------------------------------------------

    public function test_opening_a_health_record_writes_an_audit_row(): void
    {
        $this->grantConsent(HealthAccessService::PURPOSE_PHYSICAL);

        Volt::actingAs($this->guardian)->test('health.show', ['student' => $this->child]);

        $this->assertTrue(
            HealthAccessLog::where('actor_user_id', $this->guardian->id)
                ->where('student_user_id', $this->child->id)
                ->where('action', 'viewed')
                ->exists()
        );
    }

    public function test_a_refused_open_is_recorded_as_denied(): void
    {
        $this->grantConsent(HealthAccessService::PURPOSE_PHYSICAL);
        $teacher = $this->staffMember('teacher');

        Volt::actingAs($teacher)->test('health.show', ['student' => $this->child])->assertForbidden();

        $this->assertTrue(
            HealthAccessLog::where('actor_user_id', $teacher->id)->where('action', 'denied')->exists()
        );
    }
}
