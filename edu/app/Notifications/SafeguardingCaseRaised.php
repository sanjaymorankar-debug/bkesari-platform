<?php

namespace App\Notifications;

use App\Models\SafeguardingReport;
use Illuminate\Notifications\Notification;

/**
 * Spec section 25 — a safeguarding case must reach a person, not just a queue.
 *
 * Deliberately carries **no detail of the concern**. The notification says a
 * case exists, its reference, and whether immediate danger was reported;
 * everything else is behind the case page, where opening it is audited. A
 * notification row is readable from a list view and is the wrong place for the
 * substance of an allegation about a child.
 *
 * It also names no school in the immediate-danger case beyond what the officer
 * already has access to, because the recipients are scoped to that school or
 * district before this is ever sent.
 */
class SafeguardingCaseRaised extends Notification
{
    public function __construct(public SafeguardingReport $report) {}

    public function via(object $notifiable): array
    {
        return ['database'];
    }

    public function toArray(object $notifiable): array
    {
        return [
            'type' => 'safeguarding_case_raised',
            'safeguarding_report_id' => $this->report->id,
            'reference' => $this->report->reference,
            'immediate_danger' => (bool) $this->report->immediate_danger,
            // The category is included because it determines urgency and
            // whether the POCSO duty is engaged — but nothing about what
            // happened, to whom, or who reported it.
            'category' => $this->report->categoryLabel(),
            'message' => $this->report->immediate_danger
                ? 'Urgent: a safeguarding concern reporting immediate danger has been raised ('
                    .$this->report->reference.'). Open it now.'
                : 'A safeguarding concern has been raised ('.$this->report->reference.').',
        ];
    }
}
