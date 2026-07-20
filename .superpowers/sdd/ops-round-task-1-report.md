# Ops Round Candidate Score Visibility — Task 1 Report

## Status: DONE

## Commits
No commit created (awaiting user approval per CLAUDE.md §11).

## Changes Made

### backend/src/modules/ats/queue.enhanced.service.ts
- Added `OpsRoundEntry` interface and `getOpsRoundQueue()` function at end of file
- Query filters by `current_stage IN ('Operations Interview', "Round 2- Op's")` and restricts to the ops manager's branch via employee record lookup

### backend/src/modules/ats/queue.routes.ts
- Added `getOpsRoundQueue` to import list
- Inserted `/ops-round` GET route **before** the blanket `requireRole('admin','hr','recruiter','manager')` middleware (after `requireAuth`)
- Route guard: `requireRole('operations_manager', 'admin', 'hr', 'super_admin')`
- Looks up ops manager's employee ID from `employees` table using JWT user ID

### backend/src/modules/ats-assessment/assessment.routes.ts
- Added `candidateSummaryRoles` constant that extends `readRoles` with `operations_manager`
- Changed `/assessment-admin/candidates/:candidateId/summary` from `readRoles` to `candidateSummaryRoles`
- All other assessment routes unchanged

### backend/sql/461_ops_manager_ats_queue_access.sql (NEW)
- INSERT with ON DUPLICATE KEY UPDATE granting `operations_manager` can_view=1 on `ATS_WALKIN_QUEUE`

### backend/src/db/runPendingMigrations.ts
- Added `"461_ops_manager_ats_queue_access.sql"` after `"460_ats_performance_indexes.sql"`

### src/pages/NativeWalkinQueueEnhanced.tsx
- Added imports: `useQuery`, `useQueryClient`, `useUserRole`, `Badge`, `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent`, `Button`
- Added `OpsRoundEntry` interface
- Added ops-round tab hooks: `isOpsManager`, `isRecruiterOrHR`, `activeTab`, `opsDate`, `opsRoundQuery`
- Ops managers who are not also recruiter/HR land directly on `ops_round` tab
- Wrapped existing queue JSX in `<TabsContent value="queue">` (unchanged)
- Added `<TabsContent value="ops_round">` with 8-column read-only table: candidate, applied role, branch, assessment %, typing WPM+accuracy, R1 result, stage, arrived
- Ops round tab auto-refreshes every 60s with manual refresh button and date filter

### src/components/layout/navConfig.tsx
- Added "Ops Round" nav entry pointing to `/ats/walkin-queue` with `roles: ["operations_manager"]` and `pageCode: "ATS_WALKIN_QUEUE"`
- Uses `ic(UsersRound)` icon (already imported)

## TypeScript Result
- Frontend: 0 errors
- Backend: 0 errors

## Concerns
- None. The feature is purely read-only; no existing write workflows were touched.
- The tab default is conditional on `roleKeys` from `useUserRole` which is async — on first render before data loads, `isOpsManager` is false so the tab defaults to 'queue' briefly. This is acceptable; once the role data loads it reflects correctly. An improvement would be to persist tab preference in localStorage.
- Branch matching in the SQL uses string equality between the candidate's branch name and the ops manager's branch record. If branch names differ from branch codes in some records, ops managers with `branch_id IS NULL` see all branches (global ops managers).
