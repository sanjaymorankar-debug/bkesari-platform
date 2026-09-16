<?php

namespace Tests\Feature\Platform;

use App\Models\Complaint;
use App\Models\District;
use App\Models\OfficerJurisdiction;
use App\Models\School;
use App\Models\State;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Livewire\Volt\Volt;
use Tests\Feature\Platform\Concerns\SetsUpPlatformData;
use Tests\TestCase;

class RbacBoundaryTest extends TestCase
{
    use RefreshDatabase, SetsUpPlatformData;

    private function makeComplaint(School $school, string $anonymousRef = 'ANON-TEST0001'): Complaint
    {
        $category = $this->makeCategory();

        return Complaint::create([
            'complaint_number' => Complaint::generateComplaintNumber($school->state, $school->district),
            'school_id' => $school->id,
            'complaint_category_id' => $category->id,
            'district_id' => $school->district_id,
            'state_id' => $school->state_id,
            'anonymous_ref' => $anonymousRef,
            'submitted_role' => 'parent',
            'subject' => 'Test complaint',
            'description' => 'Test complaint description for RBAC boundary checks.',
            'severity' => 'medium',
            'status' => 'submitted',
        ]);
    }

    public function test_school_admin_cannot_view_complaint_from_another_school(): void
    {
        $schoolA = $this->makeSchool();
        $schoolB = $this->makeSchool();
        $adminOfA = $this->makeSchoolAdmin($schoolA);

        $complaintForB = $this->makeComplaint($schoolB);

        Volt::actingAs($adminOfA)->test('complaints.show', ['complaint' => $complaintForB])
            ->assertForbidden();
    }

    public function test_district_officer_outside_jurisdiction_cannot_view_complaint(): void
    {
        $school = $this->makeSchool();
        $complaint = $this->makeComplaint($school);

        $otherState = State::create(['name' => 'Karnataka', 'code' => 'KA']);
        $otherDistrict = District::create(['state_id' => $otherState->id, 'name' => 'Bengaluru Urban', 'code' => 'BLR']);

        $outsideOfficer = User::factory()->create();
        $outsideOfficer->assignRole('district_officer');
        OfficerJurisdiction::create(['user_id' => $outsideOfficer->id, 'level' => 'district', 'district_id' => $otherDistrict->id]);

        Volt::actingAs($outsideOfficer)->test('complaints.show', ['complaint' => $complaint])
            ->assertForbidden();
    }

    public function test_district_officer_within_jurisdiction_can_view_complaint(): void
    {
        $school = $this->makeSchool();
        $complaint = $this->makeComplaint($school);

        $officer = User::factory()->create();
        $officer->assignRole('district_officer');
        OfficerJurisdiction::create(['user_id' => $officer->id, 'level' => 'district', 'district_id' => $school->district_id]);

        Volt::actingAs($officer)->test('complaints.show', ['complaint' => $complaint])
            ->assertOk();
    }

    public function test_unrelated_parent_cannot_view_someone_elses_complaint(): void
    {
        $school = $this->makeSchool();
        $complaint = $this->makeComplaint($school);
        $unrelatedParent = $this->makeVerifiedParent($school);

        Volt::actingAs($unrelatedParent)->test('complaints.show', ['complaint' => $complaint])
            ->assertForbidden();
    }

    public function test_school_admin_cannot_respond_to_complaint_without_respond_permission_context(): void
    {
        $school = $this->makeSchool();
        $complaint = $this->makeComplaint($school);

        // A school_admin role exists but this user has no school_staff row anywhere.
        $rogueAdmin = User::factory()->create();
        $rogueAdmin->assignRole('school_admin');

        Volt::actingAs($rogueAdmin)->test('complaints.show', ['complaint' => $complaint])
            ->assertForbidden();
    }
}
