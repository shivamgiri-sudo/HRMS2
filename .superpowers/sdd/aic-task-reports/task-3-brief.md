### Task 3 — Frontend: extract three existing pages into panels

Pure refactor plus the three UI defects listed below. **No new features.** The exceptions page is
the healthiest surface in this group — preserve its behaviour exactly.

Create `src/pages/wfm/attendance-integrity/` and move the render bodies in:

- `ExceptionsPanel.tsx` — from `NativeAttendanceExceptionEngine.tsx`. Remove its `DashboardLayout`
  wrapper (line ~292) and its own page `<h1>`; the console shell owns both. Keep every
  filter, the deep-link `useSearchParams` wiring, the CSV export, the 403 branch, and the
  distinct empty state. Behaviour must not change.
- `MismatchesPanel.tsx` — from `NativeAttendanceMismatchQueue.tsx`, with fixes 3a/3b below.
- `BillingRulesPanel.tsx` — from `NativeAttendanceBillingConfig.tsx`, with fix 3c below.

**3a. 403 renders as success.** `NativeAttendanceMismatchQueue.tsx:122` is a bare
`catch { toast(...) }`; the table then shows a green checkmark reading **"No pending items"** over a
49,826-row backlog. Capture the status with `getHrmsApiErrorStatus` (the pattern
`NativeAttendanceExceptionEngine.tsx` already uses) and render a distinct forbidden state. Empty,
error, and forbidden must be three visually different things.

**3b. Search only filters the current page.** `filteredRecords` (line ~174) filters the 50 rows
already on screen. Across ~997 pages it finds nothing. Send `search` to the API (Task 1g) with a
debounce, and reset to page 1 on change. Delete the client-side filter.

**3c. Write controls render for roles the API refuses.** `NativeAttendanceBillingConfig.tsx` never
imports `useWorkforceAccess`, so New Rule / Edit render for `hr`, `wfm` and `admin` (API allows
`finance_head`, `super_admin`) and Deactivate renders for `finance_head` (API allows `super_admin`).
Gate each control on `isResolved && canEditPage("ATTENDANCE_BILLING_CONFIG")` — and note the hook's
documented caveat: `canEditPage` returns false for every code until `isResolved` is true, so gating
without it flickers the control off on first render. Where the DB grant is broader than the API
(admin has `can_edit=1` but the API refuses admin), the control must still not render — say so in
the report so the residual `role_page_access` row can be corrected separately.

Also apply Global Constraints 6-8 to the two weaker panels: the mismatch summary row is
`grid grid-cols-3` with no breakpoints (three cards crushed at 375px) and its tiles must be
relabelled to match the window the list is actually showing (Task 1f).

Run after: `npm run typecheck`

