<?php

namespace Tests\Feature\Platform;

use App\Models\Complaint;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Livewire\Volt\Volt;
use Tests\Feature\Platform\Concerns\SetsUpPlatformData;
use Tests\TestCase;

class ComplaintFlowTest extends TestCase
{
    use RefreshDatabase, SetsUpPlatformData;

    public function test_verified_parent_can_submit_complaint_and_get_complaint_id(): void
    {
        $school = $this->makeSchool();
        $category = $this->makeCategory();
        $parent = $this->makeVerifiedParent($school);

        Volt::actingAs($parent)->test('complaints.create')
            ->set('schoolId', (string) $school->id)
            ->set('complaintCategoryId', (string) $category->id)
            ->set('subject', 'Bus arrives very late every day')
            ->set('description', 'The school bus has been arriving 45 minutes late for the past two weeks.')
            ->set('severity', 'medium')
            ->call('submit')
            ->assertRedirect();

        $complaint = Complaint::first();

        $this->assertNotNull($complaint);
        $this->assertStringStartsWith('EDU-'.$school->state->code.'-'.$school->district->code.'-', $complaint->complaint_number);
        $this->assertSame('submitted', $complaint->status);
        $this->assertSame('parent', $complaint->submitted_role);
    }

    public function test_unverified_user_cannot_submit_complaint_for_school_they_are_not_linked_to(): void
    {
        $school = $this->makeSchool();
        $category = $this->makeCategory();

        $unlinkedParent = \App\Models\User::factory()->create();
        $unlinkedParent->assignRole('parent');

        Volt::actingAs($unlinkedParent)->test('complaints.create')
            ->set('schoolId', (string) $school->id)
            ->set('complaintCategoryId', (string) $category->id)
            ->set('subject', 'Test subject')
            ->set('description', 'Description long enough to pass validation rules here.')
            ->call('submit')
            ->assertForbidden();

        $this->assertSame(0, Complaint::count());
    }

    public function test_full_submit_respond_confirm_resolution_cycle(): void
    {
        $school = $this->makeSchool();
        $category = $this->makeCategory();
        $parent = $this->makeVerifiedParent($school);
        $schoolAdmin = $this->makeSchoolAdmin($school);

        Volt::actingAs($parent)->test('complaints.create')
            ->set('schoolId', (string) $school->id)
            ->set('complaintCategoryId', (string) $category->id)
            ->set('subject', 'Fee receipt not issued')
            ->set('description', 'Paid the term fee two weeks ago and still no receipt has been issued.')
            ->call('submit');

        $complaint = Complaint::firstOrFail();

        Volt::actingAs($schoolAdmin)->test('complaints.show', ['complaint' => $complaint])
            ->set('responseMessage', 'We have located your payment and are issuing the receipt.')
            ->call('markResolutionProposed');

        $complaint->refresh();
        $this->assertSame('action_taken', $complaint->status);
        $this->assertSame('pending', $complaint->resolution->confirmed_by_submitter);

        Volt::actingAs($parent)->test('complaints.show', ['complaint' => $complaint])
            ->set('confirmChoice', 'yes')
            ->call('confirmResolution');

        $complaint->refresh();
        $this->assertSame('resolved', $complaint->status);
        $this->assertSame('yes', $complaint->resolution->confirmed_by_submitter);
    }

    public function test_confirming_no_escalates_the_complaint(): void
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

        $complaint->refresh();
        $this->assertSame('escalated', $complaint->status);
        $this->assertTrue((bool) $complaint->resolution->escalated);
    }
}
