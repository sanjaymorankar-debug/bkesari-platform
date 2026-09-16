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

    public function respond(User $user, Complaint $complaint): bool
    {
        if (! $user->can('respond-to-complaint')) {
            return false;
        }

        return $user->schoolStaffAssignments()->where('school_id', $complaint->school_id)->exists();
    }

    public function review(User $user, Complaint $complaint): bool
    {
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
