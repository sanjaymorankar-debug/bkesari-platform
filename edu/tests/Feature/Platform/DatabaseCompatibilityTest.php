<?php

namespace Tests\Feature\Platform;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Livewire\Volt\Volt;
use Tests\Feature\Platform\Concerns\SetsUpPlatformData;
use Tests\TestCase;

/**
 * Behaviour the app inherited from MySQL's case-insensitive collation and
 * must keep on PostgreSQL (where text comparison is case-sensitive). The
 * search tests run on every driver; the email tests exercise the pgsql
 * citext column and are only meaningful there (CI runs the suite on pgsql).
 */
class DatabaseCompatibilityTest extends TestCase
{
    use RefreshDatabase;
    use SetsUpPlatformData;

    public function test_public_school_search_is_case_insensitive(): void
    {
        $school = $this->makeSchool(); // "Test Public School ...", city "Pune"

        Volt::test('schools.index')
            ->set('search', 'test public')
            ->assertSee($school->name);

        Volt::test('schools.index')
            ->set('search', 'PUNE')
            ->assertSee($school->name);
    }

    public function test_onboarding_school_search_is_case_insensitive(): void
    {
        $school = $this->makeSchool();
        $parent = User::factory()->create();
        $parent->assignRole('parent');

        Volt::actingAs($parent)->test('onboarding.index')
            ->set('search', 'TEST PUBLIC')
            ->assertSee($school->name);
    }

    public function test_login_email_is_case_insensitive_on_pgsql(): void
    {
        $this->requirePgsql();

        User::factory()->create(['email' => 'alice@example.com']);

        Volt::test('pages.auth.login')
            ->set('form.email', 'Alice@Example.COM')
            ->set('form.password', 'password')
            ->call('login')
            ->assertHasNoErrors();

        $this->assertAuthenticated();
    }

    public function test_registration_rejects_email_differing_only_in_case_on_pgsql(): void
    {
        $this->requirePgsql();

        User::factory()->create(['email' => 'bob@example.com']);

        // `unique:users,email` must see the existing row, as it did on MySQL.
        Volt::test('schools.register')
            ->set('adminEmail', 'BOB@example.com')
            ->call('register')
            ->assertHasErrors(['adminEmail' => 'unique']);
    }

    public function test_admin_user_lookup_by_email_is_case_insensitive_on_pgsql(): void
    {
        $this->requirePgsql();

        $target = User::factory()->create(['email' => 'carol@example.com']);
        $admin = User::factory()->create();
        $admin->assignRole('system_admin');

        $component = Volt::actingAs($admin)->test('admin.roles')
            ->set('userSearch', 'Carol@Example.com')
            ->call('searchUser');

        $this->assertSame($target->id, $component->get('foundUser')?->id);
    }

    private function requirePgsql(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            $this->markTestSkipped('Exercises the PostgreSQL citext email column; run the suite with DB_CONNECTION=pgsql.');
        }
    }
}
