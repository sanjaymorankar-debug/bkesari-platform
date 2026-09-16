<?php

namespace App\Policies;

use App\Models\CapabilityObservation;
use App\Models\User;
use App\Services\DevelopmentAccessService;

class CapabilityObservationPolicy
{
    public function __construct(private readonly DevelopmentAccessService $access) {}

    public function view(User $user, CapabilityObservation $observation): bool
    {
        // A pending peer observation is visible only to whoever can clear it,
        // never to the child it is about, until it has been moderated.
        if ($observation->moderation_status !== 'approved') {
            return $this->access->canModeratePeerObservations($user, $observation->school_id);
        }

        return $this->access->canView($user, $observation->student_user_id, 'capability_growth');
    }

    public function update(User $user, CapabilityObservation $observation): bool
    {
        // Only the observer may edit their own note, and only while it is
        // theirs to correct — one person never rewrites another's observation.
        return $user->id === $observation->observer_user_id;
    }

    public function delete(User $user, CapabilityObservation $observation): bool
    {
        return $user->id === $observation->observer_user_id;
    }

    public function moderate(User $user, CapabilityObservation $observation): bool
    {
        return $this->access->canModeratePeerObservations($user, $observation->school_id);
    }
}
