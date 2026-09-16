<?php

namespace App\Support;

/**
 * Spec section 8's canonical facility taxonomy.
 *
 * "Canonical" is the operative word: section 12 requires claims, ratings and
 * per-year history to use the *same* list, because a school claiming
 * "Science Laboratory" while parents rate "Labs" makes claimed-vs-experienced
 * (section 11) impossible to compute. Everything that names a facility
 * validates against this class.
 *
 * It is a code constant rather than a database table on purpose — the list is
 * part of the platform's contract across modules, and a taxonomy that drifts
 * per-deployment would silently break national comparison. Adding an entry is
 * a deliberate, reviewable change; entries should be added, not renamed or
 * removed, since existing claims and ratings reference these keys.
 */
class FacilityTaxonomy
{
    /** The four groups are section 8's own headings. */
    public const GROUPS = [
        'academic' => 'Academic',
        'sports' => 'Sports',
        'student_development' => 'Student development',
        'support_services' => 'Support services',
    ];

    /** key => [group, label] */
    public const ITEMS = [
        // Academic
        'curriculum' => ['academic', 'Curriculum'],
        'science_laboratory' => ['academic', 'Science laboratory'],
        'computer_laboratory' => ['academic', 'Computer laboratory'],
        'language_laboratory' => ['academic', 'Language laboratory'],
        'library' => ['academic', 'Library'],
        'smart_classrooms' => ['academic', 'Smart classrooms'],
        'stem_programme' => ['academic', 'STEM programme'],
        'robotics' => ['academic', 'Robotics'],
        'learning_resources' => ['academic', 'Learning resources'],

        // Sports
        'cricket' => ['sports', 'Cricket'],
        'football' => ['sports', 'Football'],
        'basketball' => ['sports', 'Basketball'],
        'athletics' => ['sports', 'Athletics'],
        'swimming' => ['sports', 'Swimming'],
        'gymnasium' => ['sports', 'Gymnasium'],
        'indoor_sports' => ['sports', 'Indoor sports'],
        'outdoor_sports' => ['sports', 'Outdoor sports'],
        'sports_equipment' => ['sports', 'Sports equipment'],
        'sports_coaches' => ['sports', 'Coaches / trainers'],

        // Student development
        'arts' => ['student_development', 'Arts'],
        'music' => ['student_development', 'Music'],
        'dance' => ['student_development', 'Dance'],
        'clubs' => ['student_development', 'Clubs & societies'],
        'career_guidance' => ['student_development', 'Career guidance'],
        'counselling' => ['student_development', 'Counselling'],
        'skill_development' => ['student_development', 'Skill development'],
        'competitions' => ['student_development', 'Competitions'],

        // Support services
        'transport' => ['support_services', 'Transport'],
        'hostel' => ['support_services', 'Hostel'],
        'meals' => ['support_services', 'Meals'],
        'special_education' => ['support_services', 'Special education / learning support'],
        'medical_facilities' => ['support_services', 'Medical facilities'],
        'student_wellbeing' => ['support_services', 'Student wellbeing'],
    ];

    /** @return list<string> */
    public static function keys(): array
    {
        return array_keys(self::ITEMS);
    }

    public static function label(string $key): string
    {
        return self::ITEMS[$key][1] ?? $key;
    }

    public static function group(string $key): ?string
    {
        return self::ITEMS[$key][0] ?? null;
    }

    public static function groupLabel(string $key): string
    {
        return self::GROUPS[self::group($key) ?? ''] ?? 'Other';
    }

    public static function exists(string $key): bool
    {
        return array_key_exists($key, self::ITEMS);
    }

    /**
     * Taxonomy arranged for a form or a profile page.
     *
     * @return array<string, array<string, string>> group label => [key => label]
     */
    public static function grouped(): array
    {
        $grouped = [];

        foreach (self::ITEMS as $key => [$group, $label]) {
            $grouped[self::GROUPS[$group]][$key] = $label;
        }

        return $grouped;
    }

    /** Validation rule body for an `in:` rule. */
    public static function validationList(): string
    {
        return implode(',', self::keys());
    }
}
