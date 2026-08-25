# Task 4 Brief: Backfill script

Source plan: `docs/superpowers/plans/2026-08-25-employee-performance-scorecard.md` (Task 4)

## Prior task output you depend on

`writeEmployeePerformanceSnapshots(date: string): Promise<{ written: number; errors: Array<{ employeeId: string; error: string }> }>` in `backend/src/modules/performance-scorecard/performance-scorecard-snapshot.service.ts` (Task 2 + its error-isolation fix — note the return shape includes `errors`, not just `written`).

## Task

**Files:**
- Create: `backend/scripts/backfill-performance-scorecard-snapshot.ts`

**Interfaces:**
- Consumes: `writeEmployeePerformanceSnapshots` from `../src/modules/performance-scorecard/performance-scorecard-snapshot.service.js`.

- [ ] **Step 1: Write the script**

```ts
// backend/scripts/backfill-performance-scorecard-snapshot.ts
// Usage: npx tsx backend/scripts/backfill-performance-scorecard-snapshot.ts 2026-07-01 2026-08-24
import { writeEmployeePerformanceSnapshots } from "../src/modules/performance-scorecard/performance-scorecard-snapshot.service.js";

async function main() {
  const [fromArg, toArg] = process.argv.slice(2);
  if (!fromArg || !toArg) {
    console.error("Usage: backfill-performance-scorecard-snapshot.ts <fromDate YYYY-MM-DD> <toDate YYYY-MM-DD>");
    process.exit(1);
  }
  const from = new Date(fromArg);
  const to = new Date(toArg);
  let totalWritten = 0;
  let totalErrors = 0;
  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10);
    const { written, errors } = await writeEmployeePerformanceSnapshots(dateStr);
    totalWritten += written;
    totalErrors += errors.length;
    console.log(`${dateStr}: wrote ${written} rows${errors.length > 0 ? `, ${errors.length} errors` : ""}`);
    if (errors.length > 0) {
      console.error(`${dateStr} errors:`, errors.slice(0, 5));
    }
  }
  console.log(`Done. Total written: ${totalWritten}, total errors: ${totalErrors}`);
  process.exit(totalErrors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Dry-run against a single recent day first**

Run: `cd backend && npx tsx scripts/backfill-performance-scorecard-snapshot.ts 2026-08-24 2026-08-24`
Expected: `2026-08-24: wrote <N> rows` where N is close to the active employee count, then `Done. Total written: <N>, total errors: 0` (or a small nonzero error count if some employees genuinely fail — that's fine, the point is the script runs end-to-end and reports honestly, not that every employee succeeds).

Report the REAL output of this run in your report — do not claim it succeeded without pasting the actual console output.

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/backfill-performance-scorecard-snapshot.ts
git commit -m "feat: add performance scorecard snapshot backfill script"
```
Stage only this one file.

Do NOT run the full historical backfill range in this task — that's a separate, later step (Task 13 in the plan) that runs once the whole feature is built. This task only proves the script works for one day.

## Report contract

Write your full report to `.superpowers/sdd/employee-performance-scorecard/reports/task-4-report.md`, then return ONLY:
- Status: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED
- Commit SHA(s)
- One-line verification summary (the real dry-run output)
- Any concerns

## Important

- Do NOT push to GitHub. Commit locally to `main` only.
- This repo has concurrent sessions editing the shared tree. `git fetch` + re-check `git log` before committing; stage only your one file.
- Do not touch any file outside this task's file list.
- If you have questions before starting, ask them instead of guessing.
