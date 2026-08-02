# CEO re-test plan — Round 3

**Prepared:** 2026-08-03 · **Test against:** production as deployed, commit `badec198` (01-Aug 15:09 IST)

---

## Read this first

**Four of the Round 2 findings were already fixed and already in production when you tested
them.** They shipped in `badec198` at 15:09 on 01-Aug. Your Round 2 sheet is timestamped
~09:22 that morning. You were testing a build from before the fix.

That is not a defence of the four — it is the reason Round 2 showed one page of net movement
and looked like "a queue of bugs not being worked down". Some of it was, and you could not
have seen it.

**So the single most important thing about Round 3 is that we agree what you are testing
before you start.** Every previous round has had this ambiguity and it has cost us a round
each time.

### Confirm the build first

Open any page and check the footer version, or ask for the deployed SHA before you begin. If
it does not read `badec198` or later, **stop** — the results will be about a build nobody is
trying to fix.

We are also adding build provenance (git SHA and build time on `/version`) so this check
stops depending on someone remembering. It is not in yet.

---

## Section A — the four fixes that are already live

These need confirmation, not investigation. If any still fails on `badec198`, it is a new
finding and more serious than the original, because the fix is present and did not work.

| # | Page | What was wrong in Round 2 | What to check now | Pass looks like |
|---|---|---|---|---|
| A1 | `/operations-kpi` | "Employees Scored 0"; only TALK_TIME had a target | Load the page without touching the filters | The process filter reads **All Processes**, not an arbitrary first process. Scored employees is non-zero for a month with data (July 2026: ~963). Targets show for more than one metric. |
| A2 | `/my-dashboard` | All five attendance tiles showed "—" | Load on any date, including the 1st of a month | Tiles show `0`, not `—`, when there is genuinely no data. An em-dash now means "not loaded"; a zero means "zero". |
| A3 | `/lms/my-learning` | Raw database error printed on screen | Open the page | The learning portal loads. **No** SQL text, no column names, no `Field '...' doesn't have a default value` anywhere on screen. |
| A4 | `/reports` | 39 → 38 reports | Count the reports | 38 is correct. A duplicate `leave-balance-export` entry was removed deliberately by a separate change, not lost. |

**A1 note.** The Round 1 fix is what caused the Round 2 symptom, and this is worth knowing
because it will happen again. The process filter never worked — every leaderboard you saw
before was org-wide, which is where "205" came from. Making the filter work meant the page
started asking for one process, and that process had no targets. The number you saw was
wrong before and wrong after, in opposite directions.

---

## Section B — reported as broken, believed already correct

We could not reproduce these on `main`. They are consistent with the deployed build being
older than the code. **If they still fail on `badec198`, they become real bugs and we will
treat them as Critical.**

| # | Page | Your Round 2 remark | What we found |
|---|---|---|---|
| B1 | Payslips | "'View salary' inert, label does not flip" | The handler toggles state and the label flips. Correct in code. |
| B2 | `/expenses/new` | "'New Claim' fully inert" | The button is bound to the dialog. Correct in code. |

---

## Section C — still open, and honest about it

| # | Page | Status |
|---|---|---|
| C1 | `/reports` click-inertness and 40-second load | **Not fixed. Cause not established.** We disproved two theories rather than shipping a guess. We now have an automated interaction test that clicks every tab and fails if the URL changes without the view changing — but it has not yet run against a real environment. **If this still fails, please capture the browser console and a network trace.** |
| C2 | The two 404s (`/kpi/dashboard`, `/workforce/command-center`) | These URLs are retired. Your effective page set is 19, not 22 — the UAT matrix still lists the old ones. Redirects are proposed but not built. **Please test from the reissued matrix, not the old one.** |

### If you hit C1, this is what would help most

A HAR file from a failing load. **Before sending it, it must be redacted** — a raw HAR
contains your session token, cookies, and every response body including employee personal
data. Ask us for the redaction steps; do not upload one as-is.

---

## Section D — numbers that are wrong, and numbers that are only badly labelled

Worth separating, because three of these need no code change.

| # | What you saw | Verdict |
|---|---|---|
| D1 | "Total Blocked 238" on payroll readiness | **Genuinely wrong.** 691 employees are missing at least one of UAN, PAN or bank details (656 / 209 / 103). Not yet fixed. |
| D2 | Headcount 1,152 → 1,123 | **Correct.** Real attrition between rounds. The dashboard's 1,123 is the right number. |
| D3 | "87% of 792 expected to work" | **Number correct, label wrong.** All 1,123 have attendance in 30 days; 792 was that day's scheduled population. The label needs fixing, not the figure. |
| D4 | Three different call totals on Quality | **Structural.** Six independent count queries, each with its own predicate. Needs one shared total. Not yet fixed. |
| D5 | Test candidate at rank 2, 96.67% | **Real, and being fixed properly.** The row will be marked as test data and excluded from the leaderboard rather than deleted — deleting it would hide the actual defect, which is that the leaderboard has no notion of test data and the next seeded record does the same thing. |

---

## What we changed so this round is different

You asked for three things. Two are done and one is partly done.

1. **A pre-deploy smoke test.** Exists, and now runs. It loads every CEO-role page in a real
   browser and fails on a routed 404, a leaked database error, an nginx error page or a
   server stack trace — each pattern taken from something that actually reached you on
   01-Aug. It had existed in the tree, unreachable, while four broken pages reached you.

2. **A deploy freeze during UAT windows.** Branch protection is prepared but **not applied**;
   it is a settings change awaiting approval. Being straight with you: `main` took three
   pushes during the current freeze. A freeze that relies on people remembering is not a
   freeze, which is the argument for the settings change.

3. **Root cause on the four regressions.** Delivered. Three of the four were mine, and each
   was the same shape: a correct fix removed something that had been masking an older defect.

### One thing you should know that you did not ask about

While building the smoke gate we discovered the migration chain **cannot build a database
from scratch** — it fails at migration 18 of 413. Production has never hit this because its
schema was built up over time rather than from the manifest. It means we currently could not
stand up a clean environment, including for disaster recovery. Seven defects are fixed so far
and the work is ongoing. It does not affect what you are testing, and you should know it
exists.

---

## Recording results

Please record against each item: **pass / fail / not tested**, plus the build SHA you saw.
For a fail, the page URL and the time to the second — it lets us find the exact request in
the server log, which is the difference between diagnosing C1 and guessing at it again.
