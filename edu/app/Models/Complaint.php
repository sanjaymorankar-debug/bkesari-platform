<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\UniqueConstraintViolationException;

#[Fillable([
    'complaint_number', 'school_id', 'complaint_category_id', 'district_id', 'state_id',
    'anonymous_ref', 'submitted_role', 'subject', 'description', 'severity', 'status',
    'is_child_safety_flag', 'resolved_at',
])]
class Complaint extends Model
{
    /**
     * How many times createNumbered() goes for the next number before giving up.
     */
    private const NUMBER_ATTEMPTS = 5;

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
     *
     * The sequence continues from the highest number already issued with this
     * prefix. It used to be the count of them plus one, which hands out a
     * number that is already taken as soon as any earlier complaint is gone,
     * and from then on every complaint in that district failed on the unique
     * index. Ordered by length first because the padding is a minimum, not a
     * maximum: 1000000 sorts below 999999 as text.
     *
     * This is only the next number as of now; two submissions at the same
     * moment can both get it. createNumbered() is what deals with that.
     */
    public static function generateComplaintNumber(State $state, District $district): string
    {
        $prefix = static::complaintNumberPrefix($state, $district);

        $last = static::where('complaint_number', 'like', $prefix.'%')
            ->orderByRaw('length(complaint_number) desc')
            ->orderByDesc('complaint_number')
            ->value('complaint_number');

        $next = $last === null ? 1 : ((int) substr($last, strlen($prefix))) + 1;

        return $prefix.str_pad((string) $next, 6, '0', STR_PAD_LEFT);
    }

    /**
     * Create a complaint under the next free number for its state and district.
     *
     * On PostgreSQL the lookup and the insert happen under a lock per
     * district and year, so submissions in one district queue for a number
     * instead of racing for it: retrying alone was measured to fail four of
     * six processes filing ten complaints each at once. The lock is
     * pg_advisory_xact_lock, held until the transaction ends, which is what
     * makes it safe behind Neon's pooler; a session-level lock would stay on
     * whichever server connection the pooler hands out next.
     *
     * A clash can still come from a number written some other way (or on
     * SQLite, which has no such lock); the unique index refuses it and this
     * takes the next number. Each attempt is its own transaction, or a
     * savepoint inside a caller's: on PostgreSQL a failed INSERT otherwise
     * poisons the whole surrounding transaction, so even the retry would fail.
     */
    public static function createNumbered(State $state, District $district, array $attributes): static
    {
        $connection = (new static)->getConnection();
        $prefix = static::complaintNumberPrefix($state, $district);

        for ($attempt = 1; ; $attempt++) {
            try {
                return $connection->transaction(function () use ($connection, $prefix, $state, $district, $attributes) {
                    if ($connection->getDriverName() === 'pgsql') {
                        $connection->select('select pg_advisory_xact_lock(hashtext(?))', [$prefix]);
                    }

                    return static::create(
                        ['complaint_number' => static::generateComplaintNumber($state, $district)] + $attributes
                    );
                });
            } catch (UniqueConstraintViolationException $e) {
                if ($attempt >= self::NUMBER_ATTEMPTS || ! str_contains($e->getMessage(), 'complaint_number')) {
                    throw $e;
                }
            }
        }
    }

    private static function complaintNumberPrefix(State $state, District $district): string
    {
        return sprintf('EDU-%s-%s-%d-', strtoupper($state->code), strtoupper($district->code), now()->year);
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
