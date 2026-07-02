# WFM Roster Technical Audit

## Page checked

```text
/wfm/roster
```

File:

```text
src/pages/NativeWFMRoster.tsx
```

## Strengths

- Roster governance page exists.
- Process selection exists.
- Shift template creation exists.
- Weekly cycle creation exists.
- Actual roster assignments are displayed.
- Coverage action form exists.
- Roster lifecycle statuses exist.

## Issues

1. Uses native HTML select instead of shared Select.
2. Process list should be active-only and role-scoped.
3. Actual assignments use fixed `limit=500`.
4. No server-side pagination.
5. No search by employee name/code.
6. No date, branch, shift, roster status, publish status, acknowledgement filters.
7. Draft assignments use raw JSON input.
8. No roster grid editor.
9. No calendar/timeline view.
10. No visible audit trail drawer.
11. Role-specific action visibility needs review.

## Required improvements

```text
Use shared filter controls.
Add server-side pagination/search.
Add active-only process options.
Replace JSON assignment input with grid editor.
Add date/shift/status filters.
Add employee acknowledgement view.
Add audit trail panel.
```

## Recommended grid

```text
Rows = employees
Columns = dates
Cells = shift / week off / leave / holiday
```

## Priority

P0:

```text
Pagination and search for actual roster records.
Grid editor instead of JSON.
Role scoped process list.
Readable shared dropdowns.
```

P1:

```text
Calendar timeline.
Audit trail drawer.
Employee acknowledgement self view.
Coverage summary cards.
```
