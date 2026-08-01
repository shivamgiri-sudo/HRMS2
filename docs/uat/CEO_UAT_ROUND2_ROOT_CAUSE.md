# CEO UAT Round 2 — Root-Cause Note

**To:** Deepak Kashyap, CEO **From:** Shivam Giri **Date:** 01-Aug-2026
**Re:** Step 1 — *"Root-cause note on the four regressions. Cause, not fix."*

---

## Summary

Your reading is correct. Four working pages broke, and **three of the four trace to a single
commit of mine** — `dcd7543e`, the one that closed 17 of the Round 1 findings.

Every one of them has the same shape, and it is worth naming because it changes what we
should do about it:

> **A correct fix removed something that was accidentally hiding an older defect.**

None of the underlying defects were introduced on 31-Jul. Each had been sitting in the code
for between three days and three weeks, unreachable because something upstream was failing
first. Fixing the upstream failure made them reachable. That is not an excuse — the effect
on you was identical — but it does mean the answer is not "be more careful when fixing", it
is "have something that runs the pages before they reach you."

**The direct answer to "how did a release break four working pages": nothing stood between
the change and production.** Details in §5.

---

## 1. Operations KPI — 205 scored → 0 scored (Critical)

**Cause: the filter started working, and the page was asking the wrong question.**

Round 1's "205 employees scored" was itself the bug. The page sent a parameter named
`process_id`; the server expected `processId`; the mismatch meant the value was silently
discarded and **every request returned the whole organisation regardless of the dropdown**.
205 was the org-wide number, and the process filter had never worked.

`dcd7543e` corrected the parameter name. That made a second, older line consequential: on
load, the page selects whichever process the server happens to list first. Harmless while
the filter was ignored; decisive once it was honoured. The page began asking for one
arbitrary process, and a process with no configured targets returns nothing — for every
period, which is why both August and July read zero.

No data was lost. Verified in the database today: **22,833 KPI records for July, and 963
employees still scoreable organisation-wide.**

"Only TALK_TIME carries a target" is the same cause seen from another angle — the target
panel was also showing that one auto-selected process, not the organisation.

*Fixed. The page now defaults to All Processes.*

## 2. Report Library — inert (Critical)

**Cause: partly established, partly not. I am not going to guess at the rest.**

What is established and measured: the Daily Attendance Report became **roughly four times
slower** on 31-Jul. A sub-query over the attendance-session table lost its date restriction
and began processing 34,398 rows on every request instead of the 792 belonging to the day
being asked for. Measured on production: **11.7 seconds, against 3.1 after the fix.** The
page runs that query twice per load to obtain a row count, so a single view cost about
**23 seconds of database time.** That is consistent with your note that one navigation
"rendered a blank page after 40 seconds."

What is **not** established is why every tab and category button did nothing. I examined the
click handlers, the selection state and the component's structure, and found no defect;
the code typechecks and the same handlers work in the sibling view. A page that renders,
then ignores every click, then paints blank, behaves like a browser tab starved by a
long-running request — which the 23 seconds above would explain — but I cannot prove that
from source alone.

**What I need from you:** the browser console output and network trace (F12 → Console, and
Network → "Save all as HAR") from one failing load. That will settle it in minutes. I would
rather ask than ship a fix for a cause I have guessed.

*Performance fixed and measured. Click-inertness open pending that trace.*

## 3. My Learning — raw database error on screen (High)

**Cause: a 403 had been hiding a cross-system schema break for three days.**

The learning portal check tested a key that never existed, so **every user of the product**
received "LMS access is not assigned" — that was Round 1's handled message. It read like a
permissions problem; it was a typo.

Correcting it let the request proceed for the first time, straight into a genuine failure.
The LMS is a separate system with its own database and its own release schedule. On 29-Jul
it added two mandatory columns to the table we write a session into. Our code predates that
change and supplies neither, so the insert now fails.

Two things went wrong and only one of them is about the LMS:

- **The insert** was missing columns the LMS began requiring. Ours to fix, and fixed.
- **The error text reached your screen.** Our handler returned the raw database message to
  the browser. Internal schema detail must never surface in a user interface, and you are
  right to have flagged it. Also fixed — and worth noting this exact class of leak was
  fixed in June and reintroduced in July, so it warrants a lint rule rather than a third
  manual fix.

*Both fixed. The LMS-side migration is being raised with that system's owner; we are not
modifying it ourselves.*

## 4. My Dashboard — attendance tiles blank (High)

**Cause: it was the first day of the month.**

The tiles query attendance for the current calendar month. On 1 August there were no records
yet. A summing query over no rows returns *empty* rather than *zero*, and the page renders
empty as a dash. The same query on 31 July had July's data and returned 13.8%.

There was a guard intended to catch exactly this — a default block of zeros — but it could
never run, because the query always returns one row even when that row is empty. It looked
like protection and was not. A second safeguard in the dashboard was bypassed for the same
reason: it checked whether the response had fields rather than whether those fields had
values, and a response full of blanks passed the test.

So this would have appeared on the first of any month. It surfaced on 1 August because that
is when you tested.

*Fixed in both places, and in the sibling endpoint that had the identical defect.*

## 5. Why none of this was caught

This is the part I would ask you to weigh most heavily, because it is the cause behind the
causes.

| | |
|---|---|
| **227 commits** went to production between your Round 1 and Round 2 sessions | roughly 8–10 per hour |
| **The deploy does not wait for the test suite.** Deployment and testing are two separate pipelines; the deploy does not consult the other | |
| **Five deploys shipped on 01-Aug while the test pipeline was failing on those same commits** | |
| **The deploy's own gate runs 5 test files** out of some 3,600 tests | none of them touch any page you tested |
| **The frontend test suite — 378 tests — has never run once.** Its job was misconfigured from the day it was added and fails before executing a single test | this is the suite that would have caught three of the four |
| **Post-deploy verification checks two URLs**, and does so in a way that reports success even when the page is broken | |
| **We cannot tell you what "v1.1.1" contains.** The version string is hardcoded and was last edited on 29-Jul | so the release that broke four pages cannot be compared against the one that worked |

**That last line is the honest core of it.** Four pages broke in a release we cannot
reconstruct, gated by five tests, verified by two URLs that always report success.

I have fixed the frontend test job as the first change of this round — it is a one-line
correction that unlocks 378 tests that have never run.

## 6. Two items I could not reproduce

Reported as broken; correct in the current code:

- **Payslips, "View salary" does nothing.** The toggle is wired and flips its own label.
- **"New Claim" is inert.** The button opens its dialog.

Both are consistent with the deployed build being older than the current code — which,
per §5, we currently have no way to confirm or rule out. They need re-testing against a
recorded build. If they still fail, they are real and I will treat them as such.

## 7. On the two 404s

`/kpi/dashboard` and `/workforce/command-center` were fixed on 31-Jul at the source: removed
from your role and retired in the page catalogue, verified still holding today. You reached
them by typing the URLs printed in the UAT matrix, which no route serves.

Rather than reissue the spreadsheet, both now **redirect** to the real pages — which also
fixes every stale bookmark and every copy of the matrix already circulated.

---

## What I am asking for

1. **The console and network trace** from one failing `/reports` load (§2).
2. **Agreement on the deploy gate** before further feature work. The fixes in this round are
   worth little if the next release removes four more pages.
3. **A recorded build identifier** for Round 3, so we can state precisely what you tested.

On your closing question — whether this is a tool or an asset — Round 2 answers part of it
regardless of intent: a system that cannot say what is running in production, and deploys
without running its own tests, is not yet either. That is fixable, and it is cheaper than
the features waiting behind it.
