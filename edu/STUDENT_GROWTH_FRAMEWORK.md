# Student Growth, Career & Life-Readiness — engineering rules

This document covers the modules in spec sections 15–17 (capability & growth mapping, the
teacher–parent–student growth loop, career and life-skills), and the DPDP consent layer in
section 40 that gates all of them.

It exists because these modules are the ones where a plausible-looking feature request can quietly
break the thing the module was built to prevent. **If you are adding to these modules, read the
"Rules that must not be broken" section before you write code.** Every rule below has a test
enforcing it; the test name is given so you can find out what you broke.

---

## What these modules are

A dated, multi-source record of specific things a child did, held jointly by their teachers and
their family, plus a shared plan for what everyone will do next.

They are built on **NEP 2020 / PARAKH's Holistic Progress Card model** rather than a framework
invented here: the five domains in `CapabilityObservation::DOMAINS` map to NEP's holistic
development framing, and the 360-degree observer model (teacher / parent / self / peer) is the
HPC's. The intent is that this feeds *into* the national framework rather than competing with it —
the same posture the platform takes toward UDISE.

## What they are explicitly not

Not a report card, not a rating, not a psychometric assessment, not a diagnosis, not a streaming
mechanism, and not a career aptitude test. The world's better-performing school systems (Finland,
Estonia) largely avoid early fixed tracking because it entrenches gaps rather than closing them;
this platform enforces that structurally rather than by policy statement.

---

## Rules that must not be broken

### 1. No score, rating, level, band or percentile — ever

There is no numeric column on `capability_observations`, `career_interest_profiles`, or
`life_skills_tracking`, and there must never be one. A child is not a number, and the fastest way
for this module to become the thing it replaced is for someone to add an "overall level" column
because a dashboard wanted one.

If you need to show progress, show the dated observations and the goal statuses. Do not aggregate
them into a figure.

> Enforced by `NoLabelingRulesTest::test_development_tables_carry_no_score_or_rating_column`, which
> fails on any column named score/rating/grade/level/band/percentile/rank/iq.

### 2. No assigned career track

`CareerPathwayService` computes suggestions **at read time and persists nothing**. There is no
`assigned_pathway` column and there must never be one. Suggestions are pathway *families* ("health
and care"), never job titles, never ranked by suitability, and every one carries a `because` field
naming the child's own stated interest that produced it — so a child can look at a suggestion and
say "that's not me", which they must always be able to do.

> Enforced by `NoLabelingRulesTest::test_no_table_stores_an_assigned_career_track` and
> `test_career_suggestions_always_explain_why_they_were_shown`.

### 3. No bias inputs in pathway logic

`CareerPathwayService::suggestionsFor()` takes interest keys and domain keys. That signature is the
bias guard: gender, caste, religion and economic background are not parameters, are not read from
the database inside the service, and therefore cannot influence output. **Do not add a parameter or
a database read that would let them.**

> Enforced by `NoLabelingRulesTest::test_career_suggestions_are_identical_regardless_of_gender`,
> which also asserts specifically that a girl stating STEM interests is shown STEM pathways — the
> exact stereotype the spec names.

### 4. Nothing without consent, per purpose

`ConsentService` is the only gate, and it is checked **per purpose**, not globally: a guardian who
agreed to growth observations has not agreed to career profiling. Consent is re-checked at write
time as well as on page load, because a guardian can withdraw while a form is open.

Withdrawal takes effect immediately, needs no reason, and marks the record `withdrawn` rather than
deleting it — the platform must still be able to show that data collected last term was collected
lawfully.

Consent may only be granted by an adult with a **verified** `parent_school_relationship` to that
specific child. An unverified adult's consent is not verifiable consent.

> Enforced across `ConsentGateTest` (12 tests).

### 5. Government never sees an individual child

`DevelopmentAccessService` has **no officer branch at all**. Not a restricted one — none. District,
state, national and researcher roles cannot reach an individual development record through any code
path, because section 32 grants them aggregate and anonymised access only, and the way to guarantee
that is to never write the branch.

If you are asked to build a government view of this data, build it as an aggregate query that never
selects a `student_user_id`. Do not add a method here.

> Enforced by `GrowthAccessBoundaryTest`, which asserts 403 for district, state, national and
> researcher roles, plus other families' parents, classmates, and teachers at other schools.

### 6. Every growth area carries a next step

`growth_goals.support_at_school` and `support_at_home` are `NOT NULL`. A goal that names a problem
without naming what anyone will do about it is not a valid row. A term carries at most
`GrowthPlan::MAX_GOALS` (3) goals, so the plan stays something a family can actually act on.

> Enforced by `NoLabelingRulesTest::test_a_growth_goal_cannot_be_saved_without_both_school_and_home_support`
> and `test_a_term_carries_at_most_three_goals`.

### 7. The loop is two-way

Guardians add their own observations from home, not just receive school output. A parent noticing a
strength the school has not seen is the point, not a nice-to-have.

> Enforced by `NoLabelingRulesTest::test_a_guardian_can_add_their_own_observation_from_home`.

### 8. Peer observations are moderated

`observer_role = 'peer'` writes land as `moderation_status = 'pending'` and are invisible — including
to the child they are about — until a teacher at that school clears them. This module must never
become a popularity contest or a bullying vector.

### 9. Never mixed with grading, ranking or discipline

This data is deliberately separate from `student_academic_records` and from the complaint and
safeguarding systems. Mixing them undermines the honesty of both: an observation a teacher knows
will feed a grade stops being an honest observation.

---

## Known approximation: "their students"

This build has **no class roster or teacher-to-student subject linkage**. So "a teacher's students"
resolves to *students with a verified enrolment at a school where this teacher is verified*.

That is wider than the spec's intent (section 20 says a teacher sees capability data "for their
students", meaning their subject and period). It is the same school+subject proxy already documented
for the Teacher Effectiveness Index, and it is stated here rather than hidden because it is the one
place this module is more permissive than the spec asks.

**It tightens automatically once real rosters exist**: add the roster check inside
`DevelopmentAccessService::sharesSchoolWith()` and every caller inherits it. Nothing else needs to
change.

---

## Where things live

| Concern | File |
|---|---|
| Consent gate (DPDP §9) | `app/Services/ConsentService.php` |
| Access matrix (spec §20) | `app/Services/DevelopmentAccessService.php` |
| Pathway suggestions + bias guard | `app/Services/CareerPathwayService.php` |
| Per-record authorization | `app/Policies/{CapabilityObservation,GrowthPlan,CareerInterestProfile,LifeSkillRecord}Policy.php` |
| Guardian consent screen | `resources/views/livewire/consent/manage.blade.php` |
| Shared growth view | `resources/views/livewire/growth/show.blade.php` |
| Observation entry | `resources/views/livewire/growth/observe.blade.php` |
| Growth plan & goals | `resources/views/livewire/growth/plan.blade.php` |
| Career exploration | `resources/views/livewire/career/show.blade.php` |
| Life-skills participation | `resources/views/livewire/life-skills/show.blade.php` |
| Raw SQL for phpMyAdmin | `database/sql/2026_09_02_student_growth_career_modules.sql` |

## Writing observations well

The UI nudges toward this and seeded demo data models it, because the framing matters as much as
the schema:

- **Good:** "Kept working through a hard set of fraction problems after two wrong attempts, and
  asked for a hint rather than giving up." — a specific thing, on a specific day, in a named activity.
- **Bad:** "Is persistent." — a trait claim, which is a label wearing a compliment's clothes.

`strand` and `evidence_context` exist to push observers toward the first shape.

## Not built yet

- **Peer observation UI.** The data model, moderation workflow and policy support peer observations;
  no screen collects them yet. Deliberate — peer feedback is the highest-risk surface here and
  should ship after the rest has real usage.
- **`alumni_outcomes` (spec §17, post-school).** Table not created. Needs its own separate opt-in
  consent flow, which is a distinct piece of work.
- **Aggregate government dashboards for growth/career trends (spec §32).** Must be built as
  anonymised aggregates — see rule 5.
- **Bias review checkpoint before general availability.** Spec section 45 Phase 6 asks for an
  explicit bias review and a narrow pilot before wide rollout. The automated gender check in rule 3
  is a regression guard, **not** a substitute for that review.
