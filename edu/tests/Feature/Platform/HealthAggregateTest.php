<?php

namespace Tests\Feature\Platform;

use App\Models\CounsellingSession;
use App\Models\HealthFollowup;
use App\Models\PhysicalHealthRecord;
use App\Models\School;
use App\Models\SchoolStaff;
use App\Models\User;
use App\Services\HealthAggregateService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Livewire\Volt\Volt;
use Tests\Feature\Platform\Concerns\SetsUpPlatformData;
use Tests\TestCase;

/**
 * Spec sections 20 and 32 — government sees aggregated, anonymised health
 * statistics and nothing else.
 */
class HealthAggregateTest extends TestCase
{
    use RefreshDatabase, SetsUpPlatformData;

    private School $school;

    private User $nurse;

    protected function setUp(): void
    {
        parent::setUp();

        $this->school = $this->makeSchool();

        $this->nurse = User::factory()->create();
        $this->nurse->assignRole('school_nurse');
        SchoolStaff::create([
            'user_id' => $this->nurse->id,
            'school_id' => $this->school->id,
            'designation' => 'Nurse',
        ]);
    }

    /** @return list<User> */
    private function enrolStudents(int $count): array
    {
        $students = [];

        for ($i = 0; $i < $count; $i++) {
            $students[] = $this->makeVerifiedStudent($this->school);
        }

        return $students;
    }

    private function screen(User $student): PhysicalHealthRecord
    {
        return PhysicalHealthRecord::create([
            'student_user_id' => $student->id,
            'school_id' => $this->school->id,
            'academic_year' => now()->month >= 4
                ? now()->year.'-'.substr((string) (now()->year + 1), 2)
                : (now()->year - 1).'-'.substr((string) now()->year, 2),
            'examination_date' => now()->toDateString(),
            'recorded_by_user_id' => $this->nurse->id,
        ]);
    }

    private function service(): HealthAggregateService
    {
        return app(HealthAggregateService::class);
    }

    // ---------------------------------------------------------------
    //  Small-cell suppression
    // ---------------------------------------------------------------

    /**
     * The safeguard that makes "anonymised" mean something: a district where
     * three children saw a counsellor is not anonymous to anyone local.
     */
    public function test_statistics_from_a_tiny_population_are_withheld(): void
    {
        $students = $this->enrolStudents(4);
        $this->screen($students[0]);

        $summary = $this->service()->summary();

        $this->assertTrue($summary['screening_coverage']['suppressed']);
        $this->assertNull($summary['screening_coverage']['value']);
        $this->assertStringContainsString('too few to report', $summary['screening_coverage']['note']);
    }

    public function test_a_suppressed_figure_says_why_rather_than_showing_zero(): void
    {
        $this->enrolStudents(3);

        $summary = $this->service()->summary();

        // Zero would read as "nobody was screened", which is a different and
        // false claim from "we are not reporting this".
        $this->assertNotSame(0, $summary['screening_coverage']['value']);
        $this->assertNull($summary['screening_coverage']['value']);
    }

    public function test_statistics_are_published_once_the_population_is_large_enough(): void
    {
        $students = $this->enrolStudents(20);

        foreach (array_slice($students, 0, 15) as $student) {
            $this->screen($student);
        }

        $summary = $this->service()->summary();

        $this->assertFalse($summary['screening_coverage']['suppressed']);
        $this->assertSame(75.0, $summary['screening_coverage']['value']);
    }

    public function test_the_suppression_floor_applies_to_the_denominator(): void
    {
        // 9 students, all screened. 100% from 9 children is as identifying as
        // a raw count, so it must still be withheld.
        $students = $this->enrolStudents(9);

        foreach ($students as $student) {
            $this->screen($student);
        }

        $summary = $this->service()->summary();

        $this->assertTrue($summary['screening_coverage']['suppressed']);
        $this->assertLessThan(HealthAggregateService::MIN_CELL_SIZE, $summary['screening_coverage']['population']);
    }

    public function test_wellbeing_support_is_suppressed_for_a_small_population(): void
    {
        $students = $this->enrolStudents(5);

        $counsellor = User::factory()->create();
        $counsellor->assignRole('counsellor');
        SchoolStaff::create(['user_id' => $counsellor->id, 'school_id' => $this->school->id, 'designation' => 'Counsellor']);

        CounsellingSession::create([
            'student_user_id' => $students[0]->id,
            'school_id' => $this->school->id,
            'session_date' => now()->toDateString(),
            'session_notes' => 'Notes.',
            'counsellor_user_id' => $counsellor->id,
        ]);

        $this->assertTrue($this->service()->summary()['wellbeing_support']['suppressed']);
    }

    // ---------------------------------------------------------------
    //  Counts of work to be done are not suppressed
    // ---------------------------------------------------------------

    /**
     * An overdue follow-up is a case needing action, not a statistic about a
     * population. Hiding it would defeat the point of recording it, and it
     * names no child.
     */
    public function test_overdue_followups_are_reported_even_in_a_small_population(): void
    {
        $students = $this->enrolStudents(3);

        HealthFollowup::create([
            'student_user_id' => $students[0]->id,
            'school_id' => $this->school->id,
            'area' => 'vision',
            'finding' => 'Needs an eye test.',
            'status' => 'referred',
            'identified_on' => now()->subMonths(2)->toDateString(),
            'due_on' => now()->subMonth()->toDateString(),
            'opened_by_user_id' => $this->nurse->id,
        ]);

        $summary = $this->service()->summary();

        $this->assertFalse($summary['overdue_followups']['suppressed']);
        $this->assertSame(1, $summary['overdue_followups']['value']);
    }

    public function test_a_followup_not_yet_due_is_not_counted_as_overdue(): void
    {
        $students = $this->enrolStudents(3);

        HealthFollowup::create([
            'student_user_id' => $students[0]->id,
            'school_id' => $this->school->id,
            'area' => 'dental',
            'finding' => 'Routine check.',
            'status' => 'referred',
            'identified_on' => now()->toDateString(),
            'due_on' => now()->addMonth()->toDateString(),
            'opened_by_user_id' => $this->nurse->id,
        ]);

        $this->assertSame(0, $this->service()->summary()['overdue_followups']['value']);
    }

    public function test_a_completed_followup_is_not_counted_as_overdue(): void
    {
        $students = $this->enrolStudents(3);

        HealthFollowup::create([
            'student_user_id' => $students[0]->id,
            'school_id' => $this->school->id,
            'area' => 'vision',
            'finding' => 'Dealt with.',
            'status' => 'completed',
            'identified_on' => now()->subMonths(2)->toDateString(),
            'due_on' => now()->subMonth()->toDateString(),
            'opened_by_user_id' => $this->nurse->id,
        ]);

        $this->assertSame(0, $this->service()->summary()['overdue_followups']['value']);
    }

    // ---------------------------------------------------------------
    //  Nothing individual ever comes back
    // ---------------------------------------------------------------

    public function test_the_summary_contains_no_student_identifiers(): void
    {
        $students = $this->enrolStudents(20);

        foreach ($students as $student) {
            $this->screen($student);
        }

        $encoded = json_encode($this->service()->summary());

        foreach ($students as $student) {
            $this->assertStringNotContainsString($student->email, $encoded);
            $this->assertStringNotContainsString($student->name, $encoded);
        }

        foreach (['student_user_id', 'session_notes', 'observation', 'health_concerns'] as $forbidden) {
            $this->assertStringNotContainsString($forbidden, $encoded);
        }
    }

    public function test_the_service_exposes_no_method_returning_records(): void
    {
        $publicMethods = get_class_methods(HealthAggregateService::class);

        // `summary` is the whole public surface. Anything else would be a way
        // to reach rows rather than counts.
        $this->assertSame(['summary'], $publicMethods);
    }

    // ---------------------------------------------------------------
    //  Scoping
    // ---------------------------------------------------------------

    public function test_a_district_scope_excludes_other_districts(): void
    {
        $students = $this->enrolStudents(20);

        foreach ($students as $student) {
            $this->screen($student);
        }

        $otherSchool = $this->makeSchool();

        $inDistrict = $this->service()->summary('district', $this->school->district_id);
        $elsewhere = $this->service()->summary('district', $otherSchool->district_id);

        $this->assertFalse($inDistrict['screening_coverage']['suppressed']);
        // The other district has no students, so its figure is suppressed
        // rather than reported as 0%.
        $this->assertTrue($elsewhere['screening_coverage']['suppressed']);
    }

    /**
     * The officer-facing surface: aggregates appear, and the page says
     * plainly that no individual record is reachable from it.
     */
    public function test_the_district_dashboard_shows_aggregates_and_says_they_are_aggregates(): void
    {
        $students = $this->enrolStudents(20);

        foreach ($students as $student) {
            $this->screen($student);
        }

        $officer = $this->makeDistrictOfficer($this->school);

        Volt::actingAs($officer)->test('dashboards.district')
            ->assertOk()
            ->assertSee('Health &amp; wellbeing in your district', false)
            ->assertSee('No individual child')
            ->assertSee('Students screened this year');
    }

    public function test_the_district_dashboard_never_names_a_child(): void
    {
        $students = $this->enrolStudents(20);

        foreach ($students as $student) {
            $this->screen($student);
        }

        $officer = $this->makeDistrictOfficer($this->school);

        $component = Volt::actingAs($officer)->test('dashboards.district')->assertOk();

        foreach ($students as $student) {
            $component->assertDontSee($student->name);
        }
    }

    public function test_the_state_and_national_dashboards_show_the_same_aggregates(): void
    {
        $students = $this->enrolStudents(20);

        foreach ($students as $student) {
            $this->screen($student);
        }

        $stateOfficer = $this->makeStateOfficer($this->school);

        Volt::actingAs($stateOfficer)->test('dashboards.state')
            ->assertOk()
            ->assertSee('Students screened this year')
            ->assertSee('No individual child');

        $nationalAdmin = User::factory()->create();
        $nationalAdmin->assignRole('national_admin');

        Volt::actingAs($nationalAdmin)->test('dashboards.national')
            ->assertOk()
            ->assertSee('Students screened this year')
            ->assertSee('No individual child');
    }

    public function test_a_higher_counselling_rate_is_not_framed_as_a_bad_outcome(): void
    {
        $this->enrolStudents(20);

        $note = $this->service()->summary()['wellbeing_support']['note'];

        $this->assertStringContainsString('not a worse outcome', $note);
    }
}
