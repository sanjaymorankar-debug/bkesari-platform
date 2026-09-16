<?php

namespace App\Services;

use App\Models\ConsentRecord;
use App\Models\ParentSchoolRelationship;
use App\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\Auth;

/**
 * DPDP Act 2023 Section 9 gate.
 *
 * Almost every student on this platform is a minor, so their development data
 * cannot be collected at all without verifiable guardian consent recorded
 * beforehand. This service is the single place that answers "may we?" — the
 * capability, growth, career and life-skills modules all call it, and the
 * policies call it too, so a missing consent blocks both writing and reading.
 *
 * Consent is checked per purpose, never globally: a guardian who agreed to
 * growth observations has not thereby agreed to career profiling.
 */
class ConsentService
{
    public const NOTICE_VERSION = '2026.09';

    public function hasConsent(int $studentUserId, string $purpose): bool
    {
        return ConsentRecord::query()
            ->where('student_user_id', $studentUserId)
            ->where('purpose', $purpose)
            ->inForce()
            ->exists();
    }

    /**
     * Same check, but refuses to continue. Used on write paths so a bug in a
     * form can't silently create data the guardian never agreed to.
     */
    public function requireConsent(int $studentUserId, string $purpose): void
    {
        if (! $this->hasConsent($studentUserId, $purpose)) {
            throw new AuthorizationException(
                'This action needs the guardian\'s consent for "'
                .(ConsentRecord::PURPOSES[$purpose]['label'] ?? $purpose)
                .'", which is not currently on record.'
            );
        }
    }

    public function activeConsent(int $studentUserId, string $purpose): ?ConsentRecord
    {
        return ConsentRecord::query()
            ->where('student_user_id', $studentUserId)
            ->where('purpose', $purpose)
            ->inForce()
            ->latest('granted_at')
            ->first();
    }

    /**
     * Whether this adult is recorded as a guardian of this child, via a
     * school-verified parent relationship. Consent from an unverified adult
     * is not verifiable consent, so it is not accepted.
     */
    public function isVerifiedGuardian(User $guardian, int $studentUserId): bool
    {
        return ParentSchoolRelationship::query()
            ->where('user_id', $guardian->id)
            ->where('student_user_id', $studentUserId)
            ->where('status', 'verified')
            ->exists();
    }

    public function grant(User $guardian, int $studentUserId, string $purpose, ?string $ipAddress = null): ConsentRecord
    {
        if (! array_key_exists($purpose, ConsentRecord::PURPOSES)) {
            throw new AuthorizationException('Unknown consent purpose.');
        }

        if (! $this->isVerifiedGuardian($guardian, $studentUserId)) {
            throw new AuthorizationException(
                'Consent can only be given by a guardian the school has verified for this child.'
            );
        }

        // An existing in-force grant is returned as-is rather than duplicated,
        // so the granted_at date stays the date consent actually began.
        if ($existing = $this->activeConsent($studentUserId, $purpose)) {
            return $existing;
        }

        return ConsentRecord::create([
            'student_user_id' => $studentUserId,
            'granted_by_user_id' => $guardian->id,
            'purpose' => $purpose,
            'notice_text' => ConsentRecord::PURPOSES[$purpose]['notice'],
            'notice_version' => self::NOTICE_VERSION,
            'status' => 'granted',
            'verification_method' => 'verified_parent_school_relationship',
            'granted_at' => now(),
            'ip_address' => $ipAddress ?? request()?->ip(),
        ]);
    }

    /**
     * Withdrawal is a right under DPDP, so it takes effect immediately and
     * without justification. The record is marked withdrawn rather than
     * deleted — the platform still has to be able to show that data collected
     * last term was collected while consent was in force.
     */
    public function withdraw(User $guardian, int $studentUserId, string $purpose): void
    {
        if (! $this->isVerifiedGuardian($guardian, $studentUserId)) {
            throw new AuthorizationException('Only a verified guardian can withdraw this consent.');
        }

        ConsentRecord::query()
            ->where('student_user_id', $studentUserId)
            ->where('purpose', $purpose)
            ->inForce()
            ->update(['status' => 'withdrawn', 'withdrawn_at' => now()]);
    }

    /**
     * Purpose-by-purpose state for a child, for the guardian's consent screen.
     */
    public function statusFor(int $studentUserId): array
    {
        $active = ConsentRecord::query()
            ->where('student_user_id', $studentUserId)
            ->inForce()
            ->get()
            ->keyBy('purpose');

        $status = [];

        foreach (ConsentRecord::PURPOSES as $purpose => $meta) {
            $record = $active->get($purpose);

            $status[$purpose] = [
                'label' => $meta['label'],
                'notice' => $meta['notice'],
                'granted' => $record !== null,
                'granted_at' => $record?->granted_at,
            ];
        }

        return $status;
    }

    public function currentUserIsGuardianOf(int $studentUserId): bool
    {
        $user = Auth::user();

        return $user !== null && $this->isVerifiedGuardian($user, $studentUserId);
    }
}
