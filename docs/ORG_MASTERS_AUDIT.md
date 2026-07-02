# Org Masters Audit

## Page checked

```text
/org-masters
```

File:

```text
src/pages/NativeOrgMasters.tsx
```

## Current strengths

- Page is already page-code gated in App.
- Supports multiple master tabs:
  - Branches
  - Departments
  - LOBs
  - Designations
  - Campaigns
  - Cost Centres
  - Grade Bands
- Add/edit/delete modal exists.
- Admin/HR gating exists through `useIsAdminOrHR`.
- Active detection helper already exists for mixed schemas.
- Basic premium card style is present.

## Issues found

1. No search field per master tab.
2. No Active / Inactive / All toggle.
3. No pagination for large master lists.
4. No dependency impact warning before deactivating/deleting a master.
5. No duplicate-code validation visible in UI.
6. No export option for master data.
7. No audit drawer per master record.
8. No effective-date/versioning for masters used in payroll or reports.
9. Deleting/deactivating a master can break filters/reports if dependencies are not checked.
10. Master data is not yet aligned with the global filter endpoint everywhere.

## Required enhancements

### Search and filters

Each tab should have:

```text
Search by name/code
Status: Active / Inactive / All
Created/updated date filter where available
Clear filters
```

### Pagination

Use shared server pagination once backend supports it:

```text
GET /api/org/:master?page=&limit=&search=&status=
```

Response format:

```json
{
  "success": true,
  "data": [],
  "total": 0,
  "page": 1,
  "limit": 50
}
```

### Dependency impact warning

Before deactivate/delete, call an impact endpoint:

```text
GET /api/org/:master/:id/impact
```

Return:

```text
employees linked
open payroll runs affected
attendance records affected
reports affected
active processes/cost centres linked
```

Show warning:

```text
This department is linked with 187 active employees and 3 active payroll/report mappings. Deactivation will hide it from filters but preserve historical records.
```

### Delete policy

Avoid hard delete for masters used historically.

Recommended policy:

```text
Use deactivate instead of delete.
Keep historical records intact.
Hide inactive masters from filters by default.
Allow Include inactive toggle in admin pages only.
```

### Role access

```text
Admin: create/edit/deactivate/delete with impact warning
HR: create/edit/deactivate if configured
Manager/TL/Employee: read active options only through /api/org/filter-options
Finance/Payroll: read cost centres, branches, departments where scoped
```

### Premium UI improvements

Use enterprise master-data layout:

```text
Hero: Organisation Masters
KPI cards: Active branches, active departments, active processes, active cost centres
Tabbed master cards
Search/filter toolbar
Dependency impact side drawer
Audit trail drawer
```

## Global filter dependency

All pages should use:

```text
GET /api/org/filter-options
```

for active-only branch/department/process/cost-centre/designation/location/manager filter dropdowns.

## Priority

P0:

```text
Search per tab
Active/inactive toggle
Dependency impact before delete/deactivate
Hide inactive masters from regular filters
```

P1:

```text
Pagination
Export
Audit drawer
Versioning/effective date for critical masters
```
