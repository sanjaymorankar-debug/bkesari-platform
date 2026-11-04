<?php

namespace App\Mail;

use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/**
 * The six-digit code for signing in by email (App\Services\EmailSignIn).
 * Sent at once, never queued, in the locale it is given (the page's).
 */
class SignInCodeMail extends Mailable
{
    public function __construct(public string $code) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: __('Your Education sign-in code'));
    }

    public function content(): Content
    {
        return new Content(view: 'emails.sign-in-code', text: 'emails.sign-in-code-text');
    }
}
