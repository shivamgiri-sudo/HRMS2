# Task 3 Brief: Nightly scheduler

Source plan: `docs/superpowers/plans/2026-08-25-employee-performance-scorecard.md` (Task 3)

## Global Constraints (binding on this task)

- New scheduled workers must be registered in **both** `backend/src/server.ts` and `backend/src/workers/all-workers.ts` (known repo pitfall — a worker registered in only one never runs).

## Prior task output you depend on

Task 2 (with its follow-up fix) produced, in `backend/src/modules/performance-scorecard/performance-scorecard-snapshot.service.ts`:
```ts
export async function writeEmployeePerformanceSnapshots(date: string): Promise<{
  written: number;
  errors: Array<{ employeeId: string; error: string }>;
}>
```
Note: the return type is `{ written, errors }`, NOT the plan document's original `{ written }` — a review found the original design let one bad employee row abort the whole nightly batch, so it was hardened to isolate per-employee failures and report them instead. Your cron must log `errors.length` if nonzero (do not let a nonzero errors array pass silently).

## Task

**Files:**
- Create: `backend/src/modules/performance-scorecard/performance-scorecard-snapshot.cron.ts`
- Modify: `backend/src/server.ts`
- Modify: `backend/src/workers/all-workers.ts`

**Interfaces:**
- Consumes: `writeEmployeePerformanceSnapshots` from `./performance-scorecard-snapshot.service.js` (note: return shape is `{ written, errors }`, see above), `getIstDateString` from `../../utils/dateUtils.js` (confirm this exact path by checking how `backend/src/modules/dashboards/dashboard-snapshot.cron.ts` imports it — match it exactly, don't guess).
- Produces: `startPerformanceScorecardSnapshotScheduler()`, `stopPerformanceScorecardSnapshotScheduler()` — consumed by `server.ts` and `all-workers.ts` in this same task.

- [ ] **Step 1: Read the existing pattern first**

Before writing anything, read `backend/src/modules/dashboards/dashboard-snapshot.cron.ts` in full — this task's file must mirror its structure exactly (setInterval-based, once-per-IST-day gate, 30-min check interval). Also read its two registration sites in `backend/src/server.ts` and `backend/src/workers/all-workers.ts` so your additions match the exact surrounding code style.

- [ ] **Step 2: Write the scheduler**

```ts
// backend/src/modules/performance-scorecard/performance-scorecard-snapshot.cron.ts
import { writeEmployeePerformanceSnapshots } from "./performance-scorecard-snapshot.service.js";
import { getIstDateString } from "../../utils/dateUtils.js";

let _timer: ReturnType<typeof setInterval> | null = null;
let _lastRunDate: string | null = null;
let _running = false;

const RUN_AT_HOUR_IST = 3; // 03:00 IST, after the dashboard snapshot (02:00) and attendance reconciliation.
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

function istHour(): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date()),
  );
}

async function runPerformanceScorecardSnapshot(): Promise<void> {
  if (_running) return;
  _running = true;
  try {
    const date = getIstDateString();
    const yesterday = new Date(date);
    yesterday.setDate(yesterday.getDate() - 1);
    const targetDate = yesterday.toISOString().slice(0, 10);
    const { written, errors } = await writeEmployeePerformanceSnapshots(targetDate);
    console.log(`[performance-scorecard-cron] wrote ${written} snapshot rows for ${targetDate}`);
    if (errors.length > 0) {
      console.error(
        `[performance-scorecard-cron] ${errors.length} employee(s) failed for ${targetDate}:`,
        errors.slice(0, 10),
      );
    }
  } catch (err) {
    console.error("[performance-scorecard-cron] snapshot run failed", err);
  } finally {
    _running = false;
  }
}

export function startPerformanceScorecardSnapshotScheduler(): void {
  if (_timer) return;
  const tick = () => {
    const today = getIstDateString();
    if (_lastRunDate === today) return;
    if (istHour() !== RUN_AT_HOUR_IST) return;
    _lastRunDate = today;
    void runPerformanceScorecardSnapshot();
  };
  _timer = setInterval(tick, CHECK_INTERVAL_MS);
  console.log(`[performance-scorecard-cron] scheduler started (daily at ${RUN_AT_HOUR_IST}:00 IST)`);
}

export function stopPerformanceScorecardSnapshotScheduler(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}
```
Adjust the `getIstDateString` import path if Step 1 found it differs from `../../utils/dateUtils.js`.

- [ ] **Step 3: Register in `server.ts`**

Find the line that calls `startDashboardSnapshotScheduler();` and add, directly after it, matching the surrounding style:
```ts
import { startPerformanceScorecardSnapshotScheduler } from "./modules/performance-scorecard/performance-scorecard-snapshot.cron.js";
// ...
startPerformanceScorecardSnapshotScheduler();
```

- [ ] **Step 4: Register in `all-workers.ts`**

Find the `dashboard-snapshot` worker entry and add, directly after it, matching its exact shape:
```ts
import {
  startPerformanceScorecardSnapshotScheduler,
  stopPerformanceScorecardSnapshotScheduler,
} from "../modules/performance-scorecard/performance-scorecard-snapshot.cron.js";
// ... inside the workers array, after the dashboard-snapshot entry:
  {
    name: "performance-scorecard-snapshot",
    start: () => { startPerformanceScorecardSnapshotScheduler(); return Promise.resolve(); },
  },
// ... in the shutdown block, after stopDashboardSnapshotScheduler():
  stopPerformanceScorecardSnapshotScheduler();
```

- [ ] **Step 5: Verify it compiles**

Run: `cd backend && npx tsc --noEmit 2>&1 | grep -i performance-scorecard` — expect no output (no errors referencing your new files). If the full `tsc --noEmit` run is slow/noisy with unrelated pre-existing errors elsewhere in the codebase, that's expected — only check for errors in files this task touched.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/performance-scorecard/performance-scorecard-snapshot.cron.ts backend/src/server.ts backend/src/workers/all-workers.ts
git commit -m "feat: register nightly employee performance snapshot scheduler"
```
Stage ONLY these three explicit files. Run `git status --short` first and confirm nothing else is staged before committing — this repo has concurrent sessions editing `server.ts` and `all-workers.ts` at the same time, so re-read the current tail of each file immediately before editing, and diff-check that your added lines are the only change you're staging in those two files (if `git status` shows more changes than your own in either file, do NOT stage the whole file — investigate and stage narrowly, or ask).

## Report contract

Write your full report to `.superpowers/sdd/employee-performance-scorecard/reports/task-3-report.md`, then return ONLY:
- Status: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED
- Commit SHA(s)
- One-line verification summary
- Any concerns

## Important

- Do NOT push to GitHub. Commit locally to `main` only — pushing requires separate explicit approval not given for this task.
- `server.ts` and `all-workers.ts` are hot files other concurrent sessions also touch. `git fetch` + re-check `git log`, and re-read both files' current content immediately before editing — do not assume the line numbers or surrounding code from this brief are still exactly where the plan describes them.
- Do not touch any file outside this task's file list.
- If you have questions before starting, ask them instead of guessing.
