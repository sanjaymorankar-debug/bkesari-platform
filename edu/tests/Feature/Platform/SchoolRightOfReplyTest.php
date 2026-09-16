<?php

namespace Tests\Feature\Platform;

use App\Models\FacilityClaim;
use App\Models\FacilityRating;
use App\Models\School;
use App\Models\SchoolReply;
use App\Models\User;
use App\Services\ClaimedVsExperiencedService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Livewire\Volt\Volt;
use Tests\Feature\Platform\Concerns\SetsUpPlatformData;
use Tests\TestCase;

/**
 * Spec section 29 — "Every module carrying an allegation or a
 * claimed-vs-experienced gap must present both sides."
 */
class SchoolRightOfReplyTest extends TestCase
{
    use RefreshDatabase, SetsUpPlatformData;

    private const YEAR = '2026-27';

    private function claimWithDiscrepancy(School $school, User $admin, string $key = 'swimming'): FacilityClaim
    {
        $claim = FacilityClaim::create([
            'school_id' => $school->id,
            'facility_key' => $key,
            'academic_year' => self::YEAR,
            'is_offered' => true,
            'availability' => 'all_students',
            'recorded_by_user_id' => $admin->id,
        ]);

        foreach (['A', 'B', 'C'] as $ref) {
            FacilityRating::create([
                'school_id' => $school->id,
                'facility_key' => $key,
                'academic_year' => self::YEAR,
                'anonymous_ref' => 'ANON-'.$ref,
                'rater_role' => 'parent',
                'availability_report' => 'not_available',
                'submitted_at' => now(),
            ]);
        }

        return $claim;
    }

    public function test_a_school_can_answer_a_reported_discrepancy(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);
        $this->claimWithDiscrepancy($school, $admin);

        Volt::actingAs($admin)->test('facilities.manage', ['school' => $school])
            ->set('academicYear', self::YEAR)
            ->set('replyFacilityKey', 'swimming')
            ->set('replyBody', 'The pool closed in June for resurfacing and reopens in November.')
            ->call('postReply');

        $reply = SchoolReply::first();

        $this->assertNotNull($reply);
        $this->assertSame('facility_discrepancy', $reply->context_type);
        $this->assertSame('swimming', $reply->context_key);
        $this->assertSame($admin->id, $reply->author_user_id);
    }

    /** The reply must appear beside the report, not instead of it. */
    public function test_the_public_profile_shows_both_sides(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);
        $this->claimWithDiscrepancy($school, $admin);

        SchoolReply::create([
            'school_id' => $school->id,
            'context_type' => 'facility_discrepancy',
            'context_key' => 'swimming',
            'academic_year' => self::YEAR,
            'body' => 'The pool closed in June for resurfacing and reopens in November.',
            'author_user_id' => $admin->id,
        ]);

        Volt::test('schools.show', ['school' => $school])
            ->assertOk()
            // The families' side.
            ->assertSee('Significant discrepancy reported')
            // And the school's.
            ->assertSee('Response from the school')
            ->assertSee('closed in June for resurfacing');
    }

    /** Replying must not suppress, hide or soften what families reported. */
    public function test_replying_does_not_change_the_discrepancy(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);
        $this->claimWithDiscrepancy($school, $admin);

        $before = app(ClaimedVsExperiencedService::class)
            ->compareSchool($school->id, self::YEAR)[0];

        Volt::actingAs($admin)->test('facilities.manage', ['school' => $school])
            ->set('academicYear', self::YEAR)
            ->set('replyFacilityKey', 'swimming')
            ->set('replyBody', 'The pool closed in June for resurfacing and reopens in November.')
            ->call('postReply');

        $after = app(ClaimedVsExperiencedService::class)
            ->compareSchool($school->id, self::YEAR)[0];

        $this->assertSame($before['status'], $after['status']);
        $this->assertSame($before['not_available'], $after['not_available']);
        $this->assertSame(3, FacilityRating::count(), 'A reply must never remove a report.');
    }

    /**
     * Append-only. A reply that could be edited in place could be quietly
     * rewritten after the fact — and the record protects the school as much
     * as the reader.
     */
    public function test_a_second_reply_is_added_rather_than_replacing_the_first(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);
        $this->claimWithDiscrepancy($school, $admin);

        $component = Volt::actingAs($admin)->test('facilities.manage', ['school' => $school])
            ->set('academicYear', self::YEAR);

        $component->set('replyFacilityKey', 'swimming')
            ->set('replyBody', 'The pool is closed for resurfacing until November.')
            ->call('postReply');

        $component->set('replyFacilityKey', 'swimming')
            ->set('replyBody', 'Update: the pool reopened early, on 20 October.')
            ->call('postReply');

        $this->assertSame(2, SchoolReply::count());
        $this->assertStringContainsString('resurfacing', SchoolReply::oldest()->first()->body);
    }

    public function test_a_reply_needs_enough_substance_to_be_useful(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);
        $this->claimWithDiscrepancy($school, $admin);

        Volt::actingAs($admin)->test('facilities.manage', ['school' => $school])
            ->set('academicYear', self::YEAR)
            ->set('replyFacilityKey', 'swimming')
            ->set('replyBody', 'Not true.')
            ->call('postReply')
            ->assertHasErrors('replyBody');

        $this->assertSame(0, SchoolReply::count());
    }

    public function test_another_schools_admin_cannot_reply_here(): void
    {
        $school = $this->makeSchool();
        $otherAdmin = $this->makeSchoolAdmin($this->makeSchool());

        Volt::actingAs($otherAdmin)->test('facilities.manage', ['school' => $school])
            ->assertForbidden();
    }

    public function test_a_parent_cannot_post_a_reply_as_the_school(): void
    {
        $school = $this->makeSchool();
        $parent = $this->makeVerifiedParent($school);

        Volt::actingAs($parent)->test('facilities.manage', ['school' => $school])
            ->assertForbidden();
    }

    public function test_the_school_is_told_its_reply_sits_beside_the_reports(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);
        $this->claimWithDiscrepancy($school, $admin);

        Volt::actingAs($admin)->test('facilities.manage', ['school' => $school])
            ->set('academicYear', self::YEAR)
            ->assertOk()
            ->assertSee('Respond publicly')
            ->assertSee('both sides are shown');
    }
}
