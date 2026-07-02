# ATS Dashboard Deep Code Audit

## Files inspected

```text
src/pages/NativeATSDashboardReplica.tsx
src/lib/atsDashboardReplicaAdapter.ts
```

## Concrete findings

1. `getCachedCandidateList(3000)` pulls up to 3000 candidate rows into the browser.
2. The cache is only 60 seconds, so auto-refresh can still move heavy data every minute.
3. Filters are generated from candidate rows, not active master data.
4. Candidate row types include mobile and email fields.
5. Queue rows include recruiter mobile and candidate email.
6. Dashboard period logic runs in the page while data normalization runs in the adapter.
7. Native HTML selects are used, so shared Select styling/readability does not apply.
8. Candidate journey search scans ID, token, email, mobile, and name in the browser.
9. Queue and table sections have no server-side pagination.
10. Grouping/summary calculations are repeated in browser memory.
11. The adapter has empty assignment/submission maps, so some recruiter/process/stage data is best-effort only.
12. Some labels are hardcoded strings, so status taxonomy can drift from backend.

## Required fixes

P0:

```text
Move summary, queue, candidates, recruiter, source and rejection calculations to backend.
Add server-side pagination/search/filter APIs.
Mask mobile/email by role.
Replace native selects with shared filter controls.
Use active master options for branch/process/recruiter filters.
```

P1:

```text
Create shared ATS metric cards and tables.
Add saved views.
Add export audit.
Add SLA action workflow.
```

## Safe frontend patch

Replace page-level native select controls with shared `Select` controls, or add a local readable class until full refactor.

## Recommended API shape

```text
GET /api/ats/dashboard/summary
GET /api/ats/dashboard/queue?page=&limit=&search=&branchId=&processId=&status=
GET /api/ats/dashboard/candidates?page=&limit=&search=&branchId=&processId=&status=
GET /api/ats/dashboard/recruiters?page=&limit=&period=
GET /api/ats/dashboard/sources?page=&limit=&period=
```
