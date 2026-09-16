<?php

namespace App\Notifications;

use App\Models\School;
use Illuminate\Notifications\Notification;

class RelationshipApproved extends Notification
{
    public function __construct(public School $school, public string $relationshipType) {}

    public function via(object $notifiable): array
    {
        return ['database'];
    }

    public function toArray(object $notifiable): array
    {
        return [
            'type' => 'relationship_approved',
            'school_id' => $this->school->id,
            'school_name' => $this->school->name,
            'relationship_type' => $this->relationshipType,
            'message' => "Your {$this->relationshipType} link to {$this->school->name} has been approved.",
        ];
    }
}
