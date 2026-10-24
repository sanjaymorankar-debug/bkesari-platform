# bkesari platform

## Testing agent

Every code change in this repository goes through its testing agent before the
work is reported as done. The agent runs the standard and full regression
suites from its spec, fixes the defects it finds, re-runs everything and writes
a report to `.claude/test-runs/`.

| Agent | Spec | Covers |
|---|---|---|
| `portal-tester` (`.claude/agents/portal-tester.md`) | `TEST_SPEC.md` | everything outside `edu/` and `database/edu/` |
| `edu-tester` (`.claude/agents/edu-tester.md`) | `edu/TEST_SPEC.md` | `edu/` and `database/edu/` |

The testing agents of the other repositories (bkesari, Ladwani, edu, agtci,
ATIP-DEV) are listed in `docs/TESTING_AGENTS.md`.

- Launch it with the Agent tool and that `subagent_type`. If the type is not
  offered (a session started outside this repository), launch a general-purpose
  agent and tell it to read and follow the agent file.
- The Stop hook in `.claude/settings.json` (`.claude/hooks/test_gate.py`)
  holds the session until the agent has run on the changed code.
  `python3 .claude/hooks/test_gate.py status` shows what has been tested.
- When several agents are due, run them in parallel, then report each verdict.
