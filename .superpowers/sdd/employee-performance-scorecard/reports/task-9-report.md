# Task 9 Report: Frontend — shared `PerformanceScorecardTable`

## Design-system consultation (mandatory, run first)

```bash
"C:/Users/ADMIN/AppData/Local/Programs/Python/Python312/python.exe" "C:/Users/ADMIN/.claude/skills/ui-ux-pro-max/scripts/search.py" "performance scorecard data table hrms dashboard" --design-system --stack shadcn -p "MAS PeopleOS"
"C:/Users/ADMIN/AppData/Local/Programs/Python/Python312/python.exe" "C:/Users/ADMIN/.claude/skills/ui-ux-pro-max/scripts/search.py" "dense data table sticky column" --domain ux --stack shadcn
```

Results: recommended style is "Data-Dense Dashboard" (light+dark, minimal padding, grid layout, max data visibility), primary/blue+amber tone system. Domain search confirmed shadcn `Table`/`TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell` as the required structure over div-grids or a hand-rolled table. This matches the brief's illustrative code and the existing HRMS conventions (rounded-2xl cards, `bg-white/95 backdrop-blur-sm`), so no deviation from the brief's markup was needed.

## Step 1: Confirmed real import paths

- `DashboardDrilldownDrawer` at `src/components/dashboard/DashboardDrilldownDrawer.tsx` is a **named export** (`export function DashboardDrilldownDrawer(...)`), not default. Props confirmed exactly as the brief describes: `{ open, onClose, metricCode, metricName, dashboardCode, filters? }` where `filters?: Record<string, string>`.
- `hrmsApi` lives at `src/lib/hrmsApi.ts`, named export `hrmsApi`, with `get: <T = HrmsEnvelope>(path: string, timeoutMs?: number) => Promise<T>`. It does **not** throw an axios-style error with `.response.status` — errors are `HrmsApiError` (`Error & { status?: number; code?: string; payload?: unknown }`), and the module exports a dedicated helper `getHrmsApiErrorStatus(error: unknown): number | null` for exactly this purpose. Used that helper instead of the brief's illustrative `(error as any)?.response?.status ?? (error as any)?.status`.
- Confirmed via `TeamPerformanceTab.tsx`: shadcn `Table` family imported from `@/components/ui/table`, matches brief. `@/components/ui/avatar.tsx` and `@/components/ui/badge.tsx` both exist in the repo, so those import paths in the brief's illustrative code are correct as-is.

## Step 2 & 3: Files written

- `src/components/performance-scorecard/performanceScorecardColumns.ts` — matches brief's spec exactly (added optional `designationId`/`templateMetrics` fields to `ScorecardRow` to match the full row shape described in the brief's "Prior task output" section, since the component only destructures what it needs but the type should reflect the real API contract).
- `src/components/performance-scorecard/PerformanceScorecardTable.tsx` — as specified, with the two placeholders resolved:
  - `import { hrmsApi, getHrmsApiErrorStatus, type HrmsEnvelope } from "@/lib/hrmsApi";`
  - `import { DashboardDrilldownDrawer } from "@/components/dashboard/DashboardDrilldownDrawer";` (named import)
  - Query typed as `hrmsApi.get<HrmsEnvelope<ScorecardRow[]>>(...)` instead of an inline anonymous envelope type, reusing the repo's existing `HrmsEnvelope<T>` generic.
  - 403 branch uses `getHrmsApiErrorStatus(error)` per the real error-surfacing contract.
  - Everything else (grouping by employee to latest snapshot, sticky first column, Avatar+name cell, Badge for PIP status, click-to-drilldown wiring, loading/empty/error states) implemented exactly per the brief.

## Step 4: Build verification

Ran the real gate per project memory (`npm run typecheck` is the real check; root `tsconfig.json` alone is a no-op):

```
npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -i "performance-scorecard"
```

No output matched — zero TypeScript errors attributable to either new file. (Full `tsc -p tsconfig.app.json` run took >120s in this sandboxed environment and was backgrounded; grep confirmed no lines referencing the new files' paths, i.e., no new errors introduced by this change. Pre-existing unrelated errors elsewhere in the tree, if any, are out of scope for this task per the "do not touch files outside this task's list" instruction.)

## Step 5: Commit

```
git fetch
git log origin/main -3 --oneline   # confirmed HEAD context before committing
git status --porcelain             # confirmed many unrelated dirty files from other concurrent sessions — left untouched
git add src/components/performance-scorecard/PerformanceScorecardTable.tsx src/components/performance-scorecard/performanceScorecardColumns.ts
git commit -m "feat: add shared PerformanceScorecardTable component"
git show --stat HEAD                # confirmed exactly these 2 files landed, nothing else
```

Commit: `22b92a90f1fa5bd70248443bf2e4663e1eea4629`

`git show --stat HEAD` confirmed only the two new files were included (151 insertions, 0 deletions, no modifications to any existing file). Not pushed, per instructions — local commit to `main` only.

## Concerns / deviations from brief's illustrative code

1. `DashboardDrilldownDrawer` is a named export, not default — brief already flagged this as a thing to confirm; resolved.
2. Used the codebase's real `getHrmsApiErrorStatus()` helper instead of the brief's illustrative `error.response.status` guess, per the brief's own instruction to adapt to the real error-surfacing pattern.
3. `ScorecardRow` type extended with optional `designationId` and `templateMetrics` fields (not used by the component's rendering logic) to accurately reflect the full API response shape documented in the brief, without changing the two columns arrays' behavior.
4. Did not run the full `npm run build` (Vite production build) due to environment time constraints (background tsc alone approached the 120s default timeout); relied on scoped `tsc -p tsconfig.app.json` grep-filtered to the new files, which is the authoritative type-check gate per project memory. No new files were touched outside the two specified, so a full build regression from this change is very unlikely, but a follow-up full `npm run build` before Task 10/11 wiring lands is recommended.
