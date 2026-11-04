# Information architecture and user flows (Ideate)

## The estate

```mermaid
flowchart TB
  hub["bkesari.com (hub)<br/>home · about · contact · privacy · terms<br/>/auth/sign-in = choose a project"]
  admin["/admin<br/>hub admin's own login<br/>tiles · banner · contact inbox"]
  lw["/ladwani/<br/>LadWani: own users, own DB<br/>cookie lw_sid"]
  edu["/edu/ (/education redirects)<br/>Education: own users, own DB<br/>cookie edu_sid"]
  tl["/tasklist/ (/tasks redirects)<br/>TaskList: own users, own DB<br/>cookie tl_sid"]
  atip["/ATIP/ ↗<br/>owner only (hub admin, owner role)<br/>code untouched"]
  static["/driving-simulator/ · /environment/<br/>static pages, shared shell"]
  hub --> lw & edu & tl & static
  hub -. new window .-> atip
  hub --- admin
  admin -. owner session .-> atip
```

Each project's header carries the same shell:
- the bkesari logo, which returns to the hub;
- the project name in its accent;
- the All-projects switcher;
- the language and theme controls;
- the account menu of **that project only**.

## Hub

```mermaid
flowchart LR
  home["Home<br/>hero (EN/MR/HI) · 6 tiles · how accounts work"] --> tile{"Tile 'Open'"}
  tile -->|LadWani / Education / TaskList| landing["The project's own landing or sign-in"]
  tile -->|ATIP| atip["/ATIP/ in a new window"]
  tile -->|Driving / Environment| static["Static page"]
  old["Old link: /auth/sign-in, /access/request"] --> chooser["Choose a project to sign in"] --> landing
  home --> contact["Contact"] -->|valid| sent["Thank you"]
  contact -->|invalid| contact
```

## LadWani

```mermaid
flowchart TB
  L["Landing /ladwani/<br/>what it is · privacy note · Join / Sign in"] -->|Join| S1
  L -->|Sign in| SI["Sign in<br/>tab 1: mobile + OTP · tab 2: password"]
  subgraph signup["Sign-up stepper (progress saved on the phone)"]
    S1["1 Mobile + OTP"] --> S2["2 About you"] --> S3["3 Native place<br/>State → District → Taluka → Village"] --> S4["4 ID proof + self-declaration + DPDP consent"]
  end
  S4 --> P["Approval pending<br/>'Under review' · expected time · what next"]
  P -->|operator approves| D
  SI --> D["Dashboard<br/>families · requests · announcements · groups"]
  D --> T["Family tree<br/>zoom/pan · fold · spouse links · † greyed<br/>list view < 480 px and for screen readers"]
  D --> K["Karta tools<br/>add member/newborn · mark deceased · join requests"]
  D --> M["Matrimony (opt-in)"] & C["Community feed"] & F["Friend search"]
  O["Operator console (desktop)<br/>queue · document viewer · approve / reject + reason"] -.-> P
```

## Education

```mermaid
flowchart LR
  EL["Landing"] --> ESI["Sign in<br/>mobile + OTP · email + password"] --> R{"Role"}
  R -->|Student| ST["Home: next step · growth record"]
  R -->|Parent| PA["Home: child's goals · anything needs me?"]
  R -->|Teacher| TE["Home: schools · consented students · observations"]
  R -->|School admin| SA["School: fees · exams · facilities"]
```

## TaskList

```mermaid
flowchart TB
  TSI["Sign in / Sign up<br/>mobile + OTP · email + password"] --> TD
  Q["Quick add bar (always visible)<br/>'Call vendor tomorrow 5pm #gokesari'"] --> TD
  TD["Today<br/>overdue · due today (IST)"] <--> UP["Upcoming<br/>agenda · calendar"]
  TD <--> BD["Board<br/>To do · Doing · Waiting · Done<br/>drag and drop · Alt+arrows · 'Move to'"]
  TD <--> MO["More<br/>Lists · Tags · Search · Completed · Settings"]
  TD --> DT["Task detail (bottom sheet on phones)<br/>notes · due IST · priority · tags · list · repeat · reminder · sub-tasks · links · updates"]
  OFF["Offline: changes queue on the phone"] -.-> SYNC["Back online: sent in order, no duplicates"]
```

## Navigation per project

| Project | Phone bottom nav (max 4) | Desktop side nav |
|---|---|---|
| LadWani | Home · Family · Search · Profile | the same, plus Matrimony, Community, Approvals (by role) |
| Education | Home · Schools · Notifications · Profile (by role) | the same, plus role tools |
| TaskList | Today · Upcoming · Board · More | Today, Upcoming, Board, Lists, Tags, Search, Completed, Settings |
| Hub | none: a single page with tiles | none |
