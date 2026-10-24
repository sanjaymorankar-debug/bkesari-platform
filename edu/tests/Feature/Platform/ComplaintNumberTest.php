<?php

namespace Tests\Feature\Platform;

use App\Models\Complaint;
use App\Models\School;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Livewire\Volt\Volt;
use Tests\Feature\Platform\Concerns\SetsUpPlatformData;
use Tests\TestCase;

/**
 * Complaint numbers (EDU-{STATE}-{DISTRICT}-{YEAR}-{sequence}, spec section S)
 * are what a parent quotes back to an officer, and complaint_number is unique.
 * Two ways the old count-plus-one numbering broke, on every database: a gap
 * left by any earlier complaint, and two submissions at the same moment. Real
 * contention between processes is TEST_SPEC.md's S7.8
 * (tests/smoke/concurrent_numbers.sh); one process cannot produce it.
 */
class ComplaintNumberTest extends TestCase
{
    use RefreshDatabase, SetsUpPlatformData;

    public function test_numbers_run_in_sequence_per_district_and_year(): void
    {
        $school = $this->makeSchool();

        $first = $this->fileComplaint($school);
        $second = $this->fileComplaint($school);

        $prefix = sprintf('EDU-%s-%s-%d-', $school->state->code, $school->district->code, now()->year);
        $this->assertSame($prefix.'000001', $first->complaint_number);
        $this->assertSame($prefix.'000002', $second->complaint_number);
    }

    public function test_a_gap_in_the_sequence_does_not_hand_out_a_number_already_taken(): void
    {
        $school = $this->makeSchool();

        $this->fileComplaint($school);
        $removed = $this->fileComplaint($school);
        $third = $this->fileComplaint($school);
        $removed->delete();

        // Counting would give 000003 again, which $third already holds, and
        // every later complaint in this district would fail on the index.
        $next = $this->fileComplaint($school);

        $this->assertStringEndsWith('-000004', $next->complaint_number);
        $this->assertNotSame($third->complaint_number, $next->complaint_number);
    }

    public function test_a_clash_on_the_unique_index_is_retried_with_the_next_number(): void
    {
        $school = $this->makeSchool();
        $first = $this->fileComplaint($school);

        // A number written some other way gets there first: during the first
        // attempt a real INSERT of an already-taken number fails on the unique
        // index, as a clashing insert from elsewhere would.
        $clashed = false;
        Complaint::creating(function () use (&$clashed, $first, $school) {
            if ($clashed) {
                return;
            }
            $clashed = true;

            DB::table('complaints')->insert($this->attributesFor($school) + [
                'complaint_number' => $first->complaint_number,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        });

        $mine = $this->fileComplaint($school);

        $this->assertTrue($clashed);
        $this->assertStringEndsWith('-000002', $mine->complaint_number);

        // The clash happened inside this test's own transaction. On PostgreSQL
        // a failed INSERT aborts the whole transaction unless it ran in a
        // savepoint, and then neither the retry nor this query would work.
        $this->assertSame(2, Complaint::where('school_id', $school->id)->count());
    }

    public function test_numbering_queues_on_a_transaction_scoped_lock_on_postgresql(): void
    {
        $locks = [];
        DB::listen(function (QueryExecuted $query) use (&$locks) {
            if (str_contains($query->sql, 'advisory')) {
                $locks[] = $query->sql;
            }
        });

        $this->fileComplaint($this->makeSchool());

        // pg_advisory_xact_lock ends with the transaction. A session lock
        // (pg_advisory_lock) would outlive it on a pooled server connection.
        $this->assertSame(
            DB::getDriverName() === 'pgsql' ? ['select pg_advisory_xact_lock(hashtext(?))'] : [],
            $locks
        );
    }

    public function test_submitting_through_the_form_gets_the_next_free_number(): void
    {
        $school = $this->makeSchool();
        $parent = $this->makeVerifiedParent($school);
        $category = $this->makeCategory();

        $this->fileComplaint($school);
        $gap = $this->fileComplaint($school);
        $this->fileComplaint($school);
        $gap->delete();

        Volt::actingAs($parent)->test('complaints.create')
            ->set('schoolId', $school->id)
            ->set('complaintCategoryId', $category->id)
            ->set('subject', 'Broken drinking water tap')
            ->set('description', 'The tap near the primary block has been broken for three weeks.')
            ->set('severity', 'medium')
            ->call('submit')
            ->assertHasNoErrors();

        $this->assertTrue(Complaint::where('subject', 'Broken drinking water tap')
            ->where('complaint_number', 'like', '%-000004')->exists());
    }

    private function fileComplaint(School $school): Complaint
    {
        return Complaint::createNumbered($school->state, $school->district, $this->attributesFor($school));
    }

    private function attributesFor(School $school): array
    {
        return [
            'school_id' => $school->id,
            'complaint_category_id' => $this->category ??= $this->makeCategory()->id,
            'district_id' => $school->district_id,
            'state_id' => $school->state_id,
            'anonymous_ref' => 'ANON-NUMBERTEST',
            'submitted_role' => 'parent',
            'subject' => 'Numbering check',
            'description' => 'A complaint used to check how numbers are issued.',
            'severity' => 'low',
            'status' => 'submitted',
        ];
    }

    private ?int $category = null;
}
