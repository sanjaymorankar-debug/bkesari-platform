<?php

namespace App\Services;

use App\Models\ParentSchoolRelationship;
use App\Models\SchoolStaff;
use App\Models\StudentSchoolRelationship;
use App\Models\TeacherSchoolRelationship;
use App\Models\User;

/**
 * Spec section 20's access matrix for capability, growth, career and
 * life-skills data, in one place.
 *
 * The rule this class exists to enforce is narrow and absolute: a child's
 * development record is visible to that child, that child's verified
 * guardians, and the staff at the school the child is actually enrolled at —
 * and to nobody else. Government roles are deliberately absent from every
 * method below. There is no "officer override", because section 20 grants
 * government aggregate and anonymised access only, and the way to guarantee
 * that is to give the individual-record path no officer branch at all.
 *
 * Known approximation, stated plainly: this build has no class-roster or
 * teacher-to-student subject linkage, so "their students" resolves to
 * "students with a verified enrolment at a school where this teacher is
 * verified". That is wider than the spec's per-subject, per-period intent.
 * It is the same school+subject proxy already documented for the Teacher
 * Effectiveness Index, and it tightens automatically once real rosters exist —
 * see STUDENT_GROWTH_FRAMEWORK.md.
 */
class DevelopmentAccessService
{
    public function __construct(private readonly ConsentService $consent) {}

    /**
     * May this viewer see this child's development data for this purpose?
     * Consent is checked first: without guardian consent in force, nobody at
     * the school can see the data, regardless of role.
     */
    public function canView(User $viewer, int $studentUserId, string $purpose): bool
    {
        // The child themself. A child's own record is never hidden from them,
        // and their own access does not depend on the guardian consent that
        // governs collection by the school.
        if ($viewer->id === $studentUserId) {
            return true;
        }

        if (! $this->consent->hasConsent($studentUserId, $purpose)) {
            return false;
        }

        if ($this->isVerifiedGuardian($viewer, $studentUserId)) {
            return true;
        }

        return $this->sharesSchoolWith($viewer, $studentUserId);
    }

    /**
     * May this viewer add an observation about this child at this school?
     * Teachers and career mentors may; guardians may add their own from-home
     * observations, which is what makes section 16's loop two-way.
     */
    public function canRecordObservation(User $viewer, int $studentUserId, int $schoolId): bool
    {
        if (! $this->consent->hasConsent($studentUserId, 'capability_growth')) {
            return false;
        }

        if ($viewer->id === $studentUserId) {
            return $this->studentIsEnrolledAt($studentUserId, $schoolId);
        }

        if ($this->isVerifiedGuardian($viewer, $studentUserId)) {
            return true;
        }

        return $this->staffsSchool($viewer, $schoolId)
            && $this->studentIsEnrolledAt($studentUserId, $schoolId);
    }

    /**
     * May this viewer create or edit the shared growth plan? The plan is a
     * school-side artefact — guardians contribute observations and
     * acknowledge the plan, but do not author it.
     */
    public function canManageGrowthPlan(User $viewer, int $studentUserId, int $schoolId): bool
    {
        return $this->consent->hasConsent($studentUserId, 'capability_growth')
            && $this->staffsSchool($viewer, $schoolId)
            && $this->studentIsEnrolledAt($studentUserId, $schoolId);
    }

    /** Peer observations stay hidden until a teacher at the school clears them. */
    public function canModeratePeerObservations(User $viewer, int $schoolId): bool
    {
        return $viewer->hasRole('teacher')
            ? $this->staffsSchool($viewer, $schoolId)
            : $viewer->hasRole('school_admin') && $this->staffsSchool($viewer, $schoolId);
    }

    /**
     * Students whose development records this staff member may open — used to
     * build teacher and mentor lists without ever querying across schools.
     *
     * @return list<int>
     */
    public function accessibleStudentIds(User $staff): array
    {
        $schoolIds = $this->schoolIdsFor($staff);

        if ($schoolIds === []) {
            return [];
        }

        return StudentSchoolRelationship::query()
            ->whereIn('school_id', $schoolIds)
            ->where('status', 'verified')
            ->pluck('user_id')
            ->unique()
            ->values()
            ->all();
    }

    /** Children this guardian is verified for. @return list<int> */
    public function guardianChildIds(User $guardian): array
    {
        return ParentSchoolRelationship::query()
            ->where('user_id', $guardian->id)
            ->where('status', 'verified')
            ->whereNotNull('student_user_id')
            ->pluck('student_user_id')
            ->unique()
            ->values()
            ->all();
    }

    public function isVerifiedGuardian(User $viewer, int $studentUserId): bool
    {
        return $this->consent->isVerifiedGuardian($viewer, $studentUserId);
    }

    private function sharesSchoolWith(User $staff, int $studentUserId): bool
    {
        $schoolIds = $this->schoolIdsFor($staff);

        if ($schoolIds === []) {
            return false;
        }

        return StudentSchoolRelationship::query()
            ->where('user_id', $studentUserId)
            ->where('status', 'verified')
            ->whereIn('school_id', $schoolIds)
            ->exists();
    }

    private function studentIsEnrolledAt(int $studentUserId, int $schoolId): bool
    {
        return StudentSchoolRelationship::query()
            ->where('user_id', $studentUserId)
            ->where('school_id', $schoolId)
            ->where('status', 'verified')
            ->exists();
    }

    private function staffsSchool(User $staff, int $schoolId): bool
    {
        return in_array($schoolId, $this->schoolIdsFor($staff), true);
    }

    /**
     * Schools this user works at, whether as a verified teacher or as
     * assigned staff (school admins, career & life-skills mentors).
     *
     * @return list<int>
     */
    private function schoolIdsFor(User $staff): array
    {
        $teaching = TeacherSchoolRelationship::query()
            ->where('user_id', $staff->id)
            ->where('status', 'verified')
            ->pluck('school_id');

        $assigned = SchoolStaff::query()
            ->where('user_id', $staff->id)
            ->pluck('school_id');

        return $teaching->merge($assigned)->unique()->values()->all();
    }
}
