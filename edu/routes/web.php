<?php

use App\Http\Controllers\ComplaintEvidenceController;
use App\Http\Controllers\DashboardController;
use Illuminate\Support\Facades\Route;
use Livewire\Volt\Volt;

Volt::route('/', 'schools.index')->name('home');
Volt::route('schools', 'schools.index')->name('schools.index');
Volt::route('schools/register', 'schools.register')->name('schools.register');
Volt::route('schools/{school}', 'schools.show')->name('schools.show');

// Spec section 31 - public on purpose: improvement should be as visible as
// criticism, and a trend view only the school could see would defeat that.
Volt::route('schools/{school}/improvement', 'improvement.show')->name('improvement.show');

// Spec section 3 - public, and deliberately reachable without an account.
Volt::route('how-india-compares', 'benchmarks.index')->name('benchmarks.index');

// Accessible to guests and authenticated users alike — an invitation link
// is often the recipient's very first visit to the site.
Volt::route('invitations/{token}', 'invitations.show')->name('invitations.show');

Route::get('dashboard', DashboardController::class)
    ->middleware(['auth', 'verified'])
    ->name('dashboard');

Route::middleware(['auth', 'verified'])->group(function () {
    Volt::route('dashboard/parent', 'dashboards.parent')->name('dashboard.parent')->middleware('role:parent');
    Volt::route('dashboard/student', 'dashboards.student')->name('dashboard.student')->middleware('role:student');
    Volt::route('dashboard/teacher', 'dashboards.teacher')->name('dashboard.teacher')->middleware('role:teacher');
    Volt::route('dashboard/school', 'dashboards.school')->name('dashboard.school')->middleware('role:school_admin');
    Volt::route('dashboard/district', 'dashboards.district')->name('dashboard.district')->middleware('role:district_officer');
    Volt::route('dashboard/state', 'dashboards.state')->name('dashboard.state')->middleware('role:state_officer');
    Volt::route('dashboard/national', 'dashboards.national')->name('dashboard.national')->middleware('role:national_admin');
    Volt::route('dashboard/researcher', 'dashboards.researcher')->name('dashboard.researcher')->middleware('role:researcher');
    Volt::route('dashboard/admin', 'dashboards.admin')->name('dashboard.admin')->middleware('role:system_admin');
    Volt::route('dashboard/placeholder', 'dashboards.placeholder')->name('dashboard.placeholder');

    Volt::route('onboarding', 'onboarding.index')->name('onboarding')->middleware('role:parent|student|teacher');

    Volt::route('complaints/create', 'complaints.create')->name('complaints.create')->middleware('role:parent|student');
    Volt::route('complaints/{complaint}', 'complaints.show')->name('complaints.show');
    Volt::route('feedback/create/{school}', 'feedback.create')->name('feedback.create')->middleware('role:parent|student');

    Volt::route('teachers/{teacher}/feedback', 'teacher-feedback.create')->name('teacher-feedback.create')->middleware('role:parent|student');

    Volt::route('retaliation/report', 'retaliation.create')->name('retaliation.create')->middleware('role:parent|student');
    Volt::route('retaliation/{retaliationReport}', 'retaliation.show')->name('retaliation.show');

    Volt::route('appeals/create/{complaint}', 'appeals.create')->name('appeals.create')->middleware('role:parent|student');
    Volt::route('appeals/{appeal}', 'appeals.show')->name('appeals.show');

    Volt::route('schools/{school}/academic-records', 'academic-records.index')->name('academic-records.index')->middleware('role:school_admin');
    Volt::route('schools/{school}/fees', 'fees.manage')->name('fees.manage')->middleware('role:school_admin|system_admin');
    Volt::route('schools/{school}/facilities', 'facilities.manage')->name('facilities.manage')->middleware('role:school_admin|system_admin');
    Volt::route('schools/{school}/exams', 'exams.manage')->name('exams.manage')->middleware('role:school_admin|system_admin');
    Volt::route('schools/{school}/courses', 'courses.manage')->name('courses.manage')->middleware('role:school_admin|system_admin');
    Volt::route('schools/{school}/facilities/rate', 'facilities.rate')->name('facilities.rate')->middleware('role:parent|student');
    Volt::route('schools/{school}/courses/rate', 'courses.rate')->name('courses.rate')->middleware('role:parent|student');

    // Spec section 25. Anyone signed in may report a safeguarding concern —
    // the duty under POCSO section 19 falls on any person, so the reporting
    // route is deliberately not restricted by role. Handling them is.
    Volt::route('schools/{school}/safeguarding/report', 'safeguarding.report')->name('safeguarding.report');
    Volt::route('safeguarding', 'safeguarding.queue')->name('safeguarding.queue')->middleware('can:handle-safeguarding-cases');
    Volt::route('safeguarding/{report}', 'safeguarding.show')->name('safeguarding.show')->middleware('can:handle-safeguarding-cases');

    // Student growth, career and life readiness (spec sections 15-17).
    // These routes carry no role middleware on purpose: who may open a given
    // child's record is decided per child by DevelopmentAccessService inside
    // each component (guardian, own school staff, or the child themself), and
    // a role check here would only give a misleading impression that holding
    // a role is what grants access.
    Volt::route('consent', 'consent.manage')->name('consent.manage')->middleware('role:parent');
    Volt::route('growth/{student}', 'growth.show')->name('growth.show');
    Volt::route('growth/{student}/observe', 'growth.observe')->name('growth.observe');
    Volt::route('growth/{student}/plan/{school}', 'growth.plan')->name('growth.plan');
    Volt::route('career/{student}', 'career.show')->name('career.show');
    Volt::route('life-skills/{student}', 'life-skills.show')->name('life-skills.show');

    // Health and wellbeing (spec sections 18-21). Like the growth routes,
    // these carry no role middleware: who may open a given child's record is
    // decided per child by HealthAccessService (guardian, the child, or
    // authorised staff at their school with consent in force), and a role
    // check here would suggest holding a role is what grants access.
    Volt::route('health/{student}', 'health.show')->name('health.show');
    Volt::route('health/{student}/record', 'health.record')->name('health.record');
    Volt::route('wellbeing/{student}/concern', 'wellbeing.concern')->name('wellbeing.concern');
    Volt::route('counselling', 'counselling.portal')->name('counselling.portal')->middleware('role:counsellor');

    // Spec sections 5 and 8 - without this queue nothing on the platform ever
    // gets verified, and an unverified state starts to read as a judgement.
    Volt::route('verification', 'verification.queue')->name('verification.queue')
        ->middleware('role:district_officer|state_officer|national_admin|system_admin');

    // Spec sections 21 and 40 - DPDP data-subject rights. The request form is
    // open to any signed-in user; who they may ask about is decided per
    // subject inside the service, not by a role.
    Volt::route('privacy/requests', 'privacy.requests')->name('privacy.requests');
    Volt::route('privacy/queue', 'privacy.queue')->name('privacy.queue')
        ->middleware('role:data_protection_officer|system_admin');

    Volt::route('notifications', 'notifications.index')->name('notifications.index');

    Route::get('complaints/{complaint}/evidence/{evidence}', ComplaintEvidenceController::class)
        ->name('complaints.evidence.download');

    Route::view('profile', 'profile')->name('profile');

    Volt::route('settings/two-factor', 'settings.two-factor')->name('settings.two-factor')
        ->middleware('role:school_admin|district_officer|state_officer|national_admin|system_admin');

    Route::middleware('role:system_admin')->prefix('admin')->name('admin.')->group(function () {
        Volt::route('rating-weights', 'admin.rating-weights')->name('rating-weights');
        Volt::route('categories', 'admin.categories')->name('categories');
        Volt::route('audit-log', 'admin.audit-log')->name('audit-log');
        Volt::route('fraud-flags', 'admin.fraud-flags')->name('fraud-flags');
        Volt::route('roles', 'admin.roles')->name('roles');
        Volt::route('moderation', 'admin.moderation')->name('moderation');
    });
});

require __DIR__.'/auth.php';
