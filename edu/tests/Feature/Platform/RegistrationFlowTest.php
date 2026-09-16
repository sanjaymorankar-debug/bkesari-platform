<?php

namespace Tests\Feature\Platform;

use App\Models\District;
use App\Models\OfficerJurisdiction;
use App\Models\ParentSchoolRelationship;
use App\Models\School;
use App\Models\SchoolStaff;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Livewire\Volt\Volt;
use Tests\Feature\Platform\Concerns\SetsUpPlatformData;
use Tests\TestCase;

class RegistrationFlowTest extends TestCase
{
    use RefreshDatabase, SetsUpPlatformData;

    public function test_guest_can_register_a_school_and_becomes_its_admin(): void
    {
        $state = \App\Models\State::create(['name' => 'Test State', 'code' => 'TS1']);
        $district = District::create(['state_id' => $state->id, 'name' => 'Test District', 'code' => 'TD1']);

        Volt::test('schools.register')
            ->set('adminName', 'New Principal')
            ->set('adminEmail', 'newprincipal@example.com')
            ->set('adminPassword', 'Password123!')
            ->set('adminPassword_confirmation', 'Password123!')
            ->set('name', 'Brand New School')
            ->set('board', 'CBSE')
            ->set('managementType', 'private')
            ->set('stateId', (string) $state->id)
            ->set('districtId', (string) $district->id)
            ->set('address', '1 New Street')
            ->set('city', 'Testville')
            ->set('pincode', '123456')
            ->call('register');

        $school = School::where('name', 'Brand New School')->firstOrFail();
        $this->assertSame('pending', $school->recognition_status);

        $admin = User::where('email', 'newprincipal@example.com')->firstOrFail();
        $this->assertTrue($admin->hasRole('school_admin'));
        $this->assertTrue(SchoolStaff::where('user_id', $admin->id)->where('school_id', $school->id)->exists());
        $this->assertAuthenticatedAs($admin);
    }

    public function test_school_registration_creates_additional_staff_with_credentials(): void
    {
        $state = \App\Models\State::create(['name' => 'Test State', 'code' => 'TS2']);
        $district = District::create(['state_id' => $state->id, 'name' => 'Test District', 'code' => 'TD2']);

        $component = Volt::test('schools.register')
            ->set('adminName', 'Owner')
            ->set('adminEmail', 'owner@example.com')
            ->set('adminPassword', 'Password123!')
            ->set('adminPassword_confirmation', 'Password123!')
            ->set('name', 'Staffed School')
            ->set('board', 'CBSE')
            ->set('managementType', 'private')
            ->set('stateId', (string) $state->id)
            ->set('districtId', (string) $district->id)
            ->set('address', '1 New Street')
            ->set('city', 'Testville')
            ->set('pincode', '123456')
            ->set('additionalStaff.0.name', 'Op Erator')
            ->set('additionalStaff.0.email', 'operator@example.com')
            ->set('additionalStaff.0.designation', 'Operator')
            ->call('register');

        $operator = User::where('email', 'operator@example.com')->firstOrFail();
        $this->assertTrue($operator->hasRole('school_admin'));
        $component->assertSet('submitted', true);
    }

    public function test_parent_onboarding_creates_pending_relationship(): void
    {
        $school = $this->makeSchool();
        $parent = User::factory()->create();
        $parent->assignRole('parent');

        Volt::actingAs($parent)->test('onboarding.index')
            ->set('schoolId', (string) $school->id)
            ->set('phone', '9876543210')
            ->call('link');

        $this->assertDatabaseHas('parent_school_relationships', [
            'user_id' => $parent->id,
            'school_id' => $school->id,
            'status' => 'pending',
        ]);
    }

    public function test_school_admin_can_approve_pending_parent_relationship(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);

        $parent = User::factory()->create();
        $parent->assignRole('parent');
        $relationship = ParentSchoolRelationship::create([
            'user_id' => $parent->id,
            'school_id' => $school->id,
            'status' => 'pending',
        ]);

        Volt::actingAs($admin)->test('dashboards.school')
            ->call('approveParent', $relationship->id);

        $this->assertSame('verified', $relationship->fresh()->status);
    }

    public function test_school_admin_cannot_approve_relationship_for_another_school(): void
    {
        $schoolA = $this->makeSchool();
        $schoolB = $this->makeSchool();
        $adminOfA = $this->makeSchoolAdmin($schoolA);

        $parent = User::factory()->create();
        $parent->assignRole('parent');
        $relationship = ParentSchoolRelationship::create([
            'user_id' => $parent->id,
            'school_id' => $schoolB->id,
            'status' => 'pending',
        ]);

        Volt::actingAs($adminOfA)->test('dashboards.school')
            ->call('approveParent', $relationship->id)
            ->assertForbidden();

        $this->assertSame('pending', $relationship->fresh()->status);
    }

    public function test_district_officer_can_verify_pending_school_in_jurisdiction(): void
    {
        $school = $this->makeSchool();
        $school->update(['recognition_status' => 'pending']);

        $officer = User::factory()->create();
        $officer->assignRole('district_officer');
        OfficerJurisdiction::create(['user_id' => $officer->id, 'level' => 'district', 'district_id' => $school->district_id]);

        Volt::actingAs($officer)->test('dashboards.district')
            ->call('approveSchool', $school->id);

        $this->assertSame('verified', $school->fresh()->recognition_status);
    }

    public function test_district_officer_cannot_verify_school_outside_jurisdiction(): void
    {
        $school = $this->makeSchool();
        $school->update(['recognition_status' => 'pending']);

        $otherSchool = $this->makeSchool();
        $officer = User::factory()->create();
        $officer->assignRole('district_officer');
        OfficerJurisdiction::create(['user_id' => $officer->id, 'level' => 'district', 'district_id' => $otherSchool->district_id]);

        Volt::actingAs($officer)->test('dashboards.district')
            ->call('approveSchool', $school->id)
            ->assertForbidden();

        $this->assertSame('pending', $school->fresh()->recognition_status);
    }
}
