# Testing agents

Every project behind bkesari.com has a **testing agent**: a Claude Code subagent
with its own test specification. After every code change it runs the project's
complete standard and regression suites, fixes the defects it finds, runs
everything again, and writes a report.

| Project | Repository | Agent | Specification |
|---|---|---|---|
| bkesari.com hub (welcome page, menu, Task Tracker, ATIP viewer, tab proxy) | `bkesari-platform` | `portal-tester` | `TEST_SPEC.md` |
| Education (`/edu/`) | `bkesari-platform` | `edu-tester` | `edu/TEST_SPEC.md` |
| LadWani (`/ladwani/`, served by the hub; code in `ladwani/`) | `bkesari-platform` | `portal-tester` (hub side) + LadWani's own suites: `npm test`, `npm run typecheck`, the static export build | `TEST_SPEC.md` |
| ATIP (`/ATIP/` snapshot; the platform itself runs on the Mac) | `ATIP-DEV` | `atip-tester` | `TEST_SPEC.md` |
| Education, standalone copy (edutest.agtci.com, superseded) | `edu` | `edu-standalone-tester` | `TEST_SPEC.md` |
| agtci.com | `agtci` | `agtci-tester` | `TEST_SPEC.md` |

Each agent's definition is `.claude/agents/<agent>.md` in its repository. The
procedure is the same everywhere; the specification is what differs: what to
run, how to set up the scratch database, the baseline counts, and the
behaviours that must never break.

## What an agent run does

1. Works out what changed and which critical behaviours it can reach.
2. Sets up the environment from the spec — always a local, throwaway database.
   It refuses (`BLOCKED`) if anything points at a real dev, test or production
   database.
3. **Standard suite**: static checks, unit, integration, build, a smoke run of
   the app, security and hygiene checks.
4. **Regression suite**: the full test suite, the spec's critical-regression
   checks, and a comparison with the baseline — fewer tests, or a new skip,
   counts as a failure.
5. Triages each failure (product defect, test defect, environment, or already
   broken on the default branch) and gives it a severity S1–S4.
6. Fixes the defects at the root, adding a test where none caught it. It never
   skips, disables or weakens a test.
7. Runs the complete suites again. Up to three fix-and-retest rounds.
8. Writes the report to `.claude/test-runs/` (git-ignored) and ends with a
   verdict: `PASS`, `FAIL` (a defect is still open) or `BLOCKED` (could not run).

The agent leaves its fixes in the working tree. It never commits, pushes or
deploys; the session that called it reviews and commits them.

## How it is triggered after every change

`.claude/hooks/test_gate.py` (identical in all six repositories) is wired into
Claude Code's hooks in `.claude/settings.json`:

| Hook | What the gate does |
|---|---|
| `SessionStart` | Notes what each project's files look like now. |
| `Stop` | If a project's files changed during the session and no testing agent has run on the result, Claude is not allowed to finish: it is told which agent to launch and which files changed. |
| `SubagentStop` | When a testing agent finishes, records its verdict against the code it left behind. |

"Changed" is a content hash of the project's files (tracked, staged, unstaged
and new), so an edit, a new file, a deletion, a shell command or a commit all
count, and undoing a change un-counts it. Documentation (`*.md`, `docs/`),
spreadsheets and `.claude/` itself are ignored. A session that only reads code
is never held.

Two safety valves keep it from wedging a session: if Claude is asked twice for
the same untested code and still does not run the agent, the gate lets it
finish and shows a warning instead; and a crash in the gate never blocks.
A `FAIL` verdict is shown to you rather than re-triggering the agent, because
the agent has already been through its own fix loop and what is left needs a
person.

Which paths belong to which agent is in `.claude/test-gate.json`. In
`bkesari-platform`, `edu/` and `database/edu/` belong to `edu-tester` and
everything else to `portal-tester`, so a change to one does not re-test the
other.

### Sessions started in one repository

Nothing to do: the repository's `.claude/settings.json` carries the hooks.
This is the normal case on the Mac (`cd ~/Projects/bkesari && claude`).

### Cloud sessions with several repositories

A cloud session that checks out several repositories starts in the folder
above them, and Claude Code only reads `.claude/settings.json` from the folder
a session starts in. So those sessions need the hooks at user level, where a
`--workspace` flag makes the gate check every repository under the session's
folder at once.

Add this to the cloud environment's **setup script** (the environment menu in
the session's title bar → Edit → Setup script). It needs no repository to be
cloned yet: the hook finds the gate when it fires.

```bash
python3 - <<'EOF'
import json, os
p = os.path.expanduser("~/.claude/settings.json")
s = json.load(open(p)) if os.path.exists(p) else {}
cmd = ('f=$(ls "$CLAUDE_PROJECT_DIR"/.claude/hooks/test_gate.py "$CLAUDE_PROJECT_DIR"/*/.claude/hooks/test_gate.py '
       '2>/dev/null | head -n 1); [ -z "$f" ] || python3 "$f" %s --workspace "$CLAUDE_PROJECT_DIR"')
for event, arg, timeout in (("SessionStart", "session-start", 30), ("Stop", "stop", 60), ("SubagentStop", "subagent-stop", 60)):
    groups = s.setdefault("hooks", {}).setdefault(event, [])
    if not any("test_gate.py" in h.get("command", "") for g in groups for h in g.get("hooks", [])):
        groups.append({"hooks": [{"type": "command", "command": cmd % arg, "timeout": timeout}]})
os.makedirs(os.path.dirname(p), exist_ok=True)
json.dump(s, open(p, "w"), indent=2)
EOF
```

On a machine where the repositories already exist, the same thing is
`python3 .claude/hooks/test_gate.py install-user-hooks` from any of them.

To confirm it took: a new session's first message context includes
"Test gate is on", followed by one line per project.

In such a session the project agents are not registered as subagent types, so
Claude launches a general-purpose agent and tells it to follow the agent file.
The agent's last two lines (`TESTER: <agent>` and `VERDICT: ...`) are how the
gate recognises it.

## By hand

- Ask Claude: *"run the ladwani-tester agent"* (or several at once).
- `python3 .claude/hooks/test_gate.py status` — each project, tested or not,
  and the last verdict.
- `python3 .claude/hooks/test_gate.py accept` — sign off the current code
  without a run, for a change you have tested some other way.
- Reports: `.claude/test-runs/<timestamp>-<agent>.md`, and the most recent one
  per agent in `.claude/test-runs/latest-<agent>.md`.

## Changing the specs or the gate

- A spec is a normal file in its repository. When a test is added, a level is
  added, or the baseline moves, update the spec in the same pull request.
- The gate script must stay identical in all six repositories. After editing
  one copy, copy it to the others and check:
  `md5sum */.claude/hooks/test_gate.py` from the folder above them.
- CI still runs every repository's suites on each push and pull request. The
  testing agent does not replace CI; it runs the same suites, plus the smoke,
  hygiene and critical-regression checks CI does not, and fixes what it finds
  before the change ever reaches a pull request.
