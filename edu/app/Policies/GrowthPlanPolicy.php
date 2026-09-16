<?php

namespace App\Policies;

use App\Models\GrowthPlan;
use App\Models\User;
use App\Services\DevelopmentAccessService;

class GrowthPlanPolicy
{
    public function __construct(private readonly DevelopmentAccessService $access) {}

    public function view(User $user, GrowthPlan $plan): bool
    {
        // A draft is the teacher's working copy. Guardians and the child see
        // the plan once it has actually been shared, so a half-written note
        // never reaches a parent as if it were finished.
        if (! $plan->isSharedWithParent() && ! $this->access->canManageGrowthPlan($user, $plan->student_user_id, $plan->school_id)) {
            return false;
        }

        return $this->access->canView($user, $plan->student_user_id, 'capability_growth');
    }

    public function update(User $user, GrowthPlan $plan): bool
    {
        return $this->access->canManageGrowthPlan($user, $plan->student_user_id, $plan->school_id);
    }

    /** Acknowledging the plan is the guardian's half of the loop. */
    public function acknowledge(User $user, GrowthPlan $plan): bool
    {
        return $plan->isSharedWithParent()
            && $this->access->isVerifiedGuardian($user, $plan->student_user_id);
    }
}
