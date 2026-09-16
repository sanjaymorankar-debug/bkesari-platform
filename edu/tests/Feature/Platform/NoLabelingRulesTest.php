<?php

namespace Tests\Feature\Platform;

use App\Models\CapabilityObservation;
use App\Models\CareerInterestProfile;
use App\Models\GrowthGoal;
use App\Models\GrowthPlan;
use App\Models\School;
use App\Models\StudentProfile;
use App\Models\User;
use App\Services\CareerPathwayService;
use App\Services\ConsentService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;
use Livewire\Volt\Volt;
use Tests\Feature\Platform\Concerns\SetsUpPlatformData;
use Tests\TestCase;

/**
 * Spec sections 15, 17, 28 and 44 — the rules that stop this module becoming
 * the thing it was built to replace: a number that follows a child around.
 */
class NoLabelingRulesTest extends TestCase
{
    use RefreshDatabase, SetsUpPlatformData;

    /**
     * Structural guard. The spec forbids reducing a child to a score, and the
     * schema is where that has to be enforced — if someone later adds a
     * `score` or `level` column to these tables, this fails loudly and they
     * have to come and read the rule before proceeding.
     */
    public function test_development_tables_carry_no_score_or_rating_column(): void
    {
        $forbidden = ['score', 'rating', 'grade', 'level', 'band', 'percentile', 'rank', 'iq'];

        foreach (['capability_observations', 'career_interest_profiles', 'life_skills_tracking'] as $table) {
            foreach (Schema::getColumnListing($table) as $column) {
                $this->assertNotContains(
                    $column,
                    $forbidden,
                    "Table {$table} has a '{$column}' column. Spec section 15 forbids reducing a child's ".
                    'development record to a score or fixed label.'
                );
            }
        }
    }

    /** No table anywhere may store an assigned career track (spec section 28). */
    public function test_no_table_stores_an_assigned_career_track(): void
    {
        foreach (Schema::getColumnListing('career_interest_profiles') as $column) {
            $this->assertStringNotContainsString('assigned', $column);
            $this->assertStringNotContainsString('recommended_career', $column);
            $this->assertStringNotContainsString('track', $column);
        }
    }

    /**
     * The bias rule from sections 15 and 44. Two children who state identical
     * interests must be shown identical options, whatever else differs about
     * them — this is asserted end to end, not just by reading the signature.
     */
    public function test_career_suggestions_are_identical_regardless_of_gender(): void
    {
        $school = $this->makeSchool();

        $girl = $this->makeVerifiedStudent($school);
        StudentProfile::create(['user_id' => $girl->id, 'gender' => 'female', 'date_of_birth' => '2012-05-01']);

        $boy = $this->makeVerifiedStudent($school);
        StudentProfile::create(['user_id' => $boy->id, 'gender' => 'male', 'date_of_birth' => '2012-05-01']);

        $interests = ['numbers_patterns', 'computers_technology', 'building_making'];

        $service = app(CareerPathwayService::class);

        foreach ([$girl, $boy] as $child) {
            CareerInterestProfile::create([
                'student_user_id' => $child->id,
                'captured_by_user_id' => $child->id,
                'academic_term' => '2026-27 Term 1',
                'interest_areas' => $interests,
                'captured_on' => now()->toDateString(),
            ]);
        }

        $girlSuggestions = $service->suggestionsForProfile(
            CareerInterestProfile::where('student_user_id', $girl->id)->first()
        );
        $boySuggestions = $service->suggestionsForProfile(
            CareerInterestProfile::where('student_user_id', $boy->id)->first()
        );

        $this->assertSame(
            array_column($girlSuggestions, 'key'),
            array_column($boySuggestions, 'key'),
            'Career suggestions differed by gender. Spec sections 15 and 44 forbid this.'
        );

        // And STEM is actually present for the girl — a regression guard
        // against the specific stereotype the spec calls out by name.
        $this->assertContains('computing_data', array_column($girlSuggestions, 'key'));
        $this->assertContains('engineering_building', array_column($girlSuggestions, 'key'));
    }

    public function test_career_suggestions_always_explain_why_they_were_shown(): void
    {
        $suggestions = app(CareerPathwayService::class)->suggestionsFor(['helping_people']);

        $this->assertNotEmpty($suggestions);

        foreach ($suggestions as $suggestion) {
            $this->assertNotEmpty(
                $suggestion['because'],
                'Every suggestion must name the interest that produced it, so a child can push back on it.'
            );
        }
    }

    public function test_a_child_with_no_stated_interests_is_given_no_suggestions(): void
    {
        // Never guess on a child's behalf.
        $this->assertSame([], app(CareerPathwayService::class)->suggestionsFor([]));
    }

    public function test_a_growth_goal_cannot_be_saved_without_both_school_and_home_support(): void
    {
        ['student' => $student, 'school' => $school, 'teacher' => $teacher] = $this->consentedSetup();

        Volt::actingAs($teacher)->test('growth.plan', ['student' => $student, 'school' => $school])
            ->call('createPlan')
            ->set('goalDomain', 'cognitive_scholastic')
            ->set('goalStatement', 'Build confidence reading aloud in class.')
            ->set('supportAtSchool', 'Short daily reading turns with the teacher.')
            ->set('supportAtHome', '')
            ->call('addGoal')
            ->assertHasErrors('supportAtHome');

        $this->assertSame(0, GrowthGoal::count());
    }

    public function test_a_term_carries_at_most_three_goals(): void
    {
        ['student' => $student, 'school' => $school, 'teacher' => $teacher] = $this->consentedSetup();

        $component = Volt::actingAs($teacher)
            ->test('growth.plan', ['student' => $student, 'school' => $school])
            ->call('createPlan');

        for ($i = 1; $i <= 4; $i++) {
            $component->set('goalDomain', 'socio_emotional')
                ->set('goalStatement', "Goal number {$i} for this term.")
                ->set('supportAtSchool', 'A specific thing the teacher will do.')
                ->set('supportAtHome', 'A specific thing the family will do.')
                ->call('addGoal');
        }

        $this->assertSame(GrowthPlan::MAX_GOALS, GrowthGoal::count());
    }

    public function test_a_draft_plan_is_not_visible_to_the_guardian_until_shared(): void
    {
        ['student' => $student, 'school' => $school, 'teacher' => $teacher, 'guardian' => $guardian] = $this->consentedSetup();

        Volt::actingAs($teacher)->test('growth.plan', ['student' => $student, 'school' => $school])
            ->call('createPlan');

        $plan = GrowthPlan::first();
        $this->assertNull($plan->shared_with_parent_at);
        $this->assertFalse($guardian->can('view', $plan));

        Volt::actingAs($teacher)->test('growth.plan', ['student' => $student, 'school' => $school])
            ->set('goalDomain', 'socio_emotional')
            ->set('goalStatement', 'Take more turns in group discussion.')
            ->set('supportAtSchool', 'Pair with a partner for the first five minutes.')
            ->set('supportAtHome', 'Ask about one thing discussed in class each day.')
            ->call('addGoal')
            ->call('shareWithParent');

        $this->assertTrue($guardian->fresh()->can('view', $plan->fresh()));
    }

    public function test_a_guardian_can_add_their_own_observation_from_home(): void
    {
        ['student' => $student, 'guardian' => $guardian] = $this->consentedSetup();

        Volt::actingAs($guardian)->test('growth.observe', ['student' => $student])
            ->set('domain', 'creative_co_scholastic')
            ->set('strand', 'drawing')
            ->set('observationType', 'strength')
            ->set('observation', 'Spent the whole weekend illustrating a story she wrote herself.')
            ->call('save');

        $observation = CapabilityObservation::first();
        $this->assertNotNull($observation, 'The loop must be two-way — guardians contribute observations too.');
        $this->assertSame('parent', $observation->observer_role);
    }

    public function test_observations_are_dated_and_attributed_so_they_read_as_moments(): void
    {
        ['student' => $student, 'guardian' => $guardian] = $this->consentedSetup();

        Volt::actingAs($guardian)->test('growth.observe', ['student' => $student])
            ->set('domain', 'physical_development')
            ->set('strand', 'stamina')
            ->set('observationType', 'growth_area')
            ->set('observation', 'Found the longer walk on the school trip tiring.')
            ->call('save');

        $observation = CapabilityObservation::first();

        $this->assertNotNull($observation->observed_on);
        $this->assertNotEmpty($observation->academic_term);
        $this->assertNotNull($observation->observer_user_id);
        $this->assertContains($observation->observation_type, ['strength', 'growth_area']);
    }

    /** @return array{school: School, student: User, teacher: User, guardian: User} */
    private function consentedSetup(): array
    {
        $school = $this->makeSchool();
        $student = $this->makeVerifiedStudent($school);
        $guardian = $this->makeGuardianOf($school, $student);
        $teacher = $this->makeVerifiedTeacher($school);

        app(ConsentService::class)->grant($guardian, $student->id, 'capability_growth');

        return compact('school', 'student', 'teacher', 'guardian');
    }
}
