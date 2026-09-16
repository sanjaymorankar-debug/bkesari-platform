<?php

namespace App\Livewire\Concerns;

use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

/**
 * Shared hosting's local sendmail relay (see .env MAIL_MAILER) has no
 * delivery guarantee — every call site that uses this also keeps its
 * existing on-screen credential/link display as the reliable fallback.
 * A mail failure here must never break the registration/invite flow itself.
 */
trait SendsMailSafely
{
    protected function tryMail(string $to, \Closure $mailableFactory): void
    {
        try {
            Mail::to($to)->send($mailableFactory());
        } catch (\Throwable $e) {
            Log::warning('Mail delivery failed', ['to' => $to, 'error' => $e->getMessage()]);
        }
    }
}
