# Test Accounts (synthetic data only)

Every account below uses the same demo password: **`Password123!`**

This is a test environment. All accounts and data are fabricated — do not reuse this password anywhere real, and do not put real people's information into these accounts.

| Role | Email | Notes |
|---|---|---|
| System Admin | `admin@test.agtci.com` | Full working dashboard + admin panel (rating weights, categories, audit log) |
| National Admin | `national.admin@test.agtci.com` | Full working dashboard (national rollups, audit log link) |
| Researcher | `researcher@test.agtci.com` | Full working dashboard (aggregate-only analytics, no complaint detail) |
| State Officer (Maharashtra) | `state.mh@test.agtci.com` | Full working dashboard |
| State Officer (Karnataka) | `state.ka@test.agtci.com` | Full working dashboard |
| State Officer (Delhi) | `state.dl@test.agtci.com` | Full working dashboard |
| District Officer (Pune) | `district.pun@test.agtci.com` | Full working dashboard |
| District Officer (Mumbai) | `district.mum@test.agtci.com` | Full working dashboard |
| District Officer (Bengaluru Urban) | `district.blr@test.agtci.com` | Full working dashboard |
| District Officer (Mysuru) | `district.mys@test.agtci.com` | Full working dashboard |
| District Officer (New Delhi) | `district.ndl@test.agtci.com` | Full working dashboard |
| School Admin (demo school) | `school.admin@test.agtci.com` | Full working dashboard, linked to the first seeded school |
| Parent (demo) | `parent@test.agtci.com` | Full working dashboard, verified at the same demo school, has an existing complaint |
| Student (demo) | `student@test.agtci.com` | Full working dashboard |
| Teacher (demo) | `teacher@test.agtci.com` | Full working dashboard with a seeded Teacher Effectiveness Index score |
| Child Safety Officer | `safety.officer@test.agtci.com` | Lands directly on the safeguarding queue (spec §25). Three seeded cases |
| School Nurse | `school.nurse@test.agtci.com` | Records health screenings for the demo school (§18) |
| Counsellor | `counsellor@test.agtci.com` | Lands on the counsellor portal (§19) |
| Data Protection Officer | `dpo@test.agtci.com` | Lands on the DPDP request queue (§21, §40) |
| Career & Life-Skills Mentor | `career.mentor@test.agtci.com` | Staffed at the demo school (§17) |

Every role now has a real dashboard — nothing left on the placeholder screen. See `ROADMAP.md` for what's still simplified within each.

## Where to look first

Most of what this build does is visible without logging in. Start at
`http://localhost:8000/schools/1` — the demo school carries seeded fees, facilities, courses,
exams and coaching, so one page shows most of the transparency modules at once:

- **What it costs** — first-year vs continuing-year totals, where the money goes, a recorded
  mid-year tuition increase, and ₹48,000 of compulsory coaching flagged as sitting *outside* those
  totals (§9, §10).
- **What it offers, and what families report** — the claimed-vs-experienced comparison. Swimming
  reads "significant discrepancy reported" with the school's published reply underneath it, which
  is §29's both-sides rule working (§11, §29).
- **Courses** — per-dimension ratings with a response count on each; Physics scores well overall
  and poorly on practical learning, which a single average would hide (§12).

Then:

- `/schools/1/improvement` — trends across years. Facility availability is up from 28.8% to 67.3%;
  everything else honestly says "not enough years yet" (§31).
- `/how-india-compares` — the benchmarking page, which opens by stating there is no Indian PISA
  score to show (§3).
- `/schools/1/safeguarding/report` — the safeguarding entry point. Note the POCSO notice appears
  *before* the form, and the confirmation leads with "This is not a report to the police" (§25).

## Trying the newer modules

- **Safeguarding** — as `safety.officer@test.agtci.com`. The POCSO case has no external report
  recorded, so the system refuses to let you close it; the physical-abuse case has one and can be
  closed. Note `school.admin@test.agtci.com` cannot see these cases at all, by design.
- **Health & wellbeing** — as `parent@test.agtci.com`, Dashboard → Health record. You see the
  counsellor's written summary for one session and "no summary yet" for the other; the raw session
  notes are never shown to you. As `counsellor@test.agtci.com` you see the observation a teacher
  raised, still waiting to be picked up.
- **Data rights** — as `parent@test.agtci.com` visit `/privacy/requests`. The page lists what
  *cannot* be deleted and why before you ask. Submit an erasure request covering growth data and
  safeguarding, then handle it as `dpo@test.agtci.com` at `/privacy/queue` — it completes for one
  and refuses for the other, with reasons recorded per category.
- **Verification** — as `district.pun@test.agtci.com`, "Open the verification queue". Nothing is
  verified until an officer ticks that they checked it.

## Trying the growth / career modules

`parent@test.agtci.com` is seeded as the verified guardian of `student@test.agtci.com`, with consent
already granted for growth, career and life-skills, and demo observations, a shared growth plan with
two goals, two career-interest captures a term apart, and three life-skills activities.

- As the **parent**: Dashboard → My Children → View growth, and "Consent settings" to see the DPDP
  consent screen (turning a purpose off immediately hides it from the school).
- As the **teacher** (`teacher@test.agtci.com`): Dashboard → Student Growth → View / Add observation,
  and "Manage growth plan" from the growth page.
- As the **student**: Dashboard → My Growth / My Interests.
- To see the access boundary: log in as any officer (e.g. `district.pun@test.agtci.com`) and open
  `/growth/<student id>` — it is a 403 by design, and there is no officer path to it.

None of the seeded accounts have 2FA enabled by default — enable it yourself from Profile → "Two-Factor Authentication" → Manage (available to School Admin and the four officer/admin roles) to test that flow. Use `admin@test.agtci.com` for `/admin/fraud-flags`, `/admin/roles`, and `/admin/moderation`.

Plus ~275 additional synthetic parent/student/teacher/school-admin accounts from the seeder — all share the same demo password, all have randomly generated `@example.com`-style emails from Faker. Query the database directly if you need to find one for a specific school/district.

## Regenerating this data

```bash
php artisan migrate:fresh --seed
```

Never run this against the production database without a fresh backup first — see `DEPLOYMENT.md`.
