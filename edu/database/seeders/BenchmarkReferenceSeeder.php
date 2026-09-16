<?php

namespace Database\Seeders;

use App\Models\BenchmarkReference;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

/**
 * Spec section 3 — structural practice references.
 *
 * Every row here is a description of what a system *does*, sourced and dated.
 * None carries a score, and the table has no column for one.
 *
 * IMPORTANT: every row is seeded with `source_verified = false`. These are
 * drawn from the build specification's own list of reference systems and
 * frameworks, and the public page says plainly that they are pending
 * verification. Before this platform is used publicly, someone must check each
 * citation against the actual published source and set the flag. Seeding them
 * as verified would be exactly the kind of unearned authority rule 44 forbids.
 */
class BenchmarkReferenceSeeder extends Seeder
{
    use WithoutModelEvents;

    /** [dimension, system, type, practice, relevance, source, year] */
    private const REFERENCES = [
        [
            'tracking_and_streaming', 'Finland', 'country',
            'Comprehensive schooling keeps pupils in mixed-ability groups through the basic education years, '
                .'avoiding early separation into ability streams, with support given inside the mainstream class.',
            'The platform enforces the same principle structurally: capability data can never be used to sort '
                .'children into ability groups or restrict access to subjects.',
            'OECD country education policy profiles', 2020,
        ],
        [
            'teaching_quality', 'Finland', 'country',
            'Teaching is a research-based master\'s-level profession with substantial classroom autonomy and '
                .'relatively little external standardised testing.',
            'Comparison point for this platform\'s teacher-quality measures, which are development-oriented '
                .'rather than punitive by design.',
            'OECD country education policy profiles', 2020,
        ],
        [
            'holistic_assessment', 'Singapore', 'country',
            'Holistic assessment approaches in the primary years reduce reliance on a single examination mark, '
                .'reporting a broader picture of a child\'s development alongside academic attainment.',
            'Directly comparable to NEP 2020 and PARAKH\'s Holistic Progress Card, which this platform\'s '
                .'growth module is built to feed rather than compete with.',
            'Singapore Ministry of Education, holistic assessment policy statements', 2021,
        ],
        [
            'career_readiness', 'Singapore', 'country',
            'Applied learning and education-and-career guidance are embedded across schooling rather than '
                .'concentrated into a single decision point.',
            'The platform\'s career module is exploratory and revisited over time for the same reason: '
                .'interests at 12 are not fixed at 12.',
            'Singapore Ministry of Education, applied learning programme materials', 2021,
        ],
        [
            'digital_access', 'Estonia', 'country',
            'A digital-first national curriculum and shared national digital learning infrastructure, with '
                .'digital competence treated as a cross-curricular skill rather than a separate subject.',
            'Reference point for digital access and digital-literacy tracking in the life-skills module.',
            'Estonian Education Information System and national curriculum documents', 2021,
        ],
        [
            'holistic_assessment', 'OECD Learning Compass 2030', 'framework',
            'A competency framework spanning knowledge, skills, attitudes and values, with student agency at '
                .'its centre — learners as active participants in setting their own direction rather than '
                .'recipients of instruction.',
            'The growth loop in this platform gives older students a direct role in setting their own goals, '
                .'which is what student agency means in practice.',
            'OECD Future of Education and Skills 2030 project', 2019,
        ],
        [
            'student_wellbeing', 'OECD Learning Compass 2030', 'framework',
            'Wellbeing is treated as an outcome of education in its own right, not only as a condition for '
                .'academic attainment.',
            'This platform holds wellbeing records under a stricter confidentiality tier than academic data '
                .'for the same reason — it is not merely instrumental to results.',
            'OECD Future of Education and Skills 2030 project', 2019,
        ],
        [
            'grievance_and_accountability', 'UNESCO Education 2030 / SDG 4', 'framework',
            'Accountability frameworks emphasise transparent, accessible mechanisms through which families can '
                .'raise concerns, and public reporting of how systems respond.',
            'The complaint workflow here measures resolution and lets complainants — not schools — confirm '
                .'whether something was actually resolved.',
            'UNESCO Global Education Monitoring Report, accountability edition', 2017,
        ],
        [
            'teaching_quality', 'UNESCO Education 2030 / SDG 4', 'framework',
            'Target 4.c commits to substantially increasing the supply of qualified teachers, treating teacher '
                .'supply and qualification as a measured system-level indicator.',
            'Comparison point for the platform\'s school-reported teacher counts and qualification records.',
            'UNESCO SDG 4 indicator framework', 2016,
        ],
    ];

    public function run(): void
    {
        foreach (self::REFERENCES as [$dimension, $system, $type, $practice, $relevance, $source, $year]) {
            BenchmarkReference::firstOrCreate(
                ['dimension' => $dimension, 'system_name' => $system, 'source_year' => $year],
                [
                    'system_type' => $type,
                    'practice' => $practice,
                    'relevance' => $relevance,
                    'source_name' => $source,
                    // Deliberately false. See the class doc comment.
                    'source_verified' => false,
                ]
            );
        }
    }
}
