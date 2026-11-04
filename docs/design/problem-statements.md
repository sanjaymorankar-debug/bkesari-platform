# Problem statements, "How might we", success metrics (Define)

## Hub — bkesari.com

**Problem.** A first-time visitor lands on a page with a heading, one line of copy and a footer. It does not say what bkesari offers, which projects exist, or where to sign in. The one sign-in it offers ("One bkesari ID") is the opposite of how the projects should work.

**How might we…**
- show every project, its state (Live / Beta / Coming soon) and one benefit, in the visitor's language, before any scrolling on a phone?
- make "each project has its own account" obvious, so nobody expects one login to open everything?
- let the owner change tiles and post a notice without a deploy?
- send people who bookmarked the old sign-in somewhere useful?

## LadWani

**Problem.** Ramesh cannot register his family without help. The sign-in is in English, it does not name LadWani, it needs a password, and after submitting he cannot tell what is happening. Priya has no queue built for approving.

**How might we…**
- get a Marathi-speaking Karta from "Join" to "submitted" in four short steps, with progress saved if the network drops?
- explain "under review" so it reads as normal, never as rejection, without exposing which operator decided what?
- let Priya clear a queue from the keyboard with the document beside the details?
- show a family tree that works on a 360 px phone and with a screen reader, not only as a wide diagram?

## Education

**Problem.** Students and parents share phones, but the shared bkesari ID makes "whose account is this" unclear. Each role's home does not lead with the next step.

**How might we…**
- keep Education's account fully separate from the other projects on the same phone?
- open each role on what it needs next: the student's next item, the parent's "anything needs me?", the teacher's classes?
- show progress without reducing a child to a number?

## TaskList

**Problem.** Capturing a task takes a full form, and there is no today view. Dates are not in IST words, nothing works offline, and the same login opens the hub's other projects.

**How might we…**
- capture a task, with its date, time, tag, list and priority, from one line in under 5 seconds?
- show overdue and due-today, in IST, as the first thing on open?
- let a change made offline survive and sync without duplicates?
- move work across a board with a mouse, a finger or a keyboard?

## Success metrics

| Metric | Target | Baseline (audit, 3 Nov 2026) | How measured |
|---|---|---|---|
| Lighthouse (mobile) performance / accessibility / best practices | ≥ 90 each, every key page | prod `/`: 93 / 95 / 100; SEO 50 on sign-in | Lighthouse, mobile preset |
| CLS | < 0.1 | 0.13 on the hub home | Lighthouse |
| LCP on 4G | < 2.5 s | 2.00–2.27 s | Lighthouse (simulated) |
| axe violations (WCAG 2.2 AA) on key pages | 0 | 6–12 serious nodes per page; 1 critical on every page | axe-core 4.x |
| Horizontal scroll at 320–360 px | none | none | Playwright |
| TaskList: time to capture a task | ≤ 5 s, 2 taps | a form with 10 fields | usability task TL-1 |
| LadWani: sign-up completion | ≥ 80% of starts reach "submitted" | not measured | analytics events `signup_start` / `signup_submit` |
| LadWani: operator time per approval | ≤ 30 s | not measured | operator console timing |
| Languages | every new screen in EN / मराठी / हिंदी | English only | key-parity tests |
| Account isolation | signing in or out of one project never affects another | one shared ID | `tests/tasklist.pg.test.js`, `tests/hub.pg.test.js` |
