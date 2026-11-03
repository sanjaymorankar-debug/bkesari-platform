# Usability tests (Test)

Five key tasks per persona.

**Where this round ran.** On 3 Nov 2026 the build ran on a local stack identical to what test.bkesari.com would run (same `server.js`, the LadWani export and API in-process, PostgreSQL 16), because the redesign is not yet deployed to test.bkesari.com (see the testing report, §9).

**How it ran.** Each task was walked through in Chromium (Playwright) at 360 px and 1280 px, in English and Marathi, with axe-core scanning every screen.

**What this is not.** It is a scripted walkthrough, **not sessions with real users**. The moderated round with five people per persona is still to do, on test.bkesari.com, using the script below.

Result key: ✅ passes · ⚠️ passes with a finding · ⏳ not yet runnable · ❌ fails.

## Ramesh — Karta, Marathi, low-end Android (LadWani)

| # | Task | Success criterion | Result 3 Nov 2026 | Finding / fix |
|---|---|---|---|---|
| R-1 | Open bkesari.com, switch to मराठी, find LadWani | the tile in Marathi within 2 taps of landing | ✅ | Language control in the header; the home page re-renders in Marathi on the server, tiles included |
| R-2 | Start joining LadWani with his mobile number | OTP screen reached; code boxes accept an SMS autofill | ✅ (dev code shown on screen) | Delivery of a real SMS is ⏳ until an SMS gateway is chosen (decision D-012) |
| R-3 | Fill steps 2–3 (about you, native place) on 3G, losing signal midway | progress kept after the page reloads | ✅ | Saved per step on the phone; step 1 is now drawn immediately (CLS 0.18 → 0.02) |
| R-4 | Upload a photo of the ID proof and agree to the DPDP consent | preview shown, consent required before submit | ✅ | — |
| R-5 | Understand what happens next | "Under review", the expected time and the next step, in Marathi, with no operator names | ✅ | — |

## Priya — district operator, desktop (LadWani)

| # | Task | Success criterion | Result | Finding / fix |
|---|---|---|---|---|
| P-1 | Sign in with email + password | dashboard in one step | ✅ | |
| P-2 | Open the approval queue, filter by taluka | filter applied without a page reload | ⚠️ | The queue exists (`/ladwani/approvals/`) but has no taluka filter yet. Tracked |
| P-3 | View the ID proof beside the details | document visible with no download | ❌ | No document viewer: approving `member.id_proof.verify` shows in the queue but does nothing (LadWani agent report). Tracked as **Blocked**: needs an operator console |
| P-4 | Reject with a reason | the reason is required | ⚠️ | Existing approve/reject; the reason is optional today |
| P-5 | Never see another operator's decision on the same file | not visible | ✅ | The pending screen and queue show "Under review" only |

## Aarav and Sunita — student and parent (Education)

| # | Task | Success criterion | Result | Finding / fix |
|---|---|---|---|---|
| A-1 | On a shared phone, sign in to Education while Sunita stays signed in to LadWani | both stay signed in; each project's cookie is its own | ✅ | `edu_sid` on /edu, `lw_sid` on /ladwani (tests: account isolation) |
| A-2 | Sign in with mobile + OTP | home by role | ✅ | Education agent: checked end to end in Chromium |
| A-3 | Student: find the next step | first card on the home screen | ⚠️ | The student home shows the growth record and setup steps; there is no lesson data, so "continue learning" has nothing to continue (decision D-024) |
| A-4 | Parent: see whether anything needs her | this term's goals as chips, no score | ✅ | Follows the growth framework's rule 1 (no figure for a child) |
| A-5 | Switch to हिंदी and back | every screen changed and every label translated | ✅ | Education's own pages swap via the `k_lang` cookie |

## Sanjay — owner (TaskList, hub admin)

| # | Task | Success criterion | Result | Finding / fix |
|---|---|---|---|---|
| S-1 | Capture "Call vendor tomorrow 5pm #gokesari" from the phone | ≤ 2 taps, ≤ 5 s; date, time and tag picked out | ✅ | The quick-add bar sits above the bottom nav; a live preview shows the parsed chips |
| S-2 | See what is overdue and due today, in IST | first screen on open | ✅ | "3 Nov 2026 · IST"; overdue shown in red with a count |
| S-3 | Move a task to Doing on the board, by keyboard | Alt+→ moves it; the order is kept after reload | ✅ | The first run found the move not saved (a SQL parameter type clash), fixed and tested |
| S-4 | Add a task on the train (offline), then reconnect | the task appears once, with no duplicates | ✅ | The offline banner shows; a `client_id` makes the retried send idempotent |
| S-5 | Change the Driving Simulator tile to "Beta" and post a banner, at /admin | visible on the home page at once, in Marathi too | ✅ | The first run found that the task detail reopened after saving: fixed |

## Accessibility checks done alongside

- **axe-core, WCAG 2.2 AA tags:** 114 public page × width × language combinations, and 20 scans of the signed-in TaskList screens and the LadWani sign-in. LadWani's signed-in screens are still to scan, with a seeded member, on Test.
  - Findings: 3 serious, all fixed and the pages rescanned with 0 left.
  - They were the brand colour as text (4.28:1), the faded deceased tree node, and the account button's label not matching its visible text.
- **Keyboard:**
  - Tab order and the 3 px focus ring on every control.
  - The board moves by keyboard (Alt + arrows), with a "Move to" select as well.
  - Dialogs close with Esc, and focus returns to the control that opened them.
- **Screen reader:** the family tree's list view is used under 480 px and always present for screen readers (LadWani agent). Not yet tested with TalkBack or VoiceOver on a device: ⏳ in the moderated round.

## Script for the moderated round (test.bkesari.com)

1. Recruit 5 people per persona. For Ramesh, recruit in a village with a real low-end phone, no Wi-Fi.
2. Give each task as a scenario in their language ("Your grandson was born last week. Add him."), never by naming the screen.
3. Measure success, time and errors. Note every hesitation longer than 5 s.
4. Ask afterwards: "What did you expect to happen?" and "What would you call this button?"
5. Record findings in this file with the date and time (IST), and turn each into a tracker row.
