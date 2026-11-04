<?php

namespace Tests\Feature\Platform;

use App\Models\ParentSchoolRelationship;
use App\Models\TeacherSchoolRelationship;
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

    /**
     * A rejection must notify nobody — least of all with
     * `RelationshipApproved`, which would tell someone whose link was
     * refused that it was accepted.
     *
     * All six approve/reject buttons on the school dashboard now share one
     * private `decide()` method, so the only thing separating the two
     * outcomes is that method's `if ($status === 'verified')` guard. Dropping
     * the guard left the whole suite green before this test existed.
     */
    public function test_rejecting_a_relationship_notifies_nobody(): void
    {
        Notification::fake();

        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);
        $teacher = User::factory()->create();
        $teacher->assignRole('teacher');

        $relationship = TeacherSchoolRelationship::create([
            'user_id' => $teacher->id,
            'school_id' => $school->id,
            'status' => 'pending',
        ]);

        Volt::actingAs($admin)->test('dashboards.school')
            ->call('rejectTeacher', $relationship->id);

        $this->assertSame('rejected', $relationship->fresh()->status);
        Notification::assertNothingSentTo($teacher);
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
