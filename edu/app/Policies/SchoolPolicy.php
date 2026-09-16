<?php

namespace App\Policies;

use App\Models\School;
use App\Models\User;

class SchoolPolicy
{
    public function manage(User $user, School $school): bool
    {
        if (! $user->can('manage-school-profile')) {
            return false;
        }

        return $user->schoolStaffAssignments()->where('school_id', $school->id)->exists();
    }
}
