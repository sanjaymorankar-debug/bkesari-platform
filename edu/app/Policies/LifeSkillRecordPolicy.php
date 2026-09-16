<?php

namespace App\Policies;

use App\Models\LifeSkillRecord;
use App\Models\User;
use App\Services\DevelopmentAccessService;

class LifeSkillRecordPolicy
{
    public function __construct(private readonly DevelopmentAccessService $access) {}

    public function view(User $user, LifeSkillRecord $record): bool
    {
        return $this->access->canView($user, $record->student_user_id, 'life_skills');
    }

    public function update(User $user, LifeSkillRecord $record): bool
    {
        return $user->id === $record->recorded_by_user_id;
    }
}
