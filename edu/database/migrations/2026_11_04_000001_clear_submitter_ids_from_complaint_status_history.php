<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Spec section I and the identity separation of SECURITY_PRIVACY.md.
 *
 * `complaints` deliberately has no `user_id` column, so that nothing links a
 * complaint to the person who filed it outside
 * `IdentityResolutionService::resolve()` — which demands the
 * access-protected-identity permission, a reason, and writes an
 * `identity_access_logs` row.
 *
 * `complaint_status_history.changed_by_user_id` was being written with
 * `Auth::id()` for *every* transition, including the submitter's own
 * "was this actually resolved?" confirmation. That put the submitter's id
 * beside `complaint_id` in a table the school and every officer in the
 * jurisdiction can read, rebuilding the link with none of those three
 * controls. It never surfaced in the UI — the timeline renders the note and
 * the timestamp, never `changedBy` — so this closes a data-layer exposure,
 * not a visible leak.
 *
 * `Complaint::recordStatusChange()` now drops a submitter's id at the
 * chokepoint. This clears the rows already written, matched by resolving
 * each row's user against its own complaint's `anonymous_ref` rather than by
 * reading the note text, so a row counts as the submitter's because the
 * identity says so and not because of how it happened to be worded.
 *
 * Staff and officer rows are untouched: they are the point of the trail.
 *
 * Irreversible by design — `down()` cannot put identities back, and should
 * not want to.
 */
return new class extends Migration
{
    public function up(): void
    {
        $ids = DB::table('complaint_status_history as h')
            ->join('complaints as c', 'c.id', '=', 'h.complaint_id')
            ->join('anonymous_identities as a', function ($join) {
                $join->on('a.anonymous_ref', '=', 'c.anonymous_ref')
                    ->on('a.user_id', '=', 'h.changed_by_user_id');
            })
            ->whereNotNull('h.changed_by_user_id')
            ->pluck('h.id');

        foreach ($ids->chunk(500) as $chunk) {
            DB::table('complaint_status_history')
                ->whereIn('id', $chunk->all())
                ->update(['changed_by_user_id' => null]);
        }
    }

    public function down(): void
    {
        // Deliberately empty: the whole point was to forget these ids.
    }
};
