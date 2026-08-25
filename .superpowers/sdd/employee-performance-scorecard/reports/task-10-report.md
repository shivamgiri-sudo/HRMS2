# Task 10 Report: Wire into `TeamPerformanceTab`

## Step 1: Fresh read of current file

Read the live `src/components/my-team/TeamPerformanceTab.tsx` before editing (not the plan's assumed version). Confirmed:
- `Input` from `@/components/ui/input` was already imported (used later by the coaching modal's date field), so no new import needed for it.
- The flat table to replace was the `<Table>...</Table>` block (lines ~170-220) rendering Employee/KPI Score/Risk Level/Coaching columns, sourced from the `agents` array (`/api/management/agent-performance`).
- The `agent-performance` query (`useQuery(["management", "agent-performance"], ...)`), the KPI bar chart (`ChartContainer`/`BarChart`), and the coaching `Dialog` (triggered by `coachModal` state, posting to `/api/management/coaching`) are all independent of the flat table and were left completely untouched.

## Step 2: Changes made

- Added import: `import PerformanceScorecardTable from "@/components/performance-scorecard/PerformanceScorecardTable";` — confirmed via direct read of Task 9's file (`src/components/performance-scorecard/PerformanceScorecardTable.tsx` line 24: `export default function PerformanceScorecardTable(...)`) that it is a **default** export, so no adjustment to a named import was needed.
- Added `dateFrom`/`dateTo` state (30-day default window) directly below the existing `useState` calls, exactly per the brief's snippet.
- Added the date-range `<Input type="date">` pair above the bar chart, inside the same conditional branch (`agents.length > 0`) so it only shows once there is agent data to scope by, matching the surrounding layout convention (bar chart and table already live in that same branch).
- Replaced the entire flat `<Table>` block with `<PerformanceScorecardTable dateFrom={dateFrom} dateTo={dateTo} />`.
- Left `agents`, `chartData`, `avgScore`, the bar chart, and the coaching `Dialog`/`submitCoaching` logic fully intact. `riskLabel` and `ScoreBar` helper functions are now unused (they were only consumed by the removed table), but were left in place rather than deleted, since the task scope is "replace the table," not "clean up now-dead helpers," and `noUnusedLocals`/`noUnusedParameters` are both `false` in this repo's tsconfig so they cause no build/typecheck failure.

## Step 3: Verification — real gate

```
npm run typecheck
```
(`tsc --noEmit -p tsconfig.app.json && tsc --noEmit -p tsconfig.node.json`)

Result: exit code 2, but `grep -i "TeamPerformanceTab\|PerformanceScorecardTable" /tmp/tc.log` returned **zero matches**. All ~100+ errors in the output are pre-existing, unrelated to this change (e.g. `src/components/finance/budget/BudgetTopupPanel.tsx`, `src/components/onboarding-full/...`, `src/components/finance/grn/GrnSearchWorkspace.tsx`). Confirmed zero new errors attributable to `TeamPerformanceTab.tsx` or `PerformanceScorecardTable.tsx`.

Did not run `npm run build -- --mode development` due to time budget; the typecheck gate (the project's documented real gate per memory `hrms2-frontend-typecheck-noop.md`) is clean for both touched files.

## Step 4: Manual/browser verification

No running dev server or demo login was available in this environment. Stating explicitly per instructions: **manual browser verification was not performed.** Static review of the JSX confirms structurally correct wiring (date state feeds both `Input` fields and the new table's props; original chart/dialog markup unchanged).

## Step 5: Commit

```
git fetch
git log origin/main -3 --oneline   # confirmed HEAD context: f993fa58 "fix(migration-guard): add 1607_performance_scorecard_page_catalog..."
git status --porcelain -- src/components/my-team/TeamPerformanceTab.tsx   # only this file dirty, from this session's edits
git add src/components/my-team/TeamPerformanceTab.tsx
git commit -m "feat: wire PerformanceScorecardTable into TeamPerformanceTab"
git show --stat HEAD   # confirmed exactly 1 file changed (17 insertions, 52 deletions), nothing else swept in
```

Commit: `b620e924f2ed2540d1d50d6fd0c099e1f77905ed`

Not pushed — local commit to `main` only, per instructions.

## Concerns

1. `riskLabel` and `ScoreBar` helper functions are now dead code (unused) in this file. Left them in place since removing them wasn't in scope and the tsconfig tolerates unused locals; a future cleanup task could remove them along with the now-unused `Shield`/`AlertTriangle` icon imports (those two icons are actually still referenced nowhere else in the file — confirmed `AlertTriangle` and `Shield` were only used inside the removed table block, so they too are now unused imports, harmless under this repo's tsconfig but worth a follow-up lint pass).
2. No live/browser verification was possible in this environment — flagged explicitly rather than fabricated.
