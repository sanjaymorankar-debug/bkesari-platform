<?php

namespace App\Notifications;

use App\Models\Complaint;
use Illuminate\Notifications\Notification;

class ComplaintStatusChanged extends Notification
{
    public function __construct(public Complaint $complaint, public string $message) {}

    public function via(object $notifiable): array
    {
        return ['database'];
    }

    public function toArray(object $notifiable): array
    {
        return [
            'type' => 'complaint_status_changed',
            'complaint_id' => $this->complaint->id,
            'complaint_number' => $this->complaint->complaint_number,
            'status' => $this->complaint->status,
            'message' => $this->message,
        ];
    }
}
