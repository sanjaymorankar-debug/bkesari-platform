<?php

namespace App\Services;

use App\Models\AnonymousIdentity;
use App\Models\AuditLog;
use App\Models\IdentityAccessLog;
use App\Models\User;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\ValidationException;

/**
 * The only code path allowed to reverse an anonymous_ref back to a real
 * user. Callers must hold the access-protected-identity permission (see
 * RolesAndPermissionsSeeder) and must supply a non-empty reason — every
 * call is written to identity_access_logs — officer, time, record, reason,
 * action (spec section I). The reason requirement is enforced here, not
 * just in the UI, so no future caller can accidentally bypass it.
 */
class IdentityResolutionService
{
    public function resolve(string $anonymousRef, string $action, string $reason): ?User
    {
        $officer = Auth::user();

        abort_unless($officer && $officer->can('access-protected-identity'), 403);

        if (trim($reason) === '') {
            throw ValidationException::withMessages(['reason' => 'A reason is required before identity can be revealed.']);
        }

        $identity = AnonymousIdentity::where('anonymous_ref', $anonymousRef)->first();

        IdentityAccessLog::create([
            'officer_user_id' => $officer->id,
            'anonymous_ref' => $anonymousRef,
            'action' => $action,
            'reason' => $reason,
        ]);

        // Also surfaced in the general trail so /admin/audit-log shows a
        // reveal in sequence with everything else that happened to the
        // record, rather than only on its own tab. Deliberately records the
        // *officer* and the ref — never the identity that came back, which
        // would turn the audit log itself into a deanonymisation table.
        AuditLog::record('identity.revealed', $officer->id, null, [
            'anonymous_ref' => $anonymousRef,
            'context' => $action,
            'resolved' => $identity !== null,
        ]);

        return $identity?->user;
    }
}
