<?php

namespace Tests\Feature\Platform\Concerns;

use App\Models\ComplaintCategory;
use App\Models\District;
use App\Models\OfficerJurisdiction;
use App\Models\ParentSchoolRelationship;
use App\Models\School;
use App\Models\SchoolStaff;
use App\Models\State;
use App\Models\StudentSchoolRelationship;
use App\Models\TeacherSchoolRelationship;
use App\Models\User;

trait SetsUpPlatformData
{
    protected function makeSchool(): School
    {
        $unique = strtoupper(substr(uniqid(), -6));
        $state = State::create(['name' => 'Test State '.$unique, 'code' => 'S'.$unique]);
        $district = District::create(['state_id' => $state->id, 'name' => 'Test District '.$unique, 'code' => 'D'.$unique]);

        return School::create([
            'school_code' => 'SCH-TEST-'.$unique,
            'name' => 'Test Public School '.$unique,
            'board' => 'CBSE',
            'management_type' => 'private',
            'state_id' => $state->id,
            'district_id' => $district->id,
            'address' => '123 Test Street',
            'city' => 'Pune',
            'pincode' => '411001',
            'recognition_status' => 'verified',
            'classes_from' => 'Nursery',
            'classes_to' => 'Class 12',
        ]);
    }

    protected function makeCategory(bool $childSafety = false): ComplaintCategory
    {
        return ComplaintCategory::create([
            'name' => 'Infrastructure',
            'slug' => 'infrastructure-'.uniqid(),
            'is_child_safety' => $childSafety,
            'is_active' => true,
        ]);
    }

    protected function makeVerifiedParent(School $school): User
    {
        $user = User::factory()->create();
        $user->assignRole('parent');

        ParentSchoolRelationship::create([
            'user_id' => $user->id,
            'school_id' => $school->id,
            'status' => 'verified',
            'verified_at' => now(),
        ]);

        return $user;
    }

    /**
     * A parent verified as the guardian of one specific child — the link the
     * consent and growth modules key off, since consent is per child.
     */
    protected function makeGuardianOf(School $school, User $student): User
    {
        $user = User::factory()->create();
        $user->assignRole('parent');

        ParentSchoolRelationship::create([
            'user_id' => $user->id,
            'school_id' => $school->id,
            'student_user_id' => $student->id,
            'status' => 'verified',
            'verified_at' => now(),
        ]);

        return $user;
    }

    protected function makeVerifiedStudent(School $school): User
    {
        $user = User::factory()->create();
        $user->assignRole('student');

        StudentSchoolRelationship::create([
            'user_id' => $user->id,
            'school_id' => $school->id,
            'status' => 'verified',
            'verified_at' => now(),
        ]);

        return $user;
    }

    protected function makeSchoolAdmin(School $school): User
    {
        $user = User::factory()->create();
        $user->assignRole('school_admin');

        SchoolStaff::create(['user_id' => $user->id, 'school_id' => $school->id, 'designation' => 'Principal']);

        return $user;
    }

    protected function makeVerifiedTeacher(School $school): User
    {
        $user = User::factory()->create();
        $user->assignRole('teacher');

        TeacherSchoolRelationship::create([
            'user_id' => $user->id,
            'school_id' => $school->id,
            'status' => 'verified',
            'verified_at' => now(),
        ]);

        return $user;
    }

    protected function makeDistrictOfficer(School $school): User
    {
        $user = User::factory()->create();
        $user->assignRole('district_officer');

        OfficerJurisdiction::create(['user_id' => $user->id, 'level' => 'district', 'district_id' => $school->district_id]);

        return $user;
    }

    protected function makeStateOfficer(School $school): User
    {
        $user = User::factory()->create();
        $user->assignRole('state_officer');

        OfficerJurisdiction::create(['user_id' => $user->id, 'level' => 'state', 'state_id' => $school->state_id]);

        return $user;
    }
}
