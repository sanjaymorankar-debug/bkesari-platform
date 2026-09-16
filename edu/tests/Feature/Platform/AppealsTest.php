<?php

namespace Tests\Feature\Platform;

use App\Models\Appeal;
use App\Models\Complaint;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Livewire\Volt\Volt;
use Tests\Feature\Platform\Concerns\SetsUpPlatformData;
use Tests\TestCase;

class AppealsTest extends TestCase
{
    use RefreshDatabase, SetsUpPlatformData;

    private function makeEscalatedComplaint(): array
    {
        $school = $this->makeSchool();
        $category = $this->makeCategory();
        $parent = $this->makeVerifiedParent($school);
        $schoolAdmin = $this->makeSchoolAdmin($school);

        Volt::actingAs($parent)->test('complaints.create')
            ->set('schoolId', (string) $school->id)
            ->set('complaintCategoryId', (string) $category->id)
            ->set('subject', 'Unsafe playground equipment')
            ->set('description', 'The swing set has a broken chain and is a safety hazard for students.')
            ->call('submit');

        $complaint = Complaint::firstOrFail();

        Volt::actingAs($schoolAdmin)->test('complaints.show', ['complaint' => $complaint])
            ->set('responseMessage', 'We have repaired the equipment.')
            ->call('markResolutionProposed');

        Volt::actingAs($parent)->test('complaints.show', ['complaint' => $complaint->fresh()])
            ->set('confirmChoice', 'no')
            ->call('confirmResolution');

        return [$school, $parent, $complaint->fresh()];
    }

    public function test_submitter_can_file_an_appeal_on_an_escalated_complaint(): void
    {
        [$school, $parent, $complaint] = $this->makeEscalatedComplaint();

        Volt::actingAs($parent)->test('appeals.create', ['complaint' => $complaint])
            ->set('reason', 'The school never actually fixed the equipment, it is still broken.')
            ->call('submit');

        $appeal = Appeal::first();
        $this->assertNotNull($appeal);
        $this->assertSame('submitted', $appeal->status);
        $this->assertSame($complaint->id, $appeal->complaint_id);
        $this->assertSame($complaint->anonymous_ref, $appeal->anonymous_ref);
    }

    public function test_cannot_file_a_second_appeal_for_the_same_complaint(): void
    {
        [$school, $parent, $complaint] = $this->makeEscalatedComplaint();

        Volt::actingAs($parent)->test('appeals.create', ['complaint' => $complaint])
            ->set('reason', 'The school never actually fixed the equipment, it is still broken.')
            ->call('submit');

        Volt::actingAs($parent)->test('appeals.create', ['complaint' => $complaint->fresh()])
            ->assertStatus(422);
    }

    public function test_unrelated_user_cannot_file_an_appeal_on_someone_elses_complaint(): void
    {
        [$school, $parent, $complaint] = $this->makeEscalatedComplaint();
        $otherParent = $this->makeVerifiedParent($school);

        Volt::actingAs($otherParent)->test('appeals.create', ['complaint' => $complaint])
            ->assertForbidden();
    }

    public function test_state_officer_in_jurisdiction_can_review_and_decide_appeal(): void
    {
        [$school, $parent, $complaint] = $this->makeEscalatedComplaint();
        $stateOfficer = $this->makeStateOfficer($school);

        Volt::actingAs($parent)->test('appeals.create', ['complaint' => $complaint])
            ->set('reason', 'The school never actually fixed the equipment, it is still broken.')
            ->call('submit');

        $appeal = Appeal::firstOrFail();

        Volt::actingAs($stateOfficer)->test('appeals.show', ['appeal' => $appeal])
            ->assertOk()
            ->call('beginReview');

        $this->assertSame('under_review', $appeal->fresh()->status);

        Volt::actingAs($stateOfficer)->test('appeals.show', ['appeal' => $appeal->fresh()])
            ->set('decisionNote', 'Confirmed with the school — repairs were not completed as claimed.')
            ->call('decide', 'upheld');

        $appeal->refresh();
        $this->assertSame('upheld', $appeal->status);
        $this->assertNotNull($appeal->reviewed_by_user_id);
        $this->assertNotNull($appeal->resolved_at);
    }

    public function test_district_officer_cannot_review_appeal_against_their_own_district(): void
    {
        [$school, $parent, $complaint] = $this->makeEscalatedComplaint();
        $districtOfficer = $this->makeDistrictOfficer($school);

        Volt::actingAs($parent)->test('appeals.create', ['complaint' => $complaint])
            ->set('reason', 'The school never actually fixed the equipment, it is still broken.')
            ->call('submit');

        $appeal = Appeal::firstOrFail();

        Volt::actingAs($districtOfficer)->test('appeals.show', ['appeal' => $appeal])
            ->assertForbidden();
    }

    public function test_state_officer_outside_jurisdiction_cannot_review_appeal(): void
    {
        [$school, $parent, $complaint] = $this->makeEscalatedComplaint();
        $otherSchool = $this->makeSchool();
        $outsideStateOfficer = $this->makeStateOfficer($otherSchool);

        Volt::actingAs($parent)->test('appeals.create', ['complaint' => $complaint])
            ->set('reason', 'The school never actually fixed the equipment, it is still broken.')
            ->call('submit');

        $appeal = Appeal::firstOrFail();

        Volt::actingAs($outsideStateOfficer)->test('appeals.show', ['appeal' => $appeal])
            ->assertForbidden();
    }
}
