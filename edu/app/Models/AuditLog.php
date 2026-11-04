<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * The platform-wide audit trail (spec section I).
 *
 * Two recorders, and the difference between them is a privacy boundary, not
 * a convenience:
 *
 * - `record()` is for an identified actor doing something in an official
 *   capacity — an officer verifying a school, a school admin approving a
 *   parent link or answering a complaint. Actor and IP are the point.
 * - `recordAnonymous()` is for an action taken by a *submitter*. It writes
 *   no `user_id` and no `ip_address`, ever. Complaints and feedback
 *   deliberately carry no `user_id` column (see SECURITY_PRIVACY.md), so
 *   logging a submitter's id — or their IP — next to a complaint id here
 *   would rebuild exactly the user->complaint link the anonymisation design
 *   exists to prevent, and hand it to every System Admin with access to
 *   /admin/audit-log. The action still gets a trail; it just isn't one that
 *   can be reversed outside IdentityResolutionService.
 */
#[Fillable(['user_id', 'action', 'auditable_type', 'auditable_id', 'ip_address', 'metadata'])]
class AuditLog extends Model
{
    public $timestamps = false;

    protected function casts(): array
    {
        return [
            'metadata' => 'array',
            'created_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * An identified actor's official action. Records actor + IP.
     */
    public static function record(string $action, ?int $userId = null, ?Model $auditable = null, ?array $metadata = null): self
    {
        return static::write($action, $userId, $auditable, $metadata, request()?->ip());
    }

    /**
     * A submitter's action. Never records actor or IP — see the class
     * comment. `anonymous_ref` is safe to carry in metadata: it is already
     * on the record itself and reversing it still requires
     * IdentityResolutionService, which logs every reveal.
     */
    public static function recordAnonymous(string $action, ?Model $auditable = null, ?array $metadata = null): self
    {
        return static::write($action, null, $auditable, $metadata, null);
    }

    private static function write(string $action, ?int $userId, ?Model $auditable, ?array $metadata, ?string $ip): self
    {
        return static::create([
            'user_id' => $userId,
            'action' => $action,
            'auditable_type' => $auditable ? get_class($auditable) : null,
            'auditable_id' => $auditable?->getKey(),
            'ip_address' => $ip,
            'metadata' => $metadata,
        ]);
    }

    /**
     * How /admin/audit-log names the actor. A row with no user is either a
     * submitter action (anonymous by design) or a scheduled/system task —
     * telling those apart matters when reading the log.
     */
    public function actorLabel(): string
    {
        if ($this->user) {
            return $this->user->name;
        }

        return isset($this->metadata['anonymous_ref']) ? 'Submitter (anonymous)' : 'System';
    }
}
