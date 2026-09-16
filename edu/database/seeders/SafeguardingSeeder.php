<?php

namespace Database\Seeders;

use App\Models\AnonymousIdentity;
use App\Models\SafeguardingReport;
use App\Models\School;
use App\Models\SchoolStaff;
use App\Models\User;
use App\Services\SafeguardingService;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

/**
 * Demo safeguarding cases (spec section 25), plus the Child Safety Officer
 * account that handles them.
 *
 * The cases are chosen to show the states that matter: one POCSO case with no
 * external report yet (which the system will refuse to let anyone close), one
 * where an external report has been recorded, and one non-POCSO concern. The
 * descriptions are deliberately bland and synthetic — this is seed data, not a
 * dramatisation of abuse.
 */
class SafeguardingSeeder extends Seeder
{
    use WithoutModelEvents;

    public function run(): void
    {
        $school = School::orderBy('id')->first();

        if (! $school) {
            return;
        }

        $officer = User::firstOrCreate(
            ['email' => 'safety.officer@test.agtci.com'],
            [
                'name' => 'Child Safety Officer',
                'password' => Hash::make('Password123!'),
                'email_verified_at' => now(),
            ]
        );

        if (! $officer->hasRole('child_safety_officer')) {
            $officer->assignRole('child_safety_officer');
        }

        SchoolStaff::firstOrCreate(
            ['user_id' => $officer->id, 'school_id' => $school->id],
            ['designation' => 'Child Safety Officer']
        );

        $service = app(SafeguardingService::class);

        // 1. A POCSO case with no external report recorded. The platform will
        //    block closure on this one until a report to the police or SJPU is
        //    recorded — that is the case the module exists for.
        $blocked = $this->makeReport($school, [
            'category' => 'child_sexual_abuse',
            'description' => 'A concern was raised about the conduct of an adult towards a student. '
                .'Reported here so it is on record and reaches the Child Safety Officer.',
            'immediate_danger' => false,
        ]);
        $service->log($blocked, 'submitted', null, 'Report submitted.');
        $service->recordLegalDutyShown($blocked);

        // 2. A case where an external report has been made and recorded.
        $reported = $this->makeReport($school, [
            'category' => 'physical_abuse',
            'description' => 'A student was reportedly struck by a member of staff during class.',
            'immediate_danger' => false,
        ]);
        $service->log($reported, 'submitted', null, 'Report submitted.');
        $service->recordLegalDutyShown($reported);
        $service->acknowledge($officer, $reported);
        $service->recordExternalReport($officer, $reported, 'police', 'FIR/2026/00412');

        // 3. A non-POCSO concern, still restricted and still off every rating.
        $other = $this->makeReport($school, [
            'category' => 'serious_harassment',
            'description' => 'Repeated intimidation of a student by an older group, unresolved after '
                .'being raised with class teachers.',
            'immediate_danger' => false,
            'reporter_role' => 'teacher',
        ]);
        $service->log($other, 'submitted', null, 'Report submitted.');
        $service->recordLegalDutyShown($other);
        $service->acknowledge($officer, $other);
    }

    private function makeReport(School $school, array $attributes): SafeguardingReport
    {
        return SafeguardingReport::create(array_merge([
            'reference' => SafeguardingReport::generateReference(),
            'school_id' => $school->id,
            'district_id' => $school->district_id,
            'state_id' => $school->state_id,
            // Synthetic pseudonyms: the table only ever holds an anonymous ref,
            // and seeding real accounts here would imply named families made
            // these reports.
            'anonymous_ref' => AnonymousIdentity::generateRef(),
            'reporter_role' => 'parent',
        ], $attributes));
    }
}
