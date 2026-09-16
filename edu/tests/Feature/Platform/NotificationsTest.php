<?php

namespace Tests\Feature\Platform;

use App\Models\ParentSchoolRelationship;
use App\Models\User;
use App\Notifications\RelationshipApproved;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Notification;
use Livewire\Volt\Volt;
use Tests\Feature\Platform\Concerns\SetsUpPlatformData;
use Tests\TestCase;

class NotificationsTest extends TestCase
{
    use RefreshDatabase, SetsUpPlatformData;

    public function test_approving_a_parent_relationship_notifies_the_parent(): void
    {
        Notification::fake();

        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);
        $parent = User::factory()->create();
        $parent->assignRole('parent');

        $relationship = ParentSchoolRelationship::create([
            'user_id' => $parent->id,
            'school_id' => $school->id,
            'status' => 'pending',
        ]);

        Volt::actingAs($admin)->test('dashboards.school')
            ->call('approveParent', $relationship->id);

        $this->assertSame('verified', $relationship->fresh()->status);
        Notification::assertSentTo($parent, RelationshipApproved::class);
    }

    public function test_user_can_view_and_mark_notifications_as_read(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);
        $parent = User::factory()->create();
        $parent->assignRole('parent');

        $relationship = ParentSchoolRelationship::create([
            'user_id' => $parent->id,
            'school_id' => $school->id,
            'status' => 'pending',
        ]);

        Volt::actingAs($admin)->test('dashboards.school')
            ->call('approveParent', $relationship->id);

        $notification = $parent->notifications()->firstOrFail();
        $this->assertNull($notification->read_at);

        Volt::actingAs($parent)->test('notifications.index')
            ->assertOk()
            ->assertSee('approved')
            ->call('markRead', $notification->id);

        $this->assertNotNull($notification->fresh()->read_at);
    }
}
