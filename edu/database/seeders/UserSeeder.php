<?php

namespace Database\Seeders;

use App\Models\District;
use App\Models\OfficerJurisdiction;
use App\Models\ParentProfile;
use App\Models\ParentSchoolRelationship;
use App\Models\School;
use App\Models\SchoolStaff;
use App\Models\State;
use App\Models\StudentProfile;
use App\Models\StudentSchoolRelationship;
use App\Models\TeacherProfile;
use App\Models\TeacherSchoolRelationship;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

/**
 * All accounts here are synthetic — fabricated names/emails, no real
 * children's data (spec section AR). Demo password for every named test
 * account below is the same fixed value so TEST_ACCOUNTS.md stays simple;
 * this is a throwaway test environment, not production data.
 */
class UserSeeder extends Seeder
{
    private const DEMO_PASSWORD = 'Password123!';

    public function run(): void
    {
        $this->createNamedDemoAccounts();
        $this->createBulkParentsAndStudents();
        $this->createBulkTeachers();
    }

    private function createNamedDemoAccounts(): void
    {
        $admin = User::factory()->create([
            'name' => 'System Administrator',
            'email' => 'admin@test.agtci.com',
            'password' => Hash::make(self::DEMO_PASSWORD),
        ]);
        $admin->assignRole('system_admin');

        $national = User::factory()->create([
            'name' => 'National Admin (Demo)',
            'email' => 'national.admin@test.agtci.com',
            'password' => Hash::make(self::DEMO_PASSWORD),
        ]);
        $national->assignRole('national_admin');

        $researcher = User::factory()->create([
            'name' => 'Researcher (Demo)',
            'email' => 'researcher@test.agtci.com',
            'password' => Hash::make(self::DEMO_PASSWORD),
        ]);
        $researcher->assignRole('researcher');

        // Spec section 6 roles 7 and 17. Both roles existed with no account to
        // log in as, which meant the consent/data-rights and career-mentor
        // screens could not actually be opened in the demo.
        $dpo = User::factory()->create([
            'name' => 'Data Protection Officer (Demo)',
            'email' => 'dpo@test.agtci.com',
            'password' => Hash::make(self::DEMO_PASSWORD),
        ]);
        $dpo->assignRole('data_protection_officer');

        $careerMentor = User::factory()->create([
            'name' => 'Career & Life-Skills Mentor (Demo)',
            'email' => 'career.mentor@test.agtci.com',
            'password' => Hash::make(self::DEMO_PASSWORD),
        ]);
        $careerMentor->assignRole('career_mentor');

        foreach (State::all() as $state) {
            $officer = User::factory()->create([
                'name' => "State Officer - {$state->name} (Demo)",
                'email' => 'state.'.strtolower($state->code).'@test.agtci.com',
                'password' => Hash::make(self::DEMO_PASSWORD),
            ]);
            $officer->assignRole('state_officer');
            OfficerJurisdiction::create(['user_id' => $officer->id, 'level' => 'state', 'state_id' => $state->id]);
        }

        foreach (District::all() as $district) {
            $officer = User::factory()->create([
                'name' => "District Officer - {$district->name} (Demo)",
                'email' => 'district.'.strtolower($district->code).'@test.agtci.com',
                'password' => Hash::make(self::DEMO_PASSWORD),
            ]);
            $officer->assignRole('district_officer');
            OfficerJurisdiction::create(['user_id' => $officer->id, 'level' => 'district', 'district_id' => $district->id]);
        }

        $demoSchool = School::first();
        $demoAdmin = User::factory()->create([
            'name' => 'School Admin (Demo)',
            'email' => 'school.admin@test.agtci.com',
            'password' => Hash::make(self::DEMO_PASSWORD),
        ]);
        $demoAdmin->assignRole('school_admin');
        SchoolStaff::create(['user_id' => $demoAdmin->id, 'school_id' => $demoSchool->id, 'designation' => 'Principal']);

        // The mentor needs a staff assignment at the demo school, or every
        // per-child access check refuses them and the role is unusable.
        SchoolStaff::create([
            'user_id' => $careerMentor->id,
            'school_id' => $demoSchool->id,
            'designation' => 'Career & Life-Skills Mentor',
        ]);

        $demoParent = User::factory()->create([
            'name' => 'Parent (Demo)',
            'email' => 'parent@test.agtci.com',
            'password' => Hash::make(self::DEMO_PASSWORD),
        ]);
        $demoParent->assignRole('parent');
        ParentProfile::create(['user_id' => $demoParent->id, 'phone' => '9800000001', 'verified_at' => now(), 'verification_method' => 'otp']);
        $demoParentRelationship = ParentSchoolRelationship::create([
            'user_id' => $demoParent->id, 'school_id' => $demoSchool->id,
            'status' => 'verified', 'verified_at' => now(),
        ]);

        $demoStudent = User::factory()->create([
            'name' => 'Student (Demo)',
            'email' => 'student@test.agtci.com',
            'password' => Hash::make(self::DEMO_PASSWORD),
        ]);
        $demoStudent->assignRole('student');
        StudentProfile::create(['user_id' => $demoStudent->id, 'verified_at' => now(), 'verification_method' => 'school_id']);
        StudentSchoolRelationship::create([
            'user_id' => $demoStudent->id, 'school_id' => $demoSchool->id,
            'class_grade' => '8', 'status' => 'verified', 'verified_at' => now(),
        ]);

        // Make the demo parent the demo student's verified guardian. Consent
        // and the growth modules are per child, so without this link the demo
        // parent has no child to give consent for.
        $demoParentRelationship->update(['student_user_id' => $demoStudent->id]);

        $demoTeacher = User::factory()->create([
            'name' => 'Teacher (Demo)',
            'email' => 'teacher@test.agtci.com',
            'password' => Hash::make(self::DEMO_PASSWORD),
        ]);
        $demoTeacher->assignRole('teacher');
        TeacherProfile::create(['user_id' => $demoTeacher->id, 'subject_specialization' => 'Mathematics']);
        TeacherSchoolRelationship::create([
            'user_id' => $demoTeacher->id, 'school_id' => $demoSchool->id,
            'status' => 'verified', 'verified_at' => now(),
        ]);

        // A school admin per remaining school, so every district officer has real data to review.
        foreach (School::where('id', '!=', $demoSchool->id)->get() as $school) {
            $staffUser = User::factory()->create(['password' => Hash::make(self::DEMO_PASSWORD)]);
            $staffUser->assignRole('school_admin');
            SchoolStaff::create(['user_id' => $staffUser->id, 'school_id' => $school->id, 'designation' => 'Principal']);
        }
    }

    private function createBulkParentsAndStudents(): void
    {
        $schools = School::all();

        for ($i = 0; $i < 100; $i++) {
            $school = $schools->random();

            $parent = User::factory()->create(['password' => Hash::make(self::DEMO_PASSWORD)]);
            $parent->assignRole('parent');
            ParentProfile::create([
                'user_id' => $parent->id,
                'phone' => fake()->numerify('98########'),
                'verified_at' => fake()->boolean(85) ? now() : null,
                'verification_method' => 'otp',
            ]);

            $student = User::factory()->create(['password' => Hash::make(self::DEMO_PASSWORD)]);
            $student->assignRole('student');
            StudentProfile::create([
                'user_id' => $student->id,
                'date_of_birth' => fake()->dateTimeBetween('-17 years', '-6 years'),
                'gender' => fake()->randomElement(['male', 'female', 'other']),
                'verified_at' => fake()->boolean(85) ? now() : null,
                'verification_method' => 'school_id',
            ]);

            ParentSchoolRelationship::create([
                'user_id' => $parent->id,
                'school_id' => $school->id,
                'student_user_id' => $student->id,
                'status' => 'verified',
                'verified_at' => now(),
            ]);

            StudentSchoolRelationship::create([
                'user_id' => $student->id,
                'school_id' => $school->id,
                'class_grade' => (string) fake()->numberBetween(1, 12),
                'status' => 'verified',
                'verified_at' => now(),
            ]);
        }
    }

    private function createBulkTeachers(): void
    {
        $schools = School::all();

        for ($i = 0; $i < 50; $i++) {
            $teacher = User::factory()->create(['password' => Hash::make(self::DEMO_PASSWORD)]);
            $teacher->assignRole('teacher');
            TeacherProfile::create([
                'user_id' => $teacher->id,
                'subject_specialization' => fake()->randomElement(['Mathematics', 'Science', 'English', 'Social Studies', 'Computer Science', 'Art']),
                'qualification' => fake()->randomElement(['B.Ed', 'M.Ed', 'M.A. + B.Ed', 'M.Sc + B.Ed']),
                'joining_date' => fake()->dateTimeBetween('-15 years', '-1 year'),
            ]);

            TeacherSchoolRelationship::create([
                'user_id' => $teacher->id,
                'school_id' => $schools->random()->id,
                'status' => 'verified',
                'verified_at' => now(),
            ]);
        }
    }
}
