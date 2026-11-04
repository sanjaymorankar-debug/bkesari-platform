<?php

namespace Tests\Feature\Platform\Concerns;

use App\Models\Appeal;
use App\Models\Complaint;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * CR-04, stated once as a set of queries rather than per action.
 *
 * The rule: **no row may name a user beside an anonymous record that same
 * user submitted.** `complaints`, `appeals`, `school_feedback`,
 * `retaliation_reports` and `safeguarding_reports` carry an `anonymous_ref`
 * and no `user_id` precisely so that nothing links a submitter to what they
 * filed; a row that names them next to it rebuilds that link in a table the
 * school, or every officer, can read — with none of the controls
 * `IdentityResolutionService` imposes on reversing a ref.
 *
 * Why as a query and not as an assertion per action: the per-action tests
 * (which assert 403 on each conflicted route) only cover the writers that
 * existed when they were written. A new page that responds to a complaint, or
 * a new officer action on a case, would pass all of them. These joins hold
 * however the row was written, so they fail for a writer nobody thought of.
 *
 * Every relation that pairs an actor column with a submitter's `anonymous_ref`
 * is listed here. The ones deliberately absent, and why:
 * `complaint_evidence.uploaded_by` and `complaint_responses.responder_type`
 * are enums, not ids; `complaint_resolutions.confirmed_by_submitter` is a
 * choice string; `teacher_feedback.teacher_user_id` is the teacher being
 * rated, not an actor; `school_feedback`, `facility_ratings`,
 * `course_ratings` and `retaliation_reports` carry an `anonymous_ref` and no
 * actor column at all; `fraud_flags.reviewed_by_user_id` sits beside a school
 * or a teacher, never beside a submission.
 */
trait AssertsAnonymityInvariants
{
    protected function assertNoRowNamesASubmitterBesideTheirOwnAnonymousRecord(): void
    {
        $leaks = [];

        foreach ($this->submitterLinkQueries() as $label => $rows) {
            foreach ($rows as $row) {
                $leaks[] = $label.' (user '.$row->user_id.' -> record '.$row->record_id.')';
            }
        }

        $this->assertSame([], $leaks, 'a row names a submitter beside their own anonymous record (CR-04): '
            .implode('; ', $leaks));
    }

    /** @return array<string, Collection> */
    private function submitterLinkQueries(): array
    {
        $viaComplaint = fn (string $table, string $alias, string $actorColumn, string $complaintKey = 'complaint_id') => DB::table($table.' as '.$alias)
            ->join('complaints as c', 'c.id', '=', $alias.'.'.$complaintKey)
            ->join('anonymous_identities as a', function ($join) use ($alias, $actorColumn): void {
                $join->on('a.anonymous_ref', '=', 'c.anonymous_ref')
                    ->on('a.user_id', '=', $alias.'.'.$actorColumn);
            })
            ->select('a.user_id', 'c.id as record_id')
            ->get();

        // An `anonymous_ref` carried on the row itself, next to an actor column.
        $viaOwnRef = fn (string $table, string $alias, string $actorColumn) => DB::table($table.' as '.$alias)
            ->join('anonymous_identities as a', function ($join) use ($alias, $actorColumn): void {
                $join->on('a.anonymous_ref', '=', $alias.'.anonymous_ref')
                    ->on('a.user_id', '=', $alias.'.'.$actorColumn);
            })
            ->select('a.user_id', $alias.'.id as record_id')
            ->get();

        $auditVia = fn (string $table, string $type) => DB::table('audit_logs as l')
            ->join($table.' as r', function ($join) use ($type): void {
                $join->on('r.id', '=', 'l.auditable_id')
                    ->where('l.auditable_type', '=', $type);
            })
            ->join('anonymous_identities as a', function ($join): void {
                $join->on('a.anonymous_ref', '=', 'r.anonymous_ref')
                    ->on('a.user_id', '=', 'l.user_id');
            })
            ->select('a.user_id', 'r.id as record_id')
            ->get();

        return [
            // The complaint's own writers.
            'complaint_responses.responder_user_id' => $viaComplaint('complaint_responses', 'r', 'responder_user_id'),
            'complaint_status_history.changed_by_user_id' => $viaComplaint('complaint_status_history', 'h', 'changed_by_user_id'),

            // Reversing a ref, and deciding an escalation.
            'identity_access_logs.officer_user_id' => $viaOwnRef('identity_access_logs', 'il', 'officer_user_id'),
            'appeals.reviewed_by_user_id' => $viaOwnRef('appeals', 'ap', 'reviewed_by_user_id'),

            // The trail itself, for both auditable types that carry a ref.
            'audit_logs -> complaints' => $auditVia('complaints', Complaint::class),
            'audit_logs -> appeals' => $auditVia('appeals', Appeal::class),

            // Safeguarding: three actor columns in the report's own row, and
            // the case trail, which records even an open.
            'safeguarding_reports.assigned_officer_user_id' => $viaOwnRef('safeguarding_reports', 's', 'assigned_officer_user_id'),
            'safeguarding_reports.external_report_acknowledged_by' => $viaOwnRef('safeguarding_reports', 's', 'external_report_acknowledged_by'),
            'safeguarding_reports.closed_by_user_id' => $viaOwnRef('safeguarding_reports', 's', 'closed_by_user_id'),
            'safeguarding_events.actor_user_id' => DB::table('safeguarding_events as e')
                ->join('safeguarding_reports as s', 's.id', '=', 'e.safeguarding_report_id')
                ->join('anonymous_identities as a', function ($join): void {
                    $join->on('a.anonymous_ref', '=', 's.anonymous_ref')
                        ->on('a.user_id', '=', 'e.actor_user_id');
                })
                ->select('a.user_id', 's.id as record_id')
                ->get(),
        ];
    }
}
