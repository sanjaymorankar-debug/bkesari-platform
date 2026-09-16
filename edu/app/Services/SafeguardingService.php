<?php

namespace App\Services;

use App\Models\SafeguardingEvent;
use App\Models\SafeguardingReport;
use App\Models\SchoolStaff;
use App\Models\User;
use App\Notifications\SafeguardingCaseRaised;
use Illuminate\Validation\ValidationException;

/**
 * Spec section 25 — the rules that make the safeguarding workflow different
 * from an ordinary complaint, enforced here rather than left to the UI.
 *
 * Three structural guarantees:
 *
 * 1. **School administrators cannot see these cases at all.** Under POCSO Act
 *    2012 section 19 the duty runs to the police or the Special Juvenile
 *    Police Unit, and courts have held a school may not conduct an internal
 *    inquiry first. A school-side Child Safety Officer receives the case; the
 *    school's ordinary administration does not. This is the platform
 *    structurally refusing to be the venue for an internal inquiry.
 *
 * 2. **A POCSO case cannot be closed until an external report is recorded.**
 *    Rule 44 forbids letting a school close a safeguarding case internally in
 *    place of legal reporting, so closure is blocked outright rather than
 *    discouraged.
 *
 * 3. **Filing here never discharges the legal duty**, and nothing in this
 *    service should be read as evidence that it did.
 *    `external_report_acknowledged_at` records that somebody said a report was
 *    made — an acknowledgement, not a verified police record. The wording
 *    everywhere reflects that difference.
 */
class SafeguardingService
{
    /**
     * Who may see an individual safeguarding case.
     *
     * Note the absence of a `school_admin` branch — that is the point, not an
     * oversight, and there is a test asserting it stays absent.
     */
    public function canView(User $user, SafeguardingReport $report): bool
    {
        if ($user->hasRole('system_admin')) {
            return true;
        }

        // The school-side Child Safety Officer, but only for their own school.
        if ($user->hasRole('child_safety_officer')
            && SchoolStaff::where('user_id', $user->id)->where('school_id', $report->school_id)->exists()) {
            return true;
        }

        if ($user->hasRole('district_officer')) {
            return $user->officerJurisdictions()
                ->where('district_id', $report->district_id)->exists();
        }

        if ($user->hasAnyRole(['state_officer', 'national_admin'])) {
            return $user->hasRole('national_admin')
                || $user->officerJurisdictions()->where('state_id', $report->state_id)->exists();
        }

        return false;
    }

    /**
     * Whether this user may act on the case (acknowledge, record an external
     * report, close). Same audience as viewing — there is no read-only tier
     * here, because everyone who can see a case is someone with a role in
     * handling it.
     */
    public function canManage(User $user, SafeguardingReport $report): bool
    {
        return $this->canView($user, $report);
    }

    /**
     * Tell the people who can act that a case exists.
     *
     * Recipients are exactly the audience `canView()` allows for this case —
     * the school's Child Safety Officers and the officers whose jurisdiction
     * covers it — never the school's ordinary administration. The notification
     * itself carries no detail of the concern; see SafeguardingCaseRaised.
     *
     * Without this the queue is a page somebody has to remember to open, which
     * for an immediate-danger case is not good enough.
     *
     * @return int how many people were notified
     */
    public function notifyResponsibleOfficers(SafeguardingReport $report): int
    {
        $schoolOfficerIds = SchoolStaff::where('school_id', $report->school_id)->pluck('user_id');

        $recipients = User::query()
            ->where(function ($query) use ($schoolOfficerIds, $report): void {
                $query->where(function ($q) use ($schoolOfficerIds): void {
                    $q->whereIn('id', $schoolOfficerIds)
                        ->whereHas('roles', fn ($r) => $r->where('name', 'child_safety_officer'));
                })->orWhereHas('officerJurisdictions', function ($j) use ($report): void {
                    $j->where('district_id', $report->district_id)
                        ->orWhere('state_id', $report->state_id);
                });
            })
            ->get()
            // Belt and braces: re-check each recipient against the same access
            // rule that governs the case page, so a jurisdiction row alone
            // cannot leak a notification to someone who could not open it.
            ->filter(fn (User $user): bool => $this->canView($user, $report));

        foreach ($recipients as $recipient) {
            $recipient->notify(new SafeguardingCaseRaised($report));
        }

        if ($recipients->isNotEmpty()) {
            $this->log($report, 'assigned', null,
                'Notified '.$recipients->count().' responsible '
                    .($recipients->count() === 1 ? 'officer' : 'officers').'.');
        }

        return $recipients->count();
    }

    /**
     * Record that the POCSO section 19 obligation was actually put in front of
     * the reporter. This documents the platform's conduct, not the reporter's:
     * it says the duty was surfaced, never that it was discharged.
     */
    public function recordLegalDutyShown(SafeguardingReport $report): void
    {
        if ($report->legal_duty_shown_at !== null) {
            return;
        }

        $report->forceFill(['legal_duty_shown_at' => now()])->save();

        $this->log($report, 'legal_duty_shown', null,
            'The reporter was shown the independent legal duty to report to the police or SJPU.');
    }

    public function acknowledge(User $officer, SafeguardingReport $report): void
    {
        $this->assertCanManage($officer, $report);

        if ($report->acknowledged_at !== null) {
            return;
        }

        $report->forceFill([
            'acknowledged_at' => now(),
            'assigned_officer_user_id' => $officer->id,
            'status' => $report->status === 'submitted' ? 'acknowledged' : $report->status,
        ])->save();

        $this->log($report, 'acknowledged', $officer, 'Case received by the Child Safety Officer.');
    }

    /**
     * Record that a report was made to an external authority.
     *
     * This is an acknowledgement by a named officer, not verification — the
     * platform has no way to confirm a police record exists, and must not
     * imply otherwise anywhere it displays this.
     */
    public function recordExternalReport(
        User $officer,
        SafeguardingReport $report,
        string $channel,
        ?string $externalReference,
    ): void {
        $this->assertCanManage($officer, $report);

        if (! array_key_exists($channel, SafeguardingReport::EXTERNAL_CHANNELS)) {
            throw ValidationException::withMessages([
                'channel' => 'Choose which authority the report was made to.',
            ]);
        }

        $report->forceFill([
            'external_report_acknowledged_at' => now(),
            'external_report_acknowledged_by' => $officer->id,
            'external_report_channel' => $channel,
            'external_report_reference' => $externalReference,
            'status' => $report->status === 'closed' ? 'closed' : 'external_report_confirmed',
        ])->save();

        $this->log($report, 'external_report_recorded', $officer, sprintf(
            'Reported to %s%s.',
            SafeguardingReport::EXTERNAL_CHANNELS[$channel],
            $externalReference ? ' (reference '.$externalReference.')' : ''
        ));
    }

    /**
     * Close a case.
     *
     * A case engaging the POCSO duty cannot be closed until an external report
     * has been recorded — spec rule 44. This is a hard block, not a warning,
     * because the failure it prevents is a school quietly resolving a child
     * sexual abuse allegation in-house.
     *
     * @throws ValidationException
     */
    public function close(User $officer, SafeguardingReport $report, string $reason): void
    {
        $this->assertCanManage($officer, $report);

        if (trim($reason) === '') {
            throw ValidationException::withMessages([
                'reason' => 'A closure reason is required.',
            ]);
        }

        if ($report->engagesPocsoDuty() && ! $report->hasExternalReport()) {
            throw ValidationException::withMessages([
                'reason' => 'This case cannot be closed here until a report to the police or the Special '
                    .'Juvenile Police Unit has been recorded. Under POCSO Act section 19 that duty is '
                    .'independent of this platform, and closing the case here would not discharge it.',
            ]);
        }

        $report->forceFill([
            'status' => 'closed',
            'closed_at' => now(),
            'closed_by_user_id' => $officer->id,
            'closure_reason' => $reason,
        ])->save();

        $this->log($report, 'closed', $officer, $reason);
    }

    public function startInvestigation(User $officer, SafeguardingReport $report, string $note): void
    {
        $this->assertCanManage($officer, $report);

        $report->forceFill(['status' => 'under_investigation'])->save();

        $this->log($report, 'investigation_started', $officer, $note ?: null);
    }

    public function addNote(User $officer, SafeguardingReport $report, string $note): void
    {
        $this->assertCanManage($officer, $report);

        $this->log($report, 'note_added', $officer, $note);
    }

    /** Every open of a case is recorded — these are the most sensitive records the platform holds. */
    public function recordView(User $user, SafeguardingReport $report): void
    {
        $this->log($report, 'viewed', $user, null);
    }

    public function log(SafeguardingReport $report, string $eventType, ?User $actor, ?string $detail): SafeguardingEvent
    {
        return SafeguardingEvent::create([
            'safeguarding_report_id' => $report->id,
            'event_type' => $eventType,
            'actor_user_id' => $actor?->id,
            'actor_role' => $actor?->getRoleNames()->first(),
            'detail' => $detail,
            'occurred_at' => now(),
        ]);
    }

    private function assertCanManage(User $user, SafeguardingReport $report): void
    {
        abort_unless($this->canManage($user, $report), 403, 'You are not authorised to act on this case.');
    }
}
