<?php

namespace Tests\Feature\Platform;

use App\Models\Course;
use App\Models\FacilityClaim;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Livewire\Volt\Volt;
use Tests\Feature\Platform\Concerns\SetsUpPlatformData;
use Tests\TestCase;

/**
 * Spec section 33 — WCAG 2.1 AA as the technical baseline for the RPWD Act
 * 2016 obligations.
 *
 * These are regression guards for specific criteria that were failing, not a
 * substitute for an accessibility audit with real assistive technology. See
 * ROADMAP.md — an automated test cannot tell you whether a screen reader
 * actually makes sense of a page.
 */
class AccessibilityTest extends TestCase
{
    use RefreshDatabase, SetsUpPlatformData;

    /**
     * WCAG 2.4.1 Bypass Blocks. Without this a keyboard user tabs through the
     * entire navigation on every page before reaching content.
     */
    public function test_every_page_offers_a_skip_to_content_link(): void
    {
        $response = $this->get(route('schools.index'));

        $response->assertOk()
            ->assertSee('Skip to main content')
            ->assertSee('href="#main-content"', false);
    }

    public function test_the_main_landmark_is_the_skip_link_target(): void
    {
        $this->get(route('schools.index'))
            ->assertOk()
            ->assertSee('id="main-content"', false);
    }

    /**
     * WCAG 2.4.2 Page Titled. Every page previously carried the same title,
     * which makes browser history and tab lists useless.
     */
    public function test_pages_can_set_their_own_title(): void
    {
        $this->get(route('benchmarks.index'))
            ->assertOk()
            // The layout composes "<page> — <app name>" when a title is set,
            // and falls back to the app name when one isn't.
            ->assertSee('<title>', false);
    }

    /** WCAG 3.1.1 Language of Page. */
    public function test_the_document_declares_its_language(): void
    {
        $this->get(route('schools.index'))
            ->assertOk()
            ->assertSee('<html lang="', false);
    }

    /**
     * WCAG 4.1.3 Status Messages. A confirmation that only exists visually
     * leaves a screen reader user unsure whether their submission worked.
     */
    public function test_confirmation_messages_are_announced_to_screen_readers(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);

        Volt::actingAs($admin)->test('courses.manage', ['school' => $school])
            ->set('academicYear', '2026-27')
            ->set('name', 'Physics')
            ->call('addCourse')
            ->assertSee('role="status"', false)
            ->assertSee('aria-live="polite"', false)
            ->assertSee('Course added.');
    }

    /**
     * WCAG 1.3.1 / 3.3.2 / 4.1.2. The rating scale is a visually hidden radio
     * with a styled span. Without a group label and per-option names, a screen
     * reader announces "1, radio button" with no idea what is being rated.
     */
    public function test_rating_scales_name_what_is_being_rated(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);
        $student = $this->makeVerifiedStudent($school);

        Course::create([
            'school_id' => $school->id,
            'academic_year' => '2026-27',
            'name' => 'Physics',
            'recorded_by_user_id' => $admin->id,
        ]);

        Volt::actingAs($student)->test('courses.rate', ['school' => $school])
            ->assertOk()
            ->assertSee('<fieldset', false)
            ->assertSee('<legend', false)
            // Each option carries a name that stands alone.
            ->assertSee('aria-label="Teaching quality: 3 out of 5"', false);
    }

    /** WCAG 2.4.7 Focus Visible — a visually hidden input still needs a focus state. */
    public function test_rating_options_show_a_visible_focus_state(): void
    {
        $school = $this->makeSchool();
        $admin = $this->makeSchoolAdmin($school);
        $parent = $this->makeVerifiedParent($school);

        FacilityClaim::create([
            'school_id' => $school->id,
            'facility_key' => 'library',
            'academic_year' => '2026-27',
            'is_offered' => true,
            'availability' => 'all_students',
            'recorded_by_user_id' => $admin->id,
        ]);

        Volt::actingAs($parent)->test('facilities.rate', ['school' => $school])
            ->assertOk()
            ->assertSee('peer-focus-visible:ring-2', false);
    }

    /**
     * The rating scale is used by both the course and facility forms. If the
     * shared component regresses, both regress — which is the point of having
     * one.
     */
    public function test_both_rating_forms_use_the_shared_accessible_component(): void
    {
        foreach (['courses/rate', 'facilities/rate'] as $view) {
            $source = file_get_contents(resource_path("views/livewire/{$view}.blade.php"));

            $this->assertStringContainsString(
                '<x-rating-scale',
                $source,
                "{$view} must use the shared accessible rating component."
            );

            $this->assertStringNotContainsString(
                'sr-only peer',
                $source,
                "{$view} must not hand-roll the radio pattern — it fails WCAG without the component's fixes."
            );
        }
    }
}
