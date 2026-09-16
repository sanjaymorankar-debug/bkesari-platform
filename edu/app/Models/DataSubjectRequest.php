<?php

namespace App\Models;

use App\Support\DataRetention;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

/** Spec sections 21, 34 and 40. */
#[Fillable([
    'reference', 'requester_user_id', 'subject_user_id', 'request_type',
    'categories', 'detail', 'due_by',
])]
class DataSubjectRequest extends Model
{
    public const TYPES = [
        'access' => 'See what is held',
        'correction' => 'Correct something that is wrong',
        'erasure' => 'Delete data',
    ];

    /**
     * Days to deal with a request. A working assumption, not a statutory
     * figure — it should be checked against the DPDP Rules as finalised
     * before this is relied on.
     */
    public const RESPONSE_DAYS = 30;

    protected $attributes = ['status' => 'submitted'];

    protected function casts(): array
    {
        return [
            'categories' => 'array',
            'outcome_by_category' => 'array',
            'handled_at' => 'datetime',
            'due_by' => 'datetime',
        ];
    }

    public function requester(): BelongsTo
    {
        return $this->belongsTo(User::class, 'requester_user_id');
    }

    public function subject(): BelongsTo
    {
        return $this->belongsTo(User::class, 'subject_user_id');
    }

    public function handledBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'handled_by_user_id');
    }

    public static function generateReference(): string
    {
        do {
            $reference = 'DSR-'.strtoupper(Str::random(8));
        } while (self::where('reference', $reference)->exists());

        return $reference;
    }

    public function typeLabel(): string
    {
        return self::TYPES[$this->request_type] ?? $this->request_type;
    }

    public function isOpen(): bool
    {
        return in_array($this->status, ['submitted', 'under_review'], true);
    }

    public function isOverdue(): bool
    {
        return $this->isOpen() && $this->due_by !== null && $this->due_by->isPast();
    }

    /**
     * Categories in this request the platform can actually erase, and those it
     * cannot — worked out up front so a requester is told before they wait,
     * rather than after.
     *
     * @return array{erasable: list<string>, protected: list<string>}
     */
    public function erasureScope(): array
    {
        $erasable = [];
        $protected = [];

        foreach ($this->categories ?? [] as $category) {
            if (DataRetention::isErasable($category)) {
                $erasable[] = $category;
            } else {
                $protected[] = $category;
            }
        }

        return ['erasable' => $erasable, 'protected' => $protected];
    }
}
