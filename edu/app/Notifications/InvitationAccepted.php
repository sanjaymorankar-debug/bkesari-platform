<?php

namespace App\Notifications;

use App\Models\Invitation;
use App\Models\User;
use Illuminate\Notifications\Notification;

class InvitationAccepted extends Notification
{
    public function __construct(public Invitation $invitation, public User $acceptedBy) {}

    public function via(object $notifiable): array
    {
        return ['database'];
    }

    public function toArray(object $notifiable): array
    {
        return [
            'type' => 'invitation_accepted',
            'invitation_id' => $this->invitation->id,
            'school_id' => $this->invitation->school_id,
            'role' => $this->invitation->role,
            'accepted_by_name' => $this->acceptedBy->name,
            'message' => "{$this->acceptedBy->name} accepted your invitation to join as {$this->invitation->role}.",
        ];
    }
}
