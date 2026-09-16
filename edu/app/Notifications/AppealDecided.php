<?php

namespace App\Notifications;

use App\Models\Appeal;
use Illuminate\Notifications\Notification;

class AppealDecided extends Notification
{
    public function __construct(public Appeal $appeal) {}

    public function via(object $notifiable): array
    {
        return ['database'];
    }

    public function toArray(object $notifiable): array
    {
        return [
            'type' => 'appeal_decided',
            'appeal_id' => $this->appeal->id,
            'complaint_id' => $this->appeal->complaint_id,
            'status' => $this->appeal->status,
            'message' => "Your appeal was {$this->appeal->status}.".($this->appeal->decision_note ? ' '.$this->appeal->decision_note : ''),
        ];
    }
}
