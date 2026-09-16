# Database

MySQL in production (Hostinger), SQLite for local dev. 65 tables (see `database/migrations/`).

## Core groups

**Location/school:** `states`, `districts`, `schools`, `school_profiles`

**Identity & RBAC:** `users` (real identity), `roles`/`permissions`/pivot tables (spatie/laravel-permission), `parent_profiles`, `student_profiles`, `teacher_profiles`, `school_staff`, `officer_jurisdictions`

**Anonymization bridge:** `anonymous_identities` — maps `user_id` → a stable `anonymous_ref` per school/context. This is the *only* table that can join a real user to their anonymized activity. See [`SECURITY_PRIVACY.md`](SECURITY_PRIVACY.md).

**Relationships:** `parent_school_relationships` (includes `student_user_id` — links a parent to their child's own account), `student_school_relationships`, `teacher_school_relationships` — verification status (`pending`/`verified`/`rejected`) gates who may submit complaints/feedback for a school.

**Invitations:** `invitations` — School Admin-initiated invite (email + role + optional student name) with a unique token; acceptance creates the relationship as `verified` directly, skipping the normal pending-approval step.

**Complaints:** `complaint_categories`, `complaints` (stores `anonymous_ref`, never `user_id`), `complaint_evidence`, `complaint_responses`, `complaint_status_history`, `complaint_resolutions`

**Ratings:** `school_feedback` (stores `anonymous_ref`), `school_rating_components` (admin-editable weights), `school_quality_scores` (historical snapshots, one row per recalculation)

**Teacher effectiveness:** `teacher_feedback` (stores `anonymous_ref`, never `user_id`), `teacher_rating_components` (admin-editable weights), `teacher_effectiveness_scores` (historical snapshots — privacy-restricted, see `SECURITY_PRIVACY.md`)

**Retaliation:** `retaliation_reports` (stores `anonymous_ref`, optional `complaint_id` link, same anonymization rule as complaints)

**Governance:** `audit_logs` (general action log), `identity_access_logs` (every reversal of an `anonymous_ref` back to a real user, now requiring a non-empty reason — see `IdentityResolutionService`)

**Appeals:** `appeals` — one per `complaint_id` (unique), reviewed by a State Officer/National Admin/System Admin one level above whoever handled the original complaint; `reason`/`status`/`decision_note`/`resolved_at`.

**Academic records & TEI value-add:** `student_academic_records` — School Admin-entered `subject`/`term`/`score`/`max_score` per student; feeds `TeacherEffectivenessIndexService`'s value-add component (school+subject proxy, not a real roster link — see `TeacherEffectivenessIndexService`'s doc comment).

**Fraud/moderation:** `fraud_flags` (`flag_type`, `subject_type`+`subject_id` resolving to a School or teacher User, `status` open/reviewing/dismissed/confirmed), `settings` (generic key/value store — currently holds `fraud.window_minutes`/`fraud.threshold`, admin-editable at `/admin/moderation`)

**2FA:** `two_factor_authentications` — deliberately a separate table from `users` (not a column) so an encrypted secret/recovery-code set is never accidentally exposed via a broad `User::all()` or `select *` query. `secret` is `encrypted`, `recovery_codes` is `encrypted:array`.

**Analytics:** `analytics_snapshots` — `scope` (national/state), `scope_id`, `metrics` (json), `calculated_at`. Populated by `php artisan analytics:recalculate` (see `app/Console/Commands/RecalculateAnalyticsSnapshots.php`), scheduled hourly. Read by the National/Researcher dashboards and the State Officer dashboard's summary numbers — never by the State dashboard's live complaint/retaliation queues.

**Fees & true annual cost (spec §9):** `fees` — one row per school/year/class/charge, with category, amount, frequency, mandatory and refundable flags, and a `state_cap_status` (fee regulation is a state subject, so there is no single national rule to check against). History is inherent: a year's fees are that year's rows and are never overwritten. `fee_revisions` covers edits *within* a year — both the before and after amount, a full JSON snapshot of the prior state, and a required reason. `AnnualCostCalculator` turns these into first-year and continuing-year totals, keeping one-time charges and optional charges separate rather than merging everything into one number.

**Facilities, claims & experience (spec §8, §11, §12):** `facility_claims` — what a school says it offers, versioned by academic year, keyed against the canonical taxonomy in `App\Support\FacilityTaxonomy` (a code constant, deliberately not a table: claims, ratings and history must share one list or claimed-vs-experienced cannot be computed). `verification_status` is about evidence, not truth, and is not mass-assignable — `markVerified()` is the only way to set it, so a school cannot self-verify. `facility_ratings` — the experience side, storing `anonymous_ref` and never a `user_id` (same identity separation as complaints, spec §26), with structured per-dimension scores rather than one star rating, and one rating per person per facility per year. `ClaimedVsExperiencedService` compares the two into Consistent / Partially consistent / Significant discrepancy reported, showing nothing at all below 3 reports.

**Consent (DPDP Act 2023 Section 9):** `consent_records` — one row per child per purpose (`capability_growth`, `career_pathway`, `life_skills`, `physical_health`, `mental_wellbeing`, `alumni_outcomes`), storing the notice text actually shown, who granted it, and how they were verified as a guardian. Withdrawal sets `status`/`withdrawn_at` rather than deleting, so "was consent in force when this was collected?" stays answerable. Every read and write in the growth/career/life-skills modules goes through `ConsentService`.

**Student growth (spec §15–16):** `capability_observations` — dated, single-observer notes across five NEP 2020 domains, tagged `strength` or `growth_area`, from a teacher/parent/self/peer. **There is deliberately no score, rating or level column and there must never be one** — see [`STUDENT_GROWTH_FRAMEWORK.md`](STUDENT_GROWTH_FRAMEWORK.md). Peer rows land as `moderation_status = 'pending'` and stay invisible until a teacher clears them. `growth_plans` (one per child/school/term, with `shared_with_parent_at` gating guardian visibility) and `growth_goals` (max 3 per plan; `support_at_school` and `support_at_home` are NOT NULL, so no goal exists without a next step).

**Career & life skills (spec §17):** `career_interest_profiles` — a time series of child-stated interests, appended never updated, since interests are meant to change; no assigned-pathway column exists, suggestions are computed at read time by `CareerPathwayService`. `life_skills_tracking` — participation in structured activities (`participated`/`engaged`/`led`), explicitly not a score.

**Courses & curriculum ratings (spec §8, §12):** `courses` — the school's catalogue, versioned per academic year, kept separate from `facility_claims` because a school can have an excellent laboratory and a poorly-taught chemistry course. `course_ratings` — section 12's ten dimensions as named columns rather than a JSON blob, so a dimension cannot quietly appear or disappear between submissions. Anonymous (`anonymous_ref`, never `user_id`), one rating per person per course per year. Every dimension is nullable and **students see all ten while parents are asked only the six they can realistically judge** — a parent rarely sees project work, and forcing a number there would manufacture data. `CourseRating::averages()` reports a response count per dimension, since they genuinely differ.

**School right of reply (spec §29):** `school_replies` — a school's public answer to a reported claimed-vs-experienced gap or rating pattern. **Append-only**: a school posts a reply and, if things change, posts another; both stay visible and dated. Editing in place would let a published answer be quietly rewritten, and the record protects the school as much as the reader. A reply never removes, hides or scores down what it answers — it renders beside it, and a test asserts the discrepancy is unchanged by replying.

**Data-subject requests (spec §21, §40):** `data_subject_requests` — DPDP access, correction and erasure, handled by the Data Protection Officer. Retention periods and erasability live in `App\Support\DataRetention`, one declared position per category. **Erasure is partial by default and says so**: safeguarding cases, consent records, audit logs and (already-anonymous) feedback are never erased, and `outcome_by_category` records what happened to each with the reason, because a request is routinely granted in part and refused in part. The protected categories are not platform convenience — a safeguarding record removable on request is a child protection case an accused adult could get cleared, and an audit log that can be erased is not an audit log.

**Safeguarding (spec §25):** `safeguarding_reports` — deliberately separate from `complaints` and never joined into general reporting. Anonymised like complaints (`anonymous_ref`, no `user_id`). The `external_report_*` columns record whether the POCSO Act §19 duty was discharged *outside* this platform; `legal_duty_shown_at` records that the platform surfaced the obligation — evidence about the platform's conduct, not the reporter's. `SafeguardingService` blocks closure of a POCSO-engaging case until an external report is recorded, and has no `school_admin` branch at all, so a school's ordinary administration cannot see these cases. `safeguarding_events` is the append-only case trail, separate from `audit_logs` so a general audit reader cannot learn a named school has a case.

**External exams & coaching (spec §10):** `external_exams` and `coaching_programmes`, versioned per academic year. `is_mandatory` + `bundled_into_school_fees` on a coaching programme are what let the public profile show a compulsory cost sitting outside the published fee register — a factual gap between two things the school itself recorded, never an allegation. `during_school_hours` counts as effectively compulsory regardless of label.

**Health & wellbeing (spec §18–21):** all gated behind DPDP §9 consent (`physical_health`, `mental_wellbeing` purposes) via `HealthAccessService`. `physical_health_records` — one row per examination, never overwritten, so the record is a history. `wellbeing_concerns` — **teacher** observations, with no diagnosis, severity, risk or treatment column, deliberately a *separate table* from `counselling_sessions` so a shared table can't put a teacher's opinion where a clinical note belongs (§19's hard rule, enforced at the data model; a schema test guards it). `counselling_sessions` — the stricter tier: `session_notes` is counsellor-only, `shareable_summary` is what a guardian sees and is written deliberately rather than extracted. `health_followups` — §21's identified → referred → follow_up → completed → closed lifecycle. `health_access_logs` — append-only, records refused attempts as well as successful ones. `HealthAccessService` has no government branch: officers get aggregates only.

**Health aggregates for government (spec §20, §32):** no table — `HealthAggregateService` computes anonymised counts on demand. Its entire public surface is one `summary()` method returning numbers, so there is no path from a government view to a row. Any figure computed from fewer than 10 records is **withheld with a stated reason rather than published**, because a percentage drawn from three children identifies them to anyone local; the floor applies to the denominator, since 100% of 9 is as identifying as a raw count. Queue depths (overdue follow-ups, observations awaiting a counsellor) are exempt: they are work to be done, name nobody, and hiding them would defeat the point of recording them.

**International benchmarking (spec §3):** `benchmark_references` — sourced, dated descriptions of what high-performing systems *do*. **The table has no score, rank or numeric column of any kind**, which is rule 44 ("never fabricate an international benchmark score India has not produced") enforced by the schema rather than by policy; a test asserts none is ever added. `source_verified` defaults to false and the public page says so, rather than implying citations have been checked when they have not. `BenchmarkService` keeps platform-measured numbers and structural practice as separately typed structures so a view cannot render one as the other, and flags any measure whose coverage is too thin to read as representative.

**Notifications:** `notifications` — Laravel's standard database-notification table (uuid id, polymorphic `notifiable`, json `data`, `read_at`). Written to by `App\Notifications\*` classes on relationship-approval, complaint-status-change, invitation-acceptance, and appeal-decision events.

## Indexes

Search-relevant columns on `schools` (name, pincode, board, state/district), `complaints` (status, school_id+status, district_id+status, anonymous_ref), and `school_quality_scores` (school_id+calculated_at) are indexed. Nothing here is tuned for the 100k+-school scale the full spec envisions — see `ROADMAP.md` for aggregation-table/caching work that's deferred.

## Migrating on the live server

```bash
php artisan migrate --force
```

`--force` is required in production since `APP_ENV=production` blocks interactive migration prompts. **Never run `migrate:fresh` against the live database** — it drops every table.

### Applying schema changes by hand instead

If you prefer running SQL in phpMyAdmin over `artisan migrate`, `database/sql/` holds ready-to-run
scripts. They were generated from the migrations using Laravel's own MySQL schema grammar, so they
match what `artisan migrate` would produce, and each one also records itself in the `migrations`
table so a later `artisan migrate` doesn't try to recreate the same tables. Read the header comment
in the script before running it — back up first.
