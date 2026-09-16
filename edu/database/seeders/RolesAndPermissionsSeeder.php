<?php

namespace Database\Seeders;

use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Cache;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;

/**
 * The platform's roles. Only parent/student/teacher/school_admin/
 * district_officer get real Phase 1 dashboards (see ROADMAP.md) — the rest
 * exist so RBAC, login, and routing are provably correct end to end even
 * where the UI for them is still a placeholder.
 *
 * career_mentor and data_protection_officer were added with the student
 * growth/career modules (spec section 6, roles 7 and 17).
 */
class RolesAndPermissionsSeeder extends Seeder
{
    use WithoutModelEvents;

    public function run(): void
    {
        Cache::forget('spatie.permission.cache');

        $permissions = [
            'submit-complaint',
            'submit-feedback',
            'view-own-complaints',
            'respond-to-complaint',
            'manage-school-profile',
            'review-district-complaints',
            'review-state-complaints',
            'access-protected-identity',
            'view-audit-logs',
            'manage-admin-settings',
            'view-national-analytics',
            // Spec sections 15-17. Note there is deliberately no
            // "view-any-student-growth" permission: access to an individual
            // child's development record is decided per child by
            // DevelopmentAccessService (guardian, own school, or the child
            // themself), never granted wholesale by holding a role.
            'record-capability-observation',
            'manage-growth-plan',
            'record-life-skills',
            'manage-consent',
            // Spec section 25. Note there is deliberately no
            // "close-safeguarding-case" permission separate from this one:
            // whether a case may be closed depends on the case (has an
            // external report been recorded?), not on the holder's role, and
            // SafeguardingService enforces that.
            'handle-safeguarding-cases',
            // Spec sections 18-20. As with growth data, there is deliberately
            // no "view-any-health-record" permission: who may read a given
            // child's record is decided per child by HealthAccessService
            // (guardian, the child, or authorised staff at their own school
            // with consent in force), never granted wholesale by a role.
            'record-physical-health',
            'raise-wellbeing-concern',
            'record-counselling-session',
        ];

        foreach ($permissions as $permission) {
            Permission::firstOrCreate(['name' => $permission]);
        }

        $roleMap = [
            'public' => [],
            'parent' => ['submit-complaint', 'submit-feedback', 'view-own-complaints', 'record-capability-observation', 'manage-consent'],
            'student' => ['submit-complaint', 'submit-feedback', 'view-own-complaints', 'record-capability-observation'],
            // A teacher may raise a wellbeing observation and nothing more —
            // spec section 19's "teachers must never diagnose" expressed as a
            // permission set, not just as a UI choice.
            'teacher' => ['view-own-complaints', 'record-capability-observation', 'manage-growth-plan', 'record-life-skills', 'raise-wellbeing-concern'],
            'school_nurse' => ['record-physical-health', 'raise-wellbeing-concern'],
            // Section 20: a counsellor may read a physical-health record but
            // must not alter one, so no record-physical-health here.
            'counsellor' => ['record-counselling-session', 'raise-wellbeing-concern'],
            'career_mentor' => ['record-life-skills', 'record-capability-observation'],
            // Note school_admin does NOT hold handle-safeguarding-cases, and
            // must not: spec section 25 and POCSO section 19 mean a school's
            // ordinary administration is not the venue for these cases. The
            // school-side role that does hold it is child_safety_officer.
            'school_admin' => ['respond-to-complaint', 'manage-school-profile'],
            // Spec section 6 role 10 — receives and tracks mandatory-reporting
            // escalations and cannot be bypassed on safeguarding cases.
            'child_safety_officer' => ['handle-safeguarding-cases'],
            'district_officer' => ['review-district-complaints', 'access-protected-identity', 'handle-safeguarding-cases'],
            'state_officer' => ['review-state-complaints', 'access-protected-identity', 'view-national-analytics', 'handle-safeguarding-cases'],
            'national_admin' => ['review-state-complaints', 'access-protected-identity', 'view-audit-logs', 'view-national-analytics', 'handle-safeguarding-cases'],
            'researcher' => ['view-national-analytics'],
            // Spec section 6 role 17 — owns consent records and data-subject
            // requests under DPDP. Auditing consent is not the same as reading
            // what the consent covers, so this role gets no development-data
            // access of its own.
            'data_protection_officer' => ['manage-consent', 'view-audit-logs'],
            'system_admin' => $permissions,
        ];

        foreach ($roleMap as $role => $perms) {
            $roleModel = Role::firstOrCreate(['name' => $role]);
            $roleModel->syncPermissions($perms);
        }
    }
}
