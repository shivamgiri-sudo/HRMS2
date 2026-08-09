# WFM Roster Deep Code Audit

## Files inspected

```text
src/pages/NativeWFMRoster.tsx
backend/src/modules/wfm/roster.routes.ts
backend/src/modules/wfm/roster.controller.ts
backend/src/modules/wfm/roster.service.ts
```

## Concrete code findings

1. Frontend actual assignment request uses `limit=500` and no page/search/status params.
2. Backend controller actual assignment schema supports only `processId`, `fromDate`, `toDate`, and `limit`.
3. Backend service actual assignment query supports only process/date filters.
4. Backend service returns only array data, no total/page/limit metadata.
5. `listActualAssignments` has no employee search by employee code or name.
6. `listActualAssignments` has no branch filter.
7. `listActualAssignments` has no roster status filter.
8. `listActualAssignments` has no publish status filter.
9. Actual roster table in UI is capped by max-height scroll but not true pagination.
10. Draft assignment UI uses raw JSON input.
11. Shift/process selectors are native HTML controls.
12. CSV upload maps uploaded employee code into `employeeId`, so upload flow needs employee-code resolution validation before insert.
13. Publish plan updates all assignments for plan at once and needs visible pre-publish review count.
14. Service does not return coverage summary counts for the page.

## Required backend changes

Add filters to actual assignment endpoint:

```text
page
limit
search
branchId
processId
fromDate
toDate
rosterStatus
publishStatus
```

Return shape for new version:

```json
{
  "success": true,
  "data": [],
  "total": 0,
  "page": 1,
  "limit": 50
}
```

Keep old response compatibility if needed by adding a new endpoint:

```text
GET /api/wfm/roster/actual-assignments-v2
```

## Required frontend changes

```text
Replace raw JSON draft allocation with roster grid.
Add employee search.
Add date range filter.
Add branch/process/shift/status filters.
Add pagination.
Add summary cards.
Add calendar/timeline view.
```

## Priority fixes

P0:

```text
Pagination/search/filter in actual assignments.
Employee-code validation for CSV upload.
Grid editor instead of JSON.
```

P1:

```text
Coverage summary.
Pre-publish review panel.
Roster audit drawer.
Employee acknowledgement view.
```
