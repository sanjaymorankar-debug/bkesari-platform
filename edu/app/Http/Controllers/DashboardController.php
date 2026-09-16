<?php

namespace App\Http\Controllers;

use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\Auth;

class DashboardController extends Controller
{
    public function __invoke(): RedirectResponse
    {
        $user = Auth::user();

        return match (true) {
            $user->hasRole('parent') => redirect()->route('dashboard.parent'),
            $user->hasRole('student') => redirect()->route('dashboard.student'),
            $user->hasRole('teacher') => redirect()->route('dashboard.teacher'),
            $user->hasRole('school_admin') => redirect()->route('dashboard.school'),
            // The Child Safety Officer's whole job is the safeguarding queue,
            // so that is their landing page rather than a general dashboard.
            // Checked before the officer roles so a user holding both lands on
            // the more specific one.
            $user->hasRole('child_safety_officer') => redirect()->route('safeguarding.queue'),
            // Like the Child Safety Officer, a counsellor's work is one queue
            // rather than a general dashboard.
            $user->hasRole('counsellor') => redirect()->route('counselling.portal'),
            // The DPO's work is the request queue.
            $user->hasRole('data_protection_officer') => redirect()->route('privacy.queue'),
            $user->hasRole('district_officer') => redirect()->route('dashboard.district'),
            $user->hasRole('state_officer') => redirect()->route('dashboard.state'),
            $user->hasRole('national_admin') => redirect()->route('dashboard.national'),
            $user->hasRole('researcher') => redirect()->route('dashboard.researcher'),
            $user->hasRole('system_admin') => redirect()->route('dashboard.admin'),
            default => redirect()->route('dashboard.placeholder'),
        };
    }
}
