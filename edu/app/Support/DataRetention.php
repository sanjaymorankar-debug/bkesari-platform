<?php

namespace App\Support;

/**
 * Spec sections 21 and 40 — retention periods per data category, and which
 * categories a data-subject erasure request can actually reach.
 *
 * Two things are deliberately explicit here rather than left to judgement at
 * request time:
 *
 * **What cannot be erased, and why.** DPDP gives a data principal a right to
 * erasure, but not an unlimited one: a platform still has legitimate
 * record-keeping obligations, and some of them exist to protect the very
 * person asking. A safeguarding record is the clearest case — a school or an
 * accused adult must never be able to clear a child protection case by asking
 * the child's guardian to request erasure. Consent records are another: the
 * record that consent was once given is what makes past collection auditable,
 * and deleting it would leave the platform unable to show it acted lawfully.
 *
 * When something cannot be erased, the platform must say so plainly and give
 * the reason, rather than quietly not doing it.
 *
 * **Retention periods are a starting position, not legal advice.** They are
 * held here so they can be reviewed in one place, and every one of them should
 * be checked against the deployment state's own record-keeping rules before
 * this goes live.
 */
class DataRetention
{
    /**
     * category => [
     *   label, retention_years (null = kept while the relationship lasts),
     *   erasable (can a data-subject request remove it?),
     *   basis (why it is kept / why it cannot be erased)
     * ]
     */
    public const CATEGORIES = [
        'capability_growth' => [
            'label' => 'Growth and capability observations',
            'retention_years' => 3,
            'erasable' => true,
            'basis' => 'Kept while they are useful to the child\'s current teachers, then no longer.',
        ],
        'career_pathway' => [
            'label' => 'Career interests',
            'retention_years' => 3,
            'erasable' => true,
            'basis' => 'Interests are meant to change; old entries stop being informative.',
        ],
        'life_skills' => [
            'label' => 'Life-skills participation',
            'retention_years' => 3,
            'erasable' => true,
            'basis' => 'Participation records, no lasting purpose beyond the school years.',
        ],
        'physical_health' => [
            'label' => 'Physical health screenings',
            'retention_years' => 7,
            'erasable' => true,
            'basis' => 'Longitudinal value while the child is growing; erasable on request once the '
                .'relationship with the school has ended.',
        ],
        'mental_wellbeing' => [
            'label' => 'Wellbeing and counselling records',
            'retention_years' => 7,
            'erasable' => true,
            'basis' => 'Held under the stricter confidentiality tier; erasable on request, though a '
                .'counsellor may hold their own professional obligations separately.',
        ],
        'feedback' => [
            'label' => 'Ratings and feedback you submitted',
            'retention_years' => null,
            'erasable' => false,
            'basis' => 'Already anonymous — the platform stores no link from this feedback back to you '
                .'that could be used to find and remove it, which is the same design that protects you '
                .'from being identified.',
        ],
        'complaints' => [
            'label' => 'Complaints and their resolution',
            'retention_years' => 7,
            'erasable' => false,
            'basis' => 'Part of an accountability record that a school, an officer and an appeal may all '
                .'rely on. Anonymous already, and removable only through the complaint workflow itself.',
        ],
        'safeguarding' => [
            'label' => 'Safeguarding cases',
            'retention_years' => null,
            'erasable' => false,
            'basis' => 'Never erasable on request. A child protection record must not be removable by '
                .'anyone, because the ability to remove it is exactly what would be abused.',
        ],
        'consent_records' => [
            'label' => 'Consent records',
            'retention_years' => null,
            'erasable' => false,
            'basis' => 'The record that consent was given or withdrawn is what makes past collection '
                .'auditable. Withdrawing consent stops collection; it does not delete the evidence that '
                .'the platform acted lawfully.',
        ],
        'audit_logs' => [
            'label' => 'Audit and access logs',
            'retention_years' => 7,
            'erasable' => false,
            'basis' => 'A log that can be erased on request is not an audit log. These record who looked '
                .'at what, which is a protection for the data subject as much as an obligation.',
        ],
    ];

    /** @return list<string> */
    public static function erasableCategories(): array
    {
        return array_keys(array_filter(
            self::CATEGORIES,
            fn (array $meta): bool => $meta['erasable']
        ));
    }

    /** @return list<string> */
    public static function protectedCategories(): array
    {
        return array_keys(array_filter(
            self::CATEGORIES,
            fn (array $meta): bool => ! $meta['erasable']
        ));
    }

    public static function isErasable(string $category): bool
    {
        return self::CATEGORIES[$category]['erasable'] ?? false;
    }

    public static function label(string $category): string
    {
        return self::CATEGORIES[$category]['label'] ?? $category;
    }

    public static function basis(string $category): string
    {
        return self::CATEGORIES[$category]['basis'] ?? '';
    }

    /** Human-readable retention period. */
    public static function retentionLabel(string $category): string
    {
        $years = self::CATEGORIES[$category]['retention_years'] ?? null;

        return $years === null
            ? 'Kept as a permanent record'
            : $years.' '.($years === 1 ? 'year' : 'years');
    }
}
