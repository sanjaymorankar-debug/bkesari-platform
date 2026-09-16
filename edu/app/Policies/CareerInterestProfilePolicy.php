<?php

namespace App\Policies;

use App\Models\CareerInterestProfile;
use App\Models\User;
use App\Services\DevelopmentAccessService;

class CareerInterestProfilePolicy
{
    public function __construct(private readonly DevelopmentAccessService $access) {}

    public function view(User $user, CareerInterestProfile $profile): bool
    {
        return $this->access->canView($user, $profile->student_user_id, 'career_pathway');
    }

    public function update(User $user, CareerInterestProfile $profile): bool
    {
        // Interests belong to the child. Nobody edits someone else's stated
        // interests after the fact — a changed mind is a new dated capture,
        // which is the whole point of keeping these as a time series.
        return $user->id === $profile->student_user_id;
    }
}
