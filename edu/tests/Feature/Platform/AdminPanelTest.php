<?php

namespace Tests\Feature\Platform;

use App\Models\ComplaintCategory;
use App\Models\FraudFlag;
use App\Models\SchoolRatingComponent;
use App\Models\Setting;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Livewire\Volt\Volt;
use Tests\Feature\Platform\Concerns\SetsUpPlatformData;
use Tests\TestCase;

class AdminPanelTest extends TestCase
{
    use RefreshDatabase, SetsUpPlatformData;

    private function makeSystemAdmin(): User
    {
        $user = User::factory()->create();
        $user->assignRole('system_admin');

        return $user;
    }

    public function test_non_admin_cannot_reach_rating_weights_page(): void
    {
        $user = User::factory()->create();
        $user->assignRole('parent');

        $this->actingAs($user)->get('/admin/rating-weights')->assertForbidden();
    }

    public function test_system_admin_can_update_school_rating_weights(): void
    {
        $admin = $this->makeSystemAdmin();
        $component = SchoolRatingComponent::create(['key' => 'safety_wellbeing', 'label' => 'Safety & Wellbeing', 'weight' => 10]);

        Volt::actingAs($admin)->test('admin.rating-weights')
            ->set("schoolWeights.{$component->id}.weight", 25.5)
            ->call('saveSchoolWeights');

        $this->assertEquals(25.5, $component->fresh()->weight);
    }

    public function test_system_admin_can_add_and_toggle_complaint_category(): void
    {
        $admin = $this->makeSystemAdmin();

        Volt::actingAs($admin)->test('admin.categories')
            ->set('newName', 'New Test Category')
            ->call('addCategory');

        $category = ComplaintCategory::where('name', 'New Test Category')->firstOrFail();
        $this->assertTrue($category->is_active);

        Volt::actingAs($admin)->test('admin.categories')
            ->call('toggleActive', $category->id);

        $this->assertFalse($category->fresh()->is_active);
    }

    public function test_admin_actions_are_audit_logged(): void
    {
        $admin = $this->makeSystemAdmin();

        Volt::actingAs($admin)->test('admin.categories')
            ->set('newName', 'Audited Category')
            ->call('addCategory');

        $this->assertDatabaseHas('audit_logs', [
            'user_id' => $admin->id,
            'action' => 'complaint-category-created',
        ]);
    }

    public function test_system_admin_can_review_a_fraud_flag(): void
    {
        $admin = $this->makeSystemAdmin();
        $school = $this->makeSchool();
        $flag = FraudFlag::create([
            'flag_type' => 'feedback_spike',
            'subject_type' => 'school',
            'subject_id' => $school->id,
            'details' => ['window_minutes' => 10, 'threshold' => 5],
            'status' => 'open',
        ]);

        Volt::actingAs($admin)->test('admin.fraud-flags')
            ->assertOk()
            ->call('setStatus', $flag->id, 'dismissed');

        $flag->refresh();
        $this->assertSame('dismissed', $flag->status);
        $this->assertSame($admin->id, $flag->reviewed_by_user_id);
        $this->assertNotNull($flag->reviewed_at);
    }

    public function test_system_admin_can_update_moderation_thresholds(): void
    {
        $admin = $this->makeSystemAdmin();

        Volt::actingAs($admin)->test('admin.moderation')
            ->assertOk()
            ->set('windowMinutes', 15)
            ->set('threshold', 8)
            ->call('save');

        $this->assertEquals(15, Setting::get('fraud.window_minutes'));
        $this->assertEquals(8, Setting::get('fraud.threshold'));
    }

    public function test_system_admin_can_toggle_a_role_permission(): void
    {
        $admin = $this->makeSystemAdmin();

        Volt::actingAs($admin)->test('admin.roles')
            ->assertOk()
            ->call('togglePermission', 'researcher', 'view-audit-logs');

        $this->assertTrue(\Spatie\Permission\Models\Role::findByName('researcher')->hasPermissionTo('view-audit-logs'));
    }

    public function test_system_admin_can_assign_and_remove_a_users_role(): void
    {
        $admin = $this->makeSystemAdmin();
        $user = User::factory()->create(['email' => 'target-user@example.com']);
        $user->assignRole('parent');

        $component = Volt::actingAs($admin)->test('admin.roles')
            ->set('userSearch', 'target-user@example.com')
            ->call('searchUser')
            ->set('roleToAssign', 'researcher')
            ->call('assignRole');

        $this->assertTrue($user->fresh()->hasRole('researcher'));

        $component->call('removeRole', 'researcher');
        $this->assertFalse($user->fresh()->hasRole('researcher'));
    }
}
