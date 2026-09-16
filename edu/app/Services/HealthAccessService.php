<?php

namespace App\Services;

use App\Models\CounsellingSession;
use App\Models\HealthAccessLog;
use App\Models\SchoolStaff;
use App\Models\StudentSchoolRelationship;
use App\Models\User;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * Spec section 20 — the health and development data access matrix, expressed
 * as code rather than as a table in a document nobody reads at 2am.
 *
 * The matrix in one paragraph: a guardian and the child see the child's own
 * physical health records and the counsellor's *shared summaries*; the school
 * nurse manages physical health for their own school; the counsellor sees
 * wellbeing and counselling records for their own school; a teacher may raise
 * an observation but may read nothing back; and government sees nothing
 * individual at all.
 *
 * Two rules deserve stating outright because they are the ones under pressure:
 *
 * 1. **Raw counselling notes are visible only to the counsellor.** Not the
 *    guardian, not the nurse, not the school administration, not an officer.
 *    Guardians get `shareable_summary`, which a counsellor writes on purpose.
 *    `canViewCounsellingNotes()` exists separately from `canView()` so the
 *    distinction cannot be lost by accident.
 *
 * 2. **There is no government branch.** Spec section 20 grants officers
 *    aggregated statistics only, and section 32 repeats it. So no officer role
 *    appears anywhere in this class, and a test asserts none is ever added.
 *    Aggregates are computed elsewhere, from counts, never by handing an
 *    officer a record.
 *
 * Everything here is additionally gated on DPDP Act section 9 consent for the
 * relevant purpose — a school with no consent has no access, however senior
 * the person asking.
 */
class HealthAccessService
{
    public const PURPOSE_PHYSICAL = 'physical_health';

    public const PURPOSE_WELLBEING = 'mental_wellbeing';

    public function __construct(private readonly ConsentService $consent) {}

    /**
     * May this person read this child's records of the given kind?
     *
     * @param  string  $purpose  one of the PURPOSE_* constants
     */
    public function canView(User $viewer, int $studentUserId, string $purpose): bool
    {
        // The child themself. A young person is not a stranger to their own
        // health record, and consent is held by their guardian for collection,
        // not to keep the record from them.
        if ($viewer->id === $studentUserId) {
            return true;
        }

        if (! $this->consent->hasConsent($studentUserId, $purpose)) {
            return false;
        }

        if ($this->consent->isVerifiedGuardian($viewer, $studentUserId)) {
            return true;
        }

        $schoolIds = $this->studentSchoolIds($studentUserId);

        if ($schoolIds === []) {
            return false;
        }

        $staffsOneOfThoseSchools = SchoolStaff::where('user_id', $viewer->id)
            ->whereIn('school_id', $schoolIds)
            ->exists();

        if (! $staffsOneOfThoseSchools) {
            return false;
        }

        return match ($purpose) {
            self::PURPOSE_PHYSICAL => $viewer->hasAnyRole(['school_nurse', 'counsellor']),
            self::PURPOSE_WELLBEING => $viewer->hasRole('counsellor'),
            default => false,
        };
    }

    /**
     * The stricter tier. Raw session notes are the counsellor's own record and
     * are not part of what "having access to wellbeing data" means.
     *
     * Deliberately does not grant the child access to raw notes either: notes
     * are the professional's working record and may contain third-party
     * information. A child asking what was written about them should be
     * answered by the counsellor, not by a database read.
     */
    public function canViewCounsellingNotes(User $viewer, CounsellingSession $session): bool
    {
        if (! $viewer->hasRole('counsellor')) {
            return false;
        }

        if (! $this->consent->hasConsent($session->student_user_id, self::PURPOSE_WELLBEING)) {
            return false;
        }

        return SchoolStaff::where('user_id', $viewer->id)
            ->where('school_id', $session->school_id)
            ->exists();
    }

    /** Only a nurse or medical officer at the child's own school may record a screening. */
    public function canRecordPhysicalHealth(User $viewer, int $studentUserId, int $schoolId): bool
    {
        if (! $viewer->hasRole('school_nurse')) {
            return false;
        }

        if (! $this->consent->hasConsent($studentUserId, self::PURPOSE_PHYSICAL)) {
            return false;
        }

        return $this->staffsSchoolAndStudentAttends($viewer, $studentUserId, $schoolId);
    }

    /**
     * Teachers may raise an observation — and that is the whole of their
     * write access to wellbeing. Section 19's rule is that a teacher's input
     * is an observation, so the permission is named for what it allows rather
     * than for the data area it touches.
     */
    public function canRaiseWellbeingConcern(User $viewer, int $studentUserId, int $schoolId): bool
    {
        if (! $viewer->hasAnyRole(['teacher', 'counsellor', 'school_nurse'])) {
            return false;
        }

        if (! $this->consent->hasConsent($studentUserId, self::PURPOSE_WELLBEING)) {
            return false;
        }

        return $this->staffsSchoolAndStudentAttends($viewer, $studentUserId, $schoolId);
    }

    public function canRecordCounsellingSession(User $viewer, int $studentUserId, int $schoolId): bool
    {
        if (! $viewer->hasRole('counsellor')) {
            return false;
        }

        if (! $this->consent->hasConsent($studentUserId, self::PURPOSE_WELLBEING)) {
            return false;
        }

        return $this->staffsSchoolAndStudentAttends($viewer, $studentUserId, $schoolId);
    }

    /**
     * Spec section 21 — every sensitive action logged, including refused ones.
     * A pattern of denials against one child is itself worth being able to see.
     */
    public function log(
        User $actor,
        int $studentUserId,
        string $recordType,
        string $action,
        ?int $recordId = null,
        ?string $detail = null,
    ): HealthAccessLog {
        return HealthAccessLog::create([
            'student_user_id' => $studentUserId,
            'actor_user_id' => $actor->id,
            'actor_role' => $actor->getRoleNames()->first(),
            'record_type' => $recordType,
            'record_id' => $recordId,
            'action' => $action,
            'detail' => $detail,
            'occurred_at' => now(),
        ]);
    }

    /**
     * Read with the access check and the audit entry bound together, so a
     * caller cannot accidentally do one without the other.
     *
     * @throws HttpException
     */
    public function authoriseAndLogView(User $viewer, int $studentUserId, string $purpose, string $recordType): void
    {
        if (! $this->canView($viewer, $studentUserId, $purpose)) {
            $this->log($viewer, $studentUserId, $recordType, 'denied', null, 'Access refused by the section 20 matrix.');

            abort(403, 'You are not authorised to view this record.');
        }

        $this->log($viewer, $studentUserId, $recordType, 'viewed');
    }

    /**
     * Children this member of staff may work with, for building a caseload
     * list. Consent is re-checked per child — being on a roster is not access.
     *
     * @return list<int>
     */
    public function caseloadStudentIds(User $staff, string $purpose): array
    {
        $schoolIds = SchoolStaff::where('user_id', $staff->id)->pluck('school_id');

        if ($schoolIds->isEmpty()) {
            return [];
        }

        return StudentSchoolRelationship::whereIn('school_id', $schoolIds)
            ->where('status', 'verified')
            ->pluck('user_id')
            ->unique()
            ->filter(fn (int $studentId): bool => $this->consent->hasConsent($studentId, $purpose))
            ->values()
            ->all();
    }

    /** @return list<int> */
    private function studentSchoolIds(int $studentUserId): array
    {
        return StudentSchoolRelationship::where('user_id', $studentUserId)
            ->where('status', 'verified')
            ->pluck('school_id')
            ->all();
    }

    private function staffsSchoolAndStudentAttends(User $viewer, int $studentUserId, int $schoolId): bool
    {
        $staffs = SchoolStaff::where('user_id', $viewer->id)
            ->where('school_id', $schoolId)
            ->exists();

        $attends = StudentSchoolRelationship::where('user_id', $studentUserId)
            ->where('school_id', $schoolId)
            ->where('status', 'verified')
            ->exists();

        return $staffs && $attends;
    }
}
