<?php

namespace App\Mail;

use App\Models\Invitation;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class SchoolInvitationMail extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(public Invitation $invitation, public string $link) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: "You're invited to join {$this->invitation->school->name}");
    }

    public function content(): Content
    {
        return new Content(view: 'emails.school-invitation');
    }
}
