# Personas (Empathize)

Four people the redesign is for. Each is a composite: built from the brief, the live-site audit (`docs/ux-audit.md`, 3 Nov 2026) and the projects' own specs. None is a real person's record.

---

## Ramesh, 58 — village Karta (LadWani)

**Context.** Head of a joint family in a Satara taluka village. Marathi-first; reads Devanagari comfortably, English slowly. A 3-year-old low-end Android phone (2 GB RAM, 720 px wide, Chrome), patchy 3G that drops in the fields. Types with one finger; uses voice notes on WhatsApp.

**Goals.** Put his family on LadWani the way his father kept the *vanshavali*. Add the newborn grandson. Know whether the registration he submitted last week was accepted.

**Frustrations today.** The live LadWani sends him to a page that says "Sign in to bkesari" in English and never says LadWani (audit finding 3). Small text, 44 px buttons, and nothing in Marathi. He cannot tell whether "pending" means rejected.

**Needs.**
- Marathi everywhere, picked once and remembered.
- 48 px targets and a 17 px base for Devanagari.
- Sign in with his mobile number and a code instead of a password.
- A status in plain words, "Under review", with when to expect an answer.
- Pages that still open on 3G.

**Quote.** "मला फक्त माझं कुटुंब दिसायला हवं, आणि ते बरोबर आहे का ते." *(I just want to see my family, and know it is right.)*

---

## Priya, 34 — district operator (LadWani)

**Context.** Approves registrations for her district, 40–80 a day, at a desktop with a large monitor in a cooperative office. Fluent in English and Marathi; fast with a keyboard.

**Goals.**
- Clear the queue by lunchtime.
- See the ID proof next to the details.
- Approve or reject with a reason in two keystrokes.
- Never be pressured by another operator's decision.

**Frustrations.** Approvals are currently mixed into a general list. There is no document viewer, and nothing lets her filter by taluka or by days waiting.

**Needs.**
- A queue with filters and keyboard shortcuts.
- A side-by-side document view.
- A reason that is required when she rejects.
- She sees only her own decisions, never what other operators decided on the same file.

**Quote.** "Show me the next one. Don't make me hunt for the photo."

---

## Aarav, 15, and his mother Sunita — student and parent (Education)

**Context.** Aarav studies in Class 10 at a semi-English school in Pune on his mother's phone after 7 pm. Sunita works shifts and checks in on her own phone.

**Goals.**
- Aarav: see what is next, finish it, see progress.
- Sunita: know in one glance whether he is on track and whether the school needs anything from her.

**Frustrations.**
- The Education site is reached through the same shared sign-in as everything else, which makes it unclear whose account is whose on a shared phone.
- Long pages with no "what next".

**Needs.**
- Separate sign-ins on a shared phone, and signing out of Education must not touch Sunita's LadWani.
- A home screen by role, with the next step first.
- Progress shown without turning a child into a score (Education's own growth framework, rule 1).

**Quote (Sunita).** "I don't want a report card every day. Tell me if something needs me."

---

## Sanjay — product owner (TaskList and hub admin)

**Context.** Runs bkesari and GoKesari. Busy, switching between phone and laptop all day. Thinks in IST. Uses the Task Tracker today, but it is a project register, not a to-do list.

**Goals.**
- Capture a task in two taps ("Call vendor tomorrow 5pm #gokesari").
- See today's work at a glance, IST.
- Move work across a board.
- Edit the hub's tiles and banner without a deploy.
- See ATIP privately.

**Frustrations today.**
- The tracker needs a form for every task.
- No "today" view; dates are planned/actual ranges.
- The hub home is nearly empty (audit: "Welcome to bkesari", one line).
- Changing a tile means a code change.

**Needs.**
- Quick add with the parsing done for him.
- Today / Upcoming / Board.
- Times shown as "08:42 AM IST".
- Keeps working offline on the train and syncs when the connection is back.
- An admin page with its own login.
- ATIP behind the owner's login only.

**Quote.** "If it takes more than two taps, I'll write it on my hand instead."
