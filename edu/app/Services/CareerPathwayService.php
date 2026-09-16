<?php

namespace App\Services;

use App\Models\CapabilityObservation;
use App\Models\CareerInterestProfile;

/**
 * Spec section 17 — exploratory career pathway suggestions.
 *
 * Three rules are load-bearing here and are enforced by the shape of this
 * class, not by convention:
 *
 * 1. **No fixed track.** Nothing is persisted. Suggestions are computed at
 *    read time from the child's most recent self-reported interests, so they
 *    change when the child changes. There is no column anywhere in the schema
 *    that stores an assigned pathway, and adding one would break the spec's
 *    core rule.
 *
 * 2. **No bias inputs.** `suggestionsFor()` accepts interest keys and domain
 *    keys and nothing else. Gender, caste, religion, and economic background
 *    are not parameters, are not read from the database here, and so cannot
 *    influence the output. The accompanying test asserts that two children
 *    with identical interests get identical suggestions regardless of profile.
 *
 * 3. **Options, not outcomes.** Every returned item is a pathway *family* to
 *    look into, paired with the interest that prompted it, so the UI can
 *    always answer "why am I seeing this?" — never a ranked prediction, never
 *    a probability, never "you should become X".
 */
class CareerPathwayService
{
    /**
     * Broad pathway families, each mapped from the child-facing interest areas
     * in CareerInterestProfile. Families are intentionally wide — "things
     * people build" rather than "civil engineer" — because narrowing a
     * 12-year-old to a job title is exactly what this module must not do.
     */
    private const PATHWAY_FAMILIES = [
        'engineering_building' => [
            'label' => 'Engineering, building and design',
            'description' => 'Fields where people design, build, test and improve physical things — from machines and buildings to products and materials.',
            'from_interests' => ['building_making', 'numbers_patterns', 'science_experiments', 'art_design'],
            'study_routes' => 'Science and mathematics streams, polytechnic and ITI routes, engineering degrees, design programmes.',
        ],
        'health_care' => [
            'label' => 'Health and care',
            'description' => 'Fields centred on people\'s health and wellbeing — medicine, nursing, therapy, public health, community care.',
            'from_interests' => ['helping_people', 'science_experiments', 'nature_environment'],
            'study_routes' => 'Biology-based streams, nursing and allied-health diplomas, medical and paramedical degrees, social work.',
        ],
        'teaching_learning' => [
            'label' => 'Teaching and working with people',
            'description' => 'Fields where the work is helping others learn, grow or resolve things — teaching, counselling, training, community work.',
            'from_interests' => ['helping_people', 'words_stories', 'organising_leading'],
            'study_routes' => 'Education degrees and B.Ed routes, psychology, languages, social sciences.',
        ],
        'computing_data' => [
            'label' => 'Computing, data and technology',
            'description' => 'Fields built around software, data, networks and digital systems.',
            'from_interests' => ['computers_technology', 'numbers_patterns', 'science_experiments'],
            'study_routes' => 'Computer science and IT streams, polytechnic diplomas, computer applications degrees, vocational certifications.',
        ],
        'creative_media' => [
            'label' => 'Creative, media and performing',
            'description' => 'Fields where the work is expression and communication — writing, visual art, film, music, dance, design, journalism.',
            'from_interests' => ['art_design', 'music_performance', 'words_stories', 'computers_technology'],
            'study_routes' => 'Arts and humanities streams, fine-art and design schools, media and mass-communication programmes, music and dance training.',
        ],
        'environment_agriculture' => [
            'label' => 'Environment, agriculture and animals',
            'description' => 'Fields concerned with land, food, climate, animals and natural resources.',
            'from_interests' => ['nature_environment', 'science_experiments', 'building_making'],
            'study_routes' => 'Agricultural sciences, environmental science, veterinary studies, forestry, food technology.',
        ],
        'business_enterprise' => [
            'label' => 'Business, enterprise and trade',
            'description' => 'Fields involving running things, trade, money and organisations — including starting something of your own.',
            'from_interests' => ['business_trade', 'organising_leading', 'numbers_patterns'],
            'study_routes' => 'Commerce streams, management and accountancy programmes, entrepreneurship and vocational trade routes.',
        ],
        'public_service_law' => [
            'label' => 'Public service, law and governance',
            'description' => 'Fields concerned with how society is organised and governed — civil services, law, policy, public administration.',
            'from_interests' => ['organising_leading', 'words_stories', 'helping_people'],
            'study_routes' => 'Humanities and commerce streams, law degrees, public administration, civil-services preparation.',
        ],
        'sport_physical' => [
            'label' => 'Sport, fitness and physical training',
            'description' => 'Fields built around movement, athletics, coaching and physical wellbeing.',
            'from_interests' => ['sport_movement', 'helping_people', 'science_experiments'],
            'study_routes' => 'Physical education degrees, sports science, coaching certifications, sports management.',
        ],
    ];

    /**
     * Compute pathway families worth exploring.
     *
     * Note the parameter list: interests and demonstrated-strength domains
     * only. This signature is the bias guard — there is no argument through
     * which a child's gender, caste, religion or family income could reach
     * this logic.
     *
     * @param  list<string>  $interestAreas  keys from CareerInterestProfile::INTEREST_AREAS
     * @param  list<string>  $strengthDomains  keys from CapabilityObservation::DOMAINS
     * @return list<array{key: string, label: string, description: string, study_routes: string, because: list<string>}>
     */
    public function suggestionsFor(array $interestAreas, array $strengthDomains = []): array
    {
        $suggestions = [];

        foreach (self::PATHWAY_FAMILIES as $key => $family) {
            $matched = array_values(array_intersect($family['from_interests'], $interestAreas));

            if ($matched === []) {
                continue;
            }

            $suggestions[] = [
                'key' => $key,
                'label' => $family['label'],
                'description' => $family['description'],
                'study_routes' => $family['study_routes'],
                // Always explain the link, so a child or parent can push back
                // on a suggestion that doesn't fit them.
                'because' => array_map(
                    fn (string $interest): string => CareerInterestProfile::INTEREST_AREAS[$interest] ?? $interest,
                    $matched
                ),
                'match_count' => count($matched),
            ];
        }

        // Ordered by how many of the child's own stated interests point at the
        // family — this is a relevance ordering of options, not a ranking of
        // how suitable the child is for them.
        usort($suggestions, fn (array $a, array $b): int => $b['match_count'] <=> $a['match_count']);

        return $suggestions;
    }

    /**
     * Convenience wrapper for a stored profile. Strength domains are read only
     * to show alongside the suggestions as context for the conversation, never
     * to filter or rank them.
     */
    public function suggestionsForProfile(CareerInterestProfile $profile): array
    {
        $strengthDomains = CapabilityObservation::query()
            ->where('student_user_id', $profile->student_user_id)
            ->where('observation_type', 'strength')
            ->visible()
            ->distinct()
            ->pluck('domain')
            ->all();

        return $this->suggestionsFor($profile->interest_areas ?? [], $strengthDomains);
    }

    /**
     * The Ministry of Labour & Employment's existing national career-guidance
     * portal. Linked as an external public resource — this platform has no
     * data integration with NCS, and must not imply one (spec section 44).
     */
    public function nationalCareerServiceUrl(): string
    {
        return 'https://www.ncs.gov.in/';
    }
}
