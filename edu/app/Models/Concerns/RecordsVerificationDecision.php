<?php

namespace App\Models\Concerns;

use App\Models\User;

/**
 * Shared by the three school-relationship models (parent/student/teacher).
 *
 * Approving or rejecting a link is a School Admin's decision about a real
 * person's access to a school, so the record has to name the decider. Before
 * this, approval stamped `verified_at` and nothing else, and a rejection
 * wrote only `status` — leaving no way to answer "who rejected this parent,
 * and when?".
 *
 * `verified_at` is still stamped on approval only, so existing reads keep
 * working; `decided_at`/`decided_by_user_id` are set either way.
 */
trait RecordsVerificationDecision
{
    /**
     * The attribution columns are outside `$fillable` on purpose — this is
     * the only way to set them, so a decision can't be forged through a
     * mass-assigned update.
     */
    public function recordDecision(string $status, User $decidedBy): void
    {
        $attributes = [
            'status' => $status,
            'decided_at' => now(),
            'decided_by_user_id' => $decidedBy->id,
        ];

        if ($status === 'verified') {
            $attributes['verified_at'] = now();
        }

        $this->forceFill($attributes)->save();
    }

    public function decidedBy()
    {
        return $this->belongsTo(User::class, 'decided_by_user_id');
    }
}
