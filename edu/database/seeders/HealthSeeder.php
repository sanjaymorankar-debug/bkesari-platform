<?php

namespace Database\Seeders;

use App\Models\CounsellingSession;
use App\Models\HealthFollowup;
use App\Models\ParentSchoolRelationship;
use App\Models\PhysicalHealthRecord;
use App\Models\SchoolStaff;
use App\Models\User;
use App\Models\WellbeingConcern;
use App\Services\ConsentService;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

/**
 * Demo health and wellbeing data (spec sections 18-21), built on the same
 * parent/student accounts the growth seeder uses.
 *
 * Deliberately included: an open, overdue follow-up, and one counselling
 * session with no shared summary. Both are states the UI has to handle
 * honestly, and a demo where every follow-up is closed and every session
 * neatly summarised would hide them.
 */
class HealthSeeder extends Seeder
{
    use WithoutModelEvents;

    public function run(): void
    {
        $parent = User::where('email', 'parent@test.agtci.com')->first();
        $student = User::where('email', 'student@test.agtci.com')->first();

        if (! $parent || ! $student) {
            return;
        }

        $relationship = ParentSchoolRelationship::where('user_id', $parent->id)
            ->where('student_user_id', $student->id)
            ->where('status', 'verified')
            ->first();

        if (! $relationship) {
            return;
        }

        $schoolId = $relationship->school_id;

        $nurse = $this->staff('school.nurse@test.agtci.com', 'School Nurse', 'school_nurse', $schoolId);
        $counsellor = $this->staff('counsellor@test.agtci.com', 'School Counsellor', 'counsellor', $schoolId);

        // Nothing below is reachable without this (DPDP Act section 9).
        $consent = app(ConsentService::class);
        foreach (['physical_health', 'mental_wellbeing'] as $purpose) {
            $consent->grant($parent, $student->id, $purpose);
        }

        // Three years of screenings, so the record reads as a history rather
        // than a snapshot.
        $screenings = [
            ['2024-25', '2024-07-15', 138.0, 32.5, '6/6', '6/6', null],
            ['2025-26', '2025-07-20', 144.5, 37.0, '6/6', '6/9', null],
            ['2026-27', '2026-07-18', 150.0, 41.5, '6/6', '6/12', 'Reduced vision in the right eye since last year.'],
        ];

        $latest = null;

        foreach ($screenings as [$year, $date, $height, $weight, $visionL, $visionR, $concern]) {
            $record = PhysicalHealthRecord::create([
                'student_user_id' => $student->id,
                'school_id' => $schoolId,
                'academic_year' => $year,
                'examination_date' => $date,
                'examination_type' => 'annual_screening',
                'height_cm' => $height,
                'weight_kg' => $weight,
                'vision_left' => $visionL,
                'vision_right' => $visionR,
                'hearing' => 'normal',
                'dental' => 'normal',
                'health_concerns' => $concern,
                'recommendations' => $concern ? 'Referred for an eye test.' : null,
                'next_due_date' => date('Y-m-d', strtotime($date.' +1 year')),
                'recorded_by_user_id' => $nurse->id,
                'recorded_by_designation' => 'School Nurse',
            ]);

            $record->update(['bmi' => $record->calculatedBmi()]);

            $latest = $record;
        }

        // An open follow-up, already past its due date — the case that makes
        // the lifecycle worth having.
        HealthFollowup::create([
            'student_user_id' => $student->id,
            'school_id' => $schoolId,
            'physical_health_record_id' => $latest?->id,
            'area' => 'vision',
            'finding' => 'Right eye 6/12, down from 6/9 last year.',
            'recommended_action' => 'Eye test with an optometrist; report back to the school nurse.',
            'status' => 'referred',
            'identified_on' => '2026-07-18',
            'due_on' => '2026-08-18',
            'opened_by_user_id' => $nurse->id,
        ]);

        // A teacher observation nobody has picked up yet, so the counsellor's
        // queue is not empty.
        $teacher = User::where('email', 'teacher@test.agtci.com')->first();

        if ($teacher) {
            WellbeingConcern::create([
                'student_user_id' => $student->id,
                'school_id' => $schoolId,
                'observation' => 'Has been quieter than usual for about two weeks and is not joining group work.',
                'context' => 'Noticed in class and at break',
                'observed_on' => now()->subDays(9)->toDateString(),
                'raised_by_user_id' => $teacher->id,
                'raised_by_role' => 'teacher',
            ]);
        }

        // One session with a summary the guardian sees, and one without —
        // the second is what tests the "share nothing rather than fall back"
        // rule in the UI.
        CounsellingSession::create([
            'student_user_id' => $student->id,
            'school_id' => $schoolId,
            'session_date' => now()->subDays(30)->toDateString(),
            'session_type' => 'initial',
            'session_notes' => 'Working notes from the first session. Counsellor-only.',
            'shareable_summary' => 'We had a first conversation about settling into the new class. '
                .'Nothing of concern; we agreed to meet again in a few weeks.',
            'support_plan' => 'Check in fortnightly; class teacher to seat her with a familiar group.',
            'counsellor_user_id' => $counsellor->id,
        ]);

        CounsellingSession::create([
            'student_user_id' => $student->id,
            'school_id' => $schoolId,
            'session_date' => now()->subDays(5)->toDateString(),
            'session_type' => 'follow_up',
            'session_notes' => 'Working notes from the follow-up session. Counsellor-only.',
            'shareable_summary' => null,
            'counsellor_user_id' => $counsellor->id,
        ]);
    }

    private function staff(string $email, string $name, string $role, int $schoolId): User
    {
        $user = User::firstOrCreate(
            ['email' => $email],
            ['name' => $name, 'password' => Hash::make('Password123!'), 'email_verified_at' => now()]
        );

        if (! $user->hasRole($role)) {
            $user->assignRole($role);
        }

        SchoolStaff::firstOrCreate(
            ['user_id' => $user->id, 'school_id' => $schoolId],
            ['designation' => $name]
        );

        return $user;
    }
}
