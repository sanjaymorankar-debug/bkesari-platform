<?php

namespace App\Policies;

use App\Models\AnonymousIdentity;
use App\Models\Complaint;
use App\Models\OfficerJurisdiction;
use App\Models\User;

class ComplaintPolicy
{
    /**
     * A submitter may view their own complaint — this checks whether the
     * viewer owns the anonymous_ref, it never reverses someone else's.
     */
    public function view(User $user, Complaint $complaint): bool
    {
        if ($this->ownsComplaint($user, $complaint)) {
            return true;
        }

        if ($user->hasRole('school_admin')) {
            return $user->schoolStaffAssignments()->where('school_id', $complaint->school_id)->exists();
        }

        if ($user->hasRole('district_officer')) {
            return OfficerJurisdiction::where('user_id', $user->id)
                ->where('level', 'district')->where('district_id', $complaint->district_id)->exists();
        }

        if ($user->hasRole('state_officer')) {
            return OfficerJurisdiction::where('user_id', $user->id)
                ->where('level', 'state')->where('state_id', $complaint->state_id)->exists();
        }

        return $user->hasAnyRole(['national_admin', 'system_admin']);
    }

    /**
     * One person can hold two hats — a teacher or clerk whose own child
     * attends the school they work at is both staff and a verified parent.
     * They may still file a complaint, but they may not then answer it
     * officially: `complaint_responses.responder_user_id` and the
     * `audit_logs` row (with the actor's IP) both name the actor beside the
     * complaint, which would rebuild the submitter→complaint link that
     * `complaints` carries no `user_id` column precisely to prevent — with
     * none of the controls `IdentityResolutionService` imposes. Nobody
     * should answer their own complaint in any case; another member of the
     * school's staff can.
     */
    public function respond(User $user, Complaint $complaint): bool
    {
        if (! $user->can('respond-to-complaint')) {
            return false;
        }

        if ($this->ownsComplaint($user, $complaint)) {
            return false;
        }

        return $user->schoolStaffAssignments()->where('school_id', $complaint->school_id)->exists();
    }

    /**
     * The same rule, one level up: an officer who filed this complaint
     * themselves does not review it. Beyond the conflict of interest, the
     * officer routes this gate opens write the actor's id beside the
     * complaint — `revealIdentity` would put their own id and the
     * complaint's `anonymous_ref` in the same `identity_access_logs` row.
     */
    public function review(User $user, Complaint $complaint): bool
    {
        if ($this->ownsComplaint($user, $complaint)) {
            return false;
        }

        if ($user->hasRole('district_officer') && $user->can('review-district-complaints')) {
            return OfficerJurisdiction::where('user_id', $user->id)
                ->where('level', 'district')->where('district_id', $complaint->district_id)->exists();
        }

        if ($user->hasRole('state_officer') && $user->can('review-state-complaints')) {
            return OfficerJurisdiction::where('user_id', $user->id)
                ->where('level', 'state')->where('state_id', $complaint->state_id)->exists();
        }

        return $user->hasAnyRole(['national_admin', 'system_admin']);
    }

    public function confirmResolution(User $user, Complaint $complaint): bool
    {
        return $this->ownsComplaint($user, $complaint);
    }

    private function ownsComplaint(User $user, Complaint $complaint): bool
    {
        return AnonymousIdentity::where('user_id', $user->id)
            ->where('anonymous_ref', $complaint->anonymous_ref)
            ->exists();
    }
}
