<?php

/*
|--------------------------------------------------------------------------
| Central login (bkesari.com)
|--------------------------------------------------------------------------
|
| Off unless BKESARI_SSO_INTROSPECT_URL is set. When on, App\Http\Middleware\
| BkesariSso validates the bkesari.com session cookie against the central
| auth service, requires the EDUCATION subscription, and logs the matching
| local user in. See bkesari-platform/docs/auth/DESIGN.md.
|
*/

return [
    'introspect_url' => env('BKESARI_SSO_INTROSPECT_URL'),
    'client_id' => env('BKESARI_SSO_CLIENT_ID'),
    'client_secret' => env('BKESARI_SSO_CLIENT_SECRET'),

    // The hub's origin, for the sign-in, step-up, subscribe and logout pages.
    'hub_url' => rtrim((string) env('BKESARI_SSO_URL', ''), '/'),

    // true: this app's own password login, registration and resets are off.
    'enforce' => (bool) env('BKESARI_SSO_ENFORCE', false),

    'cookies' => array_values(array_filter(array_map('trim', explode(',', (string) env('BKESARI_SSO_COOKIE', '__Host-bk_sso,bk_sso'))))),

    // Seconds an introspection answer is reused. Bounds how long a central
    // logout or revocation takes to reach this app.
    'cache_seconds' => (int) env('BKESARI_SSO_CACHE_SECONDS', 30),

    'feature' => 'EDUCATION',

    // Local roles that already require two-step sign-in here; through central
    // login they require the central session to have passed TOTP instead.
    'mfa_roles' => ['school_admin', 'district_officer', 'state_officer', 'national_admin', 'system_admin', 'child_safety_officer', 'data_protection_officer'],
];
