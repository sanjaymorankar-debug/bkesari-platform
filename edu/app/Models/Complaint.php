<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

#[Fillable([
    'complaint_number', 'school_id', 'complaint_category_id', 'district_id', 'state_id',
    'anonymous_ref', 'submitted_role', 'subject', 'description', 'severity', 'status',
    'is_child_safety_flag', 'resolved_at',
])]
class Complaint extends Model
{
    protected function casts(): array
    {
        return [
            'is_child_safety_flag' => 'boolean',
            'resolved_at' => 'datetime',
        ];
    }

    public function school(): BelongsTo
    {
        return $this->belongsTo(School::class);
    }

    public function category(): BelongsTo
    {
        return $this->belongsTo(ComplaintCategory::class, 'complaint_category_id');
    }

    public function district(): BelongsTo
    {
        return $this->belongsTo(District::class);
    }

    public function state(): BelongsTo
    {
        return $this->belongsTo(State::class);
    }

    public function evidence(): HasMany
    {
        return $this->hasMany(ComplaintEvidence::class);
    }

    public function responses(): HasMany
    {
        return $this->hasMany(ComplaintResponse::class)->latest('id');
    }

    public function statusHistory(): HasMany
    {
        return $this->hasMany(ComplaintStatusHistory::class)->latest('created_at');
    }

    public function resolution(): HasOne
    {
        return $this->hasOne(ComplaintResolution::class);
    }

    /**
     * EDU-{STATE}-{DISTRICT}-{YEAR}-{sequence} per spec section S.
     */
    public static function generateComplaintNumber(State $state, District $district): string
    {
        $year = now()->year;
        $prefix = sprintf('EDU-%s-%s-%d-', strtoupper($state->code), strtoupper($district->code), $year);

        $count = static::where('complaint_number', 'like', $prefix.'%')->count() + 1;

        return $prefix.str_pad((string) $count, 6, '0', STR_PAD_LEFT);
    }

    public function recordStatusChange(string $toStatus, ?int $changedByUserId, ?string $note = null): void
    {
        $from = $this->status;
        $this->status = $toStatus;
        $this->save();

        $this->statusHistory()->create([
            'from_status' => $from,
            'to_status' => $toStatus,
            'changed_by_user_id' => $changedByUserId,
            'note' => $note,
        ]);
    }
}
