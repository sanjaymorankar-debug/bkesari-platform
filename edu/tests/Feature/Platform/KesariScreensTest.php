<?php

namespace Tests\Feature\Platform;

use App\Models\Complaint;
use App\Models\SchoolQualityScore;
use App\Models\TeacherEffectivenessScore;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Livewire\Volt\Volt;
use Tests\Feature\Platform\Concerns\SetsUpPlatformData;
use Tests\TestCase;

/**
 * The screens redesigned on Kesari 1.1.0 (17 Nov 2026): what they promise
 * beyond looks. Education's own error pages inside the bkesari shell and in
 * the shell's language, the school search's empty state and its one action,
 * and a pager a screen reader can use.
 */
class KesariScreensTest extends TestCase
{
    use RefreshDatabase, SetsUpPlatformData;

    public function test_an_unknown_address_gets_educations_own_404_inside_the_shell(): void
    {
        $this->get('/no-such-page')
            ->assertNotFound()
            ->assertSee('data-project="education"', false)
            ->assertSee('data-bkesari-menu', false)
            ->assertSee('We can’t find that page')
            ->assertSee('href="'.route('home').'"', false)
            ->assertSee('href="'.route('schools.index').'"', false);
    }

    public function test_the_404_follows_the_shell_language_even_before_any_middleware_runs(): void
    {
        // A URL that matches no route fails before SetLocale runs; the page
        // reads the k_lang cookie itself, the same way.
        $this->withUnencryptedCookie('k_lang', 'mr')->get('/no-such-page')
            ->assertNotFound()
            ->assertSee('<html lang="mr"', false)
            ->assertSee('ते पान सापडले नाही');

        $this->withUnencryptedCookie('k_lang', '<script>')->get('/no-such-page')
            ->assertNotFound()
            ->assertSee('<html lang="en"', false);
    }

    public function test_a_school_that_does_not_exist_is_the_same_404(): void
    {
        $this->get(route('schools.show', 999999))
            ->assertNotFound()
            ->assertSee('We can’t find that page');
    }

    public function test_a_search_with_no_results_says_so_and_offers_to_start_again(): void
    {
        $school = $this->makeSchool();

        Volt::test('schools.index')
            ->assertSee($school->name)
            ->set('search', 'zz-no-school-is-called-this')
            ->assertSee('No schools match your search.')
            ->assertSee('Clear search and filters')
            ->assertDontSee($school->name)
            ->call('clearFilters')
            ->assertSet('search', '')
            ->assertSee($school->name);
    }

    public function test_a_new_state_clears_the_district_of_the_old_one(): void
    {
        $school = $this->makeSchool();

        Volt::test('schools.index')
            ->set('stateId', (string) $school->state_id)
            ->set('districtId', (string) $school->district_id)
            ->set('stateId', '')
            ->assertSet('districtId', '');
    }

    public function test_the_pager_is_buttons_with_names_and_marks_the_current_page(): void
    {
        foreach (range(1, 13) as $i) {
            $this->makeSchool();
        }

        $html = $this->get(route('schools.index'))->assertOk()->getContent();

        $this->assertStringContainsString('aria-current="page" aria-label="Page 1, current page"', $html);
        $this->assertStringContainsString('aria-label="Go to page 2"', $html);
        $this->assertStringContainsString('<button type="button" disabled aria-label="Previous page">', $html);
        // The pager Livewire ships put an aria-label on a bare <span>, which
        // has no role to carry it (axe: aria-prohibited-attr).
        $this->assertDoesNotMatchRegularExpression('/<span[^>]*aria-label=/', $html);
    }

    public function test_a_confidence_level_is_in_the_page_language(): void
    {
        // The level is a stored value (high, medium, low, insufficient_data);
        // put into a translated sentence as it is, a Marathi or Hindi page
        // read "विश्वासार्हता: high".
        $school = $this->makeSchool();
        SchoolQualityScore::create(['school_id' => $school->id, 'score' => 72.5, 'confidence' => 'high',
            'response_count' => 40, 'component_breakdown' => [], 'calculated_at' => now()->subDay()]);

        $this->withUnencryptedCookie('k_lang', 'mr')->get(route('schools.show', $school))->assertOk()
            ->assertSee('विश्वासार्हता: उच्च')
            ->assertDontSee('विश्वासार्हता: high');
        $this->withUnencryptedCookie('k_lang', 'hi')->get(route('schools.index'))->assertOk()
            ->assertSee('विश्वसनीयता: उच्च');
        $this->withUnencryptedCookie('k_lang', 'en')->get(route('schools.index'))->assertOk()->assertSee('High confidence');

        SchoolQualityScore::create(['school_id' => $school->id, 'score' => 0, 'confidence' => 'insufficient_data',
            'response_count' => 2, 'component_breakdown' => [], 'calculated_at' => now()]);
        $this->withUnencryptedCookie('k_lang', 'mr')->get(route('schools.index'))->assertOk()
            ->assertSee('विश्वासार्हता: अपुरी माहिती');

        $teacher = $this->makeVerifiedTeacher($school);
        TeacherEffectivenessScore::create(['teacher_user_id' => $teacher->id, 'score' => 61, 'confidence' => 'medium',
            'response_count' => 12, 'component_breakdown' => [], 'calculated_at' => now()]);
        $this->actingAs($teacher)->withUnencryptedCookie('k_lang', 'hi')->get(route('dashboard.teacher'))->assertOk()
            ->assertSee('विश्वसनीयता: मध्यम')
            ->assertDontSee('medium विश्वसनीयता');
    }

    public function test_the_next_step_names_a_complaints_status_in_the_page_language(): void
    {
        $school = $this->makeSchool();
        $category = $this->makeCategory();
        $parent = $this->makeVerifiedParent($school);
        $student = $this->makeVerifiedStudent($school);

        foreach ([[$parent, 'parent', 'under_review'], [$student, 'student', 'school_responded']] as [$user, $role, $status]) {
            Complaint::createNumbered($school->state, $school->district, [
                'school_id' => $school->id, 'complaint_category_id' => $category->id,
                'district_id' => $school->district_id, 'state_id' => $school->state_id,
                'anonymous_ref' => $user->anonymousRefFor($school, $role), 'submitted_role' => $role,
                'subject' => 'Broken bench', 'description' => 'The bench in class 4 is broken.',
                'severity' => 'medium', 'status' => $status,
            ]);
        }

        $this->actingAs($parent)->withUnencryptedCookie('k_lang', 'mr')->get(route('dashboard.parent'))->assertOk()
            ->assertSee('स्थिती: तपासणी सुरू.')
            ->assertDontSee('स्थिती: under review');
        $this->actingAs($parent)->withUnencryptedCookie('k_lang', 'en')->get(route('dashboard.parent'))->assertOk()
            ->assertSee('Status: Under review.');
        $this->actingAs($student)->withUnencryptedCookie('k_lang', 'hi')->get(route('dashboard.student'))->assertOk()
            ->assertSee('स्थिति: स्कूल ने जवाब दिया.')
            ->assertDontSee('स्थिति: school responded');
    }
}
