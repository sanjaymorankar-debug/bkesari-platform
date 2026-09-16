<?php

namespace Tests\Feature\Platform;

use App\Models\StudentAcademicRecord;
use Livewire\Volt\Volt;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Feature\Platform\Concerns\SetsUpPlatformData;
use Tests\TestCase;

class AcademicRecordsTest extends TestCase
{
    use RefreshDatabase, SetsUpPlatformData;

    public function test_school_admin_can_add_an_academic_record_for_a_verified_student(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);
        $student = $this->makeVerifiedStudent($school);

        Volt::actingAs($admin)->test('academic-records.index', ['school' => $school])
            ->assertOk()
            ->set('studentUserId', (string) $student->id)
            ->set('subject', 'Mathematics')
            ->set('term', '2026-T1')
            ->set('score', '78')
            ->set('maxScore', '100')
            ->call('addRecord');

        $record = StudentAcademicRecord::first();
        $this->assertNotNull($record);
        $this->assertSame($student->id, $record->student_user_id);
        $this->assertSame($school->id, $record->school_id);
        $this->assertSame('Mathematics', $record->subject);
    }

    public function test_school_admin_cannot_add_record_for_student_not_verified_at_their_school(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);
        $otherSchool = $this->makeSchool();
        $unrelatedStudent = $this->makeVerifiedStudent($otherSchool);

        Volt::actingAs($admin)->test('academic-records.index', ['school' => $school])
            ->set('studentUserId', (string) $unrelatedStudent->id)
            ->set('subject', 'Mathematics')
            ->set('term', '2026-T1')
            ->set('score', '78')
            ->set('maxScore', '100')
            ->call('addRecord')
            ->assertStatus(422);

        $this->assertSame(0, StudentAcademicRecord::count());
    }

    public function test_admin_of_a_different_school_cannot_access_this_schools_academic_records(): void
    {
        $school = $this->makeSchool();
        $otherSchool = $this->makeSchool();
        $outsideAdmin = $this->makeSchoolAdmin($otherSchool);

        Volt::actingAs($outsideAdmin)->test('academic-records.index', ['school' => $school])
            ->assertForbidden();
    }
}
