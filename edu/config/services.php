<?php

return [

    // The bkesari.com hub serves the shared Kesari design system and the app
    // shell (/kesari-ui/1.0.0/kesari.css, /kesari-ui/1.0.0/kesari.js,
    // /shared/menu.js). Behind the hub they are on this app's own origin, so
    // the default is '' (same origin). A copy of this app reached directly,
    // not through the hub, sets HUB_ASSET_ORIGIN=https://bkesari.com.
    'hub' => [
        'asset_origin' => rtrim((string) env('HUB_ASSET_ORIGIN', ''), '/'),
    ],

    // Text messages for mobile sign-in (App\Services\MobileSignIn). A POST of
    // {"to": "+91XXXXXXXXXX", "text": "..."} with `Authorization: Bearer
    // <token>` to the provider's webhook. Unset: codes are shown on screen
    // outside production, and mobile sign-in is switched off in production.
    'sms' => [
        'webhook_url' => env('SMS_WEBHOOK_URL'),
        'webhook_token' => env('SMS_WEBHOOK_TOKEN'),
    ],

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Resend, Postmark, AWS, and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

];
