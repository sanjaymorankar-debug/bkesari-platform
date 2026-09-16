<?php

namespace Tests\Feature\Platform;

use App\Models\RetaliationReport;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Livewire\Volt\Volt;
use Tests\Feature\Platform\Concerns\SetsUpPlatformData;
use Tests\TestCase;

class RetaliationReportTest extends TestCase
{
    use RefreshDatabase, SetsUpPlatformData;

    public function test_verified_parent_can_submit_retaliation_report(): void
    {
        $school = $this->makeSchool();
        $parent = $this->makeVerifiedParent($school);

        Volt::actingAs($parent)->test('retaliation.create')
            ->set('schoolId', (string) $school->id)
            ->set('category', 'intimidation')
            ->set('description', 'After my complaint the school reduced my child\'s participation in activities.')
            ->call('submit');

        $report = RetaliationReport::first();
        $this->assertNotNull($report);
        $this->assertSame('submitted', $report->status);
        $this->assertSame('intimidation', $report->category);
    }

    public function test_retaliation_report_has_no_user_identifying_column(): void
    {
        $columns = \Illuminate\Support\Facades\Schema::getColumnListing('retaliation_reports');

        $this->assertNotContains('user_id', $columns);
        $this->assertContains('anonymous_ref', $columns);
    }

    public function test_district_officer_can_view_and_update_report_in_jurisdiction(): void
    {
        $school = $this->makeSchool();
        $parent = $this->makeVerifiedParent($school);
        $officer = $this->makeDistrictOfficer($school);

        Volt::actingAs($parent)->test('retaliation.create')
            ->set('schoolId', (string) $school->id)
            ->set('category', 'threats')
            ->set('description', 'A staff member made threatening remarks after I raised a complaint.')
            ->call('submit');

        $report = RetaliationReport::first();

        Volt::actingAs($officer)->test('retaliation.show', ['retaliationReport' => $report])
            ->assertOk()
            ->set('newStatus', 'under_review')
            ->call('updateStatus');

        $this->assertSame('under_review', $report->fresh()->status);
    }

    public function test_district_officer_outside_jurisdiction_cannot_view_report(): void
    {
        $school = $this->makeSchool();
        $otherSchool = $this->makeSchool();
        $parent = $this->makeVerifiedParent($school);
        $outsideOfficer = $this->makeDistrictOfficer($otherSchool);

        Volt::actingAs($parent)->test('retaliation.create')
            ->set('schoolId', (string) $school->id)
            ->set('category', 'punishment')
            ->set('description', 'Description long enough to pass the minimum length validation rule here.')
            ->call('submit');

        $report = RetaliationReport::first();

        Volt::actingAs($outsideOfficer)->test('retaliation.show', ['retaliationReport' => $report])
            ->assertForbidden();
    }

    public function test_unrelated_user_cannot_view_someone_elses_retaliation_report(): void
    {
        $school = $this->makeSchool();
        $parent = $this->makeVerifiedParent($school);
        $otherParent = $this->makeVerifiedParent($school);

        Volt::actingAs($parent)->test('retaliation.create')
            ->set('schoolId', (string) $school->id)
            ->set('category', 'other')
            ->set('description', 'Description long enough to pass the minimum length validation rule here.')
            ->call('submit');

        $report = RetaliationReport::first();

        Volt::actingAs($otherParent)->test('retaliation.show', ['retaliationReport' => $report])
            ->assertForbidden();
    }
}
