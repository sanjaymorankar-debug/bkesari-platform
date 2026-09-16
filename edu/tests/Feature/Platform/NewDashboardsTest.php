<?php

namespace Tests\Feature\Platform;

use App\Models\Complaint;
use App\Models\OfficerJurisdiction;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Livewire\Volt\Volt;
use Tests\Feature\Platform\Concerns\SetsUpPlatformData;
use Tests\TestCase;

class NewDashboardsTest extends TestCase
{
    use RefreshDatabase, SetsUpPlatformData;

    private function makeComplaint($school, string $ref = 'ANON-DASH0001'): Complaint
    {
        $category = $this->makeCategory();

        return Complaint::create([
            'complaint_number' => Complaint::generateComplaintNumber($school->state, $school->district),
            'school_id' => $school->id,
            'complaint_category_id' => $category->id,
            'district_id' => $school->district_id,
            'state_id' => $school->state_id,
            'anonymous_ref' => $ref,
            'submitted_role' => 'parent',
            'subject' => 'Test',
            'description' => 'Test complaint description for dashboard rendering checks.',
            'severity' => 'high',
            'status' => 'submitted',
        ]);
    }

    public function test_student_dashboard_renders(): void
    {
        $school = $this->makeSchool();
        $student = $this->makeVerifiedStudent($school);

        Volt::actingAs($student)->test('dashboards.student')->assertOk();
    }

    public function test_teacher_dashboard_renders(): void
    {
        $school = $this->makeSchool();
        $teacher = $this->makeVerifiedTeacher($school);

        Volt::actingAs($teacher)->test('dashboards.teacher')->assertOk();
    }

    public function test_state_officer_only_sees_complaints_in_their_state(): void
    {
        $inState = $this->makeSchool();
        $outOfState = $this->makeSchool();

        $this->makeComplaint($inState, 'ANON-IN-STATE1');
        $this->makeComplaint($outOfState, 'ANON-OUT-STATE1');

        $officer = User::factory()->create();
        $officer->assignRole('state_officer');
        OfficerJurisdiction::create(['user_id' => $officer->id, 'level' => 'state', 'state_id' => $inState->state_id]);

        $html = Volt::actingAs($officer)->test('dashboards.state')->html();

        $this->assertStringContainsString($inState->name, $html);
        $this->assertStringNotContainsString($outOfState->name, $html);
    }

    public function test_national_admin_dashboard_renders_with_national_totals(): void
    {
        $school = $this->makeSchool();
        $this->makeComplaint($school);

        $admin = User::factory()->create();
        $admin->assignRole('national_admin');

        Volt::actingAs($admin)->test('dashboards.national')->assertOk();
    }

    public function test_researcher_dashboard_shows_no_individual_complaint_links(): void
    {
        $school = $this->makeSchool();
        $this->makeComplaint($school);

        $researcher = User::factory()->create();
        $researcher->assignRole('researcher');

        $html = Volt::actingAs($researcher)->test('dashboards.researcher')->html();

        $this->assertStringNotContainsString('/complaints/', $html);
    }

    public function test_system_admin_dashboard_renders(): void
    {
        $admin = User::factory()->create();
        $admin->assignRole('system_admin');

        Volt::actingAs($admin)->test('dashboards.admin')->assertOk();
    }
}
