<?php

namespace Database\Seeders;

use App\Models\CapabilityObservation;
use App\Models\CareerInterestProfile;
use App\Models\GrowthGoal;
use App\Models\GrowthPlan;
use App\Models\LifeSkillRecord;
use App\Models\ParentSchoolRelationship;
use App\Models\User;
use App\Services\ConsentService;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

/**
 * Demo data for the growth, career and life-skills modules (spec 15-17),
 * built around the demo parent/student/teacher accounts.
 *
 * The observations below are written the way the module intends them to be
 * written — a specific thing, on a specific day, in a specific activity —
 * so the seeded data models good practice rather than just filling the screen.
 */
class StudentGrowthSeeder extends Seeder
{
    use WithoutModelEvents;

    public function run(): void
    {
        $parent = User::where('email', 'parent@test.agtci.com')->first();
        $student = User::where('email', 'student@test.agtci.com')->first();
        $teacher = User::where('email', 'teacher@test.agtci.com')->first();

        if (! $parent || ! $student || ! $teacher) {
            return;
        }

        $relationship = ParentSchoolRelationship::where('user_id', $parent->id)
            ->where('student_user_id', $student->id)
            ->where('status', 'verified')
            ->first();

        if (! $relationship) {
            return;
        }

        $schoolId = $relationship->school_id;
        $term = '2026-27 Term 1';

        // Consent first — nothing below could legitimately exist without it.
        $consent = app(ConsentService::class);
        foreach (['capability_growth', 'career_pathway', 'life_skills'] as $purpose) {
            $consent->grant($parent, $student->id, $purpose);
        }

        $observations = [
            ['teacher', $teacher->id, 'cognitive_scholastic', 'problem solving', 'strength',
                'Kept working through a hard set of fraction problems after two wrong attempts, and asked for a hint rather than giving up.',
                'During the Thursday maths practice session'],
            ['teacher', $teacher->id, 'socio_emotional', 'collaboration', 'strength',
                'Noticed a classmate had been left out of a group and invited them in without being prompted.',
                'Group science project, week 3'],
            ['teacher', $teacher->id, 'cognitive_scholastic', 'reading aloud', 'growth_area',
                'Spoke very quietly when reading to the class and stopped a few times. Seemed more comfortable reading to a partner.',
                'Class reading circle'],
            ['parent', $parent->id, 'creative_co_scholastic', 'drawing and storytelling', 'strength',
                'Spent most of the weekend illustrating a story she wrote herself, and explained the whole plot to us at dinner.',
                'At home'],
            ['parent', $parent->id, 'physical_development', 'stamina', 'growth_area',
                'Found the longer walk on the school trip tiring and needed a few rests.',
                'School trip to the fort'],
            ['self', $student->id, 'life_skills', 'organising my time', 'growth_area',
                'I keep leaving my homework until the last evening and then it feels rushed.',
                null],
        ];

        foreach ($observations as [$role, $observerId, $domain, $strand, $type, $text, $context]) {
            CapabilityObservation::create([
                'student_user_id' => $student->id,
                'school_id' => $schoolId,
                'observer_user_id' => $observerId,
                'observer_role' => $role,
                'domain' => $domain,
                'strand' => $strand,
                'observation_type' => $type,
                'observation' => $text,
                'evidence_context' => $context,
                'academic_term' => $term,
                'observed_on' => now()->subDays(random_int(3, 40))->toDateString(),
                'moderation_status' => 'approved',
            ]);
        }

        $plan = GrowthPlan::create([
            'student_user_id' => $student->id,
            'school_id' => $schoolId,
            'created_by_user_id' => $teacher->id,
            'academic_term' => $term,
            'status' => 'active',
            'summary_for_parent' => 'She is doing well with problem solving and is thoughtful with classmates. '
                .'This term we want to build her confidence speaking in front of the class, and help her get '
                .'on top of homework a bit earlier in the week.',
            'shared_with_parent_at' => now()->subDays(10),
        ]);

        $goals = [
            ['cognitive_scholastic',
                'Read aloud to the class with more confidence.',
                'Start with reading to a partner, then a small group, before the full class. Two short turns a week.',
                'Let her read a page aloud at home a few evenings a week — to a sibling or even the dog, anything that is low pressure.',
                null],
            ['life_skills',
                'Start homework earlier in the week so it is not rushed.',
                'Write the week\'s homework on the board every Monday and give ten minutes to plan it.',
                'Agree a regular time on Tuesday and Wednesday evenings, and check in rather than remind repeatedly.',
                'I want to try doing the hard one first instead of last.'],
        ];

        foreach ($goals as [$domain, $statement, $school, $home, $voice]) {
            GrowthGoal::create([
                'growth_plan_id' => $plan->id,
                'domain' => $domain,
                'goal_statement' => $statement,
                'support_at_school' => $school,
                'support_at_home' => $home,
                'student_voice' => $voice,
                'status' => 'in_progress',
            ]);
        }

        CareerInterestProfile::create([
            'student_user_id' => $student->id,
            'captured_by_user_id' => $student->id,
            'academic_term' => $term,
            'interest_areas' => ['art_design', 'words_stories', 'nature_environment'],
            'enjoyed_activities' => ['drawing', 'writing stories', 'looking after the class plants'],
            'reflection' => 'I like making things up and drawing them.',
            'captured_on' => now()->subMonths(8)->toDateString(),
        ]);

        // A second, later capture — the whole point of this module is that the
        // picture moves, so the demo data has to actually move.
        CareerInterestProfile::create([
            'student_user_id' => $student->id,
            'captured_by_user_id' => $student->id,
            'academic_term' => $term,
            'interest_areas' => ['art_design', 'computers_technology', 'numbers_patterns', 'words_stories'],
            'enjoyed_activities' => ['digital drawing', 'the coding club', 'writing stories'],
            'reflection' => 'I started the coding club this year and I like making the drawings move.',
            'captured_on' => now()->subDays(20)->toDateString(),
        ]);

        $lifeSkills = [
            ['digital_literacy_safety', 'Online safety workshop', 'Session on privacy settings and what not to share.', 'engaged'],
            ['financial_literacy', 'Class budgeting exercise', 'Planned a budget for a pretend school event.', 'led'],
            ['environmental_awareness', 'School garden project', 'Ongoing care of the class vegetable patch.', 'participated'],
        ];

        foreach ($lifeSkills as [$area, $title, $description, $level]) {
            LifeSkillRecord::create([
                'student_user_id' => $student->id,
                'school_id' => $schoolId,
                'recorded_by_user_id' => $teacher->id,
                'skill_area' => $area,
                'activity_title' => $title,
                'activity_description' => $description,
                'participation_level' => $level,
                'academic_term' => $term,
                'recorded_on' => now()->subDays(random_int(5, 60))->toDateString(),
            ]);
        }
    }
}
