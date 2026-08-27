### Task 6 — Routes, redirects, navigation, inbound links, tests

**6a. Route** (`src/config/routes/workforce.routes.tsx`): add `/wfm/attendance-integrity`
-> `<ProtectedRoute><DashboardLayout><AttendanceIntegrityConsole /></DashboardLayout></ProtectedRoute>`.
No `Gate` wrapper (Task 5 explains why). Note the existing routes are inconsistent about
`DashboardLayout` — exceptions and cosec self-wrap, billing and mismatch are wrapped by the route.
After the merge there must be exactly one wrapper, in the route.

**6b. Redirects preserving the query string.** A bare `<Navigate to>` drops the search string, and
the live dashboards deep-link with params. Write one small redirect component that reads
`useLocation().search` and forwards it with the tab appended:

| From | To |
|---|---|
| `/wfm/attendance-exceptions` | `/wfm/attendance-integrity?tab=exceptions&<original params>` |
| `/wfm/mismatch-queue` | `?tab=mismatches&<original params>` |
| `/wfm/cosec-monitoring` | `?tab=biometric` |
| `/attendance/billing-config` | `?tab=billing` |

**6c. `src/lib/pageRoutePageCodes.ts`** currently maps `/wfm/mismatch-queue` and
`/wfm/attendance-exceptions`. Those routes now redirect. Update per that file's own convention —
do not leave a mapping pointing at a route that no longer renders a page.

**6d. `src/components/layout/navConfig.tsx:246-249`** — replace the four sibling entries under
"Live Monitoring" with a single **"Attendance Integrity"** entry pointing at the new route.
Note the entries are inconsistent today (two use `pageCode`, two use `roles`); the merged entry
should use `pageCode: "WFM_ATTENDANCE_EXCEPTIONS"` as its visibility hint — it is the broadest of
the three grants — and the console's own per-tab gating does the real work.

**6e. Inbound links.** Update every caller to the new route + tab. Confirmed call sites:
- `src/pages/dashboards/reference/ReferenceSharedPanels.tsx` — 8 links, several carrying
  `?issueType=...&status=open`; preserve every param exactly.
- `src/pages/dashboards/reference/ReferenceDashboardShell.tsx` — 2 ("Devices")
- `src/pages/dashboards/reference/WfmAttendanceReferenceLayout.tsx` — 2
- `src/pages/NativeConfigurationCenter.tsx` — 1
- the cross-links the two queue pages hold to each other become tab switches, not navigations.

**6f. Tests.** `src/tests/app-shell-routing.contract.test.ts` asserts the old nav labels and paths
at lines 55-56 and 87-88 — update to the merged entry. `e2e/pending-items.smoke.ts:76` checks
`/wfm/mismatch-queue` is reachable — it must still pass via the redirect; if it cannot, update it.
Add a test that each old path redirects to the right tab **with its query string intact** — that is
the regression this task most needs to prevent.

**6g.** Delete the four now-unused page files only after everything above passes:
`NativeCosecSyncMonitoring.tsx`, and the three whose bodies moved in Task 3. Check for other
importers first.

Run after: `npm run typecheck` and `npx vitest run src/tests/app-shell-routing.contract.test.ts`

