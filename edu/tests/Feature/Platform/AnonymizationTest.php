<?php

namespace Tests\Feature\Platform;

use App\Models\AnonymousIdentity;
use App\Models\IdentityAccessLog;
use App\Models\User;
use App\Services\IdentityResolutionService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;
use Livewire\Volt\Volt;
use Tests\Feature\Platform\Concerns\SetsUpPlatformData;
use Tests\TestCase;

class AnonymizationTest extends TestCase
{
    use RefreshDatabase, SetsUpPlatformData;

    public function test_complaints_table_has_no_user_identifying_column(): void
    {
        $columns = Schema::getColumnListing('complaints');

        $this->assertNotContains('user_id', $columns);
        $this->assertNotContains('email', $columns);
        $this->assertNotContains('name', $columns);
        $this->assertContains('anonymous_ref', $columns);
    }

    public function test_school_feedback_table_has_no_user_identifying_column(): void
    {
        $columns = Schema::getColumnListing('school_feedback');

        $this->assertNotContains('user_id', $columns);
        $this->assertContains('anonymous_ref', $columns);
    }

    public function test_complaint_detail_view_never_renders_submitters_real_name_or_email_to_school_admin(): void
    {
        $school = $this->makeSchool();
        $category = $this->makeCategory();
        $parent = $this->makeVerifiedParent($school);
        $parent->update(['name' => 'Very Distinctive Real Name', 'email' => 'realparent@example.com']);
        $schoolAdmin = $this->makeSchoolAdmin($school);

        Volt::actingAs($parent)->test('complaints.create')
            ->set('schoolId', (string) $school->id)
            ->set('complaintCategoryId', (string) $category->id)
            ->set('subject', 'Privacy test complaint')
            ->set('description', 'This complaint description is long enough to pass validation checks.')
            ->call('submit');

        $complaint = \App\Models\Complaint::firstOrFail();

        $html = Volt::actingAs($schoolAdmin)->test('complaints.show', ['complaint' => $complaint])->html();

        $this->assertStringNotContainsString('Very Distinctive Real Name', $html);
        $this->assertStringNotContainsString('realparent@example.com', $html);
        $this->assertStringContainsString($complaint->anonymous_ref, $html);
    }

    public function test_identity_resolution_requires_permission(): void
    {
        $school = $this->makeSchool();
        $parent = $this->makeVerifiedParent($school);
        $ref = $parent->anonymousRefFor($school, 'parent');

        $schoolAdmin = $this->makeSchoolAdmin($school);
        $this->actingAs($schoolAdmin);

        $this->expectException(\Symfony\Component\HttpKernel\Exception\HttpException::class);
        app(IdentityResolutionService::class)->resolve($ref, 'test-resolve', 'test reason');
    }

    public function test_identity_resolution_requires_a_non_empty_reason(): void
    {
        $school = $this->makeSchool();
        $parent = $this->makeVerifiedParent($school);
        $ref = $parent->anonymousRefFor($school, 'parent');

        $officer = User::factory()->create();
        $officer->assignRole('district_officer');
        \App\Models\OfficerJurisdiction::create([
            'user_id' => $officer->id, 'level' => 'district', 'district_id' => $school->district_id,
        ]);
        $this->actingAs($officer);

        $this->expectException(\Illuminate\Validation\ValidationException::class);
        app(IdentityResolutionService::class)->resolve($ref, 'test-resolve', '   ');

        $this->assertSame(0, IdentityAccessLog::count());
    }

    public function test_identity_resolution_by_authorized_officer_logs_access(): void
    {
        $school = $this->makeSchool();
        $parent = $this->makeVerifiedParent($school);
        $ref = $parent->anonymousRefFor($school, 'parent');

        $officer = User::factory()->create();
        $officer->assignRole('district_officer');
        \App\Models\OfficerJurisdiction::create([
            'user_id' => $officer->id, 'level' => 'district', 'district_id' => $school->district_id,
        ]);
        $this->actingAs($officer);

        $resolved = app(IdentityResolutionService::class)->resolve($ref, 'investigation-review', 'Investigating safety complaint #123');

        $this->assertTrue($resolved->is($parent));
        $this->assertDatabaseHas('identity_access_logs', [
            'officer_user_id' => $officer->id,
            'anonymous_ref' => $ref,
            'action' => 'investigation-review',
        ]);
        $this->assertSame(1, IdentityAccessLog::count());
    }

    public function test_anonymous_ref_is_stable_across_multiple_submissions_by_same_user(): void
    {
        $school = $this->makeSchool();
        $parent = $this->makeVerifiedParent($school);

        $ref1 = $parent->anonymousRefFor($school, 'parent');
        $ref2 = $parent->anonymousRefFor($school, 'parent');

        $this->assertSame($ref1, $ref2);
        $this->assertSame(1, AnonymousIdentity::count());
    }
}
