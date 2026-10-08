# Employee Rejoin v3 — Branch head review UI (Plan 2b)

Spec: `docs/superpowers/specs/2026-10-03-employee-rejoin-v3-design.md` ("Branch head dossier", "Eligibility").
Contract: Plan 1 (`...-v3-core.md`) for the request routes, Plan 2a (`...-v3-dossier-api.md`) for
`GET /api/employees/reactivation/:id/dossier` → `{ success, data: Dossier }`.

## Goal

A branch head opens a pending rejoin request, sees the employee's whole previous stint on one page
(advisory verdict, live eligibility, 9 data sections) and approves or rejects it there. Approval is
final and activates the employee (backend). HR / admin see the same page read-only. The list page
drops the removed HR step and links into the review page.

## Files

| File | Purpose |
|---|---|
| `src/pages/RejoinReview.tsx` | Page: route param, `useQuery` on the dossier, layout, loading/error/404 |
| `src/components/employees/rejoin/rejoinTypes.ts` | Frontend mirror of `Dossier` + section types (backend files are not imported: they pull mysql2 into the app typecheck) |
| `src/components/employees/rejoin/rejoinReviewFormat.ts` | Pure helpers: dates (string math, no TZ shift), %, INR, tenure, labels, tones, monthly attendance % |
| `src/components/employees/rejoin/rejoinDecisionRules.ts` | Pure decision-bar rules (what is enabled and why) |
| `src/components/employees/rejoin/SectionCard.tsx` | Card shell driven by `SectionResult`, plus `NoData`, `StatTile`, `ChartTable` (sr-only data table) |
| `src/components/employees/rejoin/RejoinHeaderCard.tsx` | Identity, placement, tenure, dates, exit type/reason, request facts |
| `src/components/employees/rejoin/RejoinVerdictStrip.tsx` | Advisory rating + reasons; eligibility status + every reason |
| `.../AttendanceSectionCard.tsx`, `LateComingSectionCard.tsx`, `KpiSectionCard.tsx`, `LeaveSectionCard.tsx`, `LearningSectionCard.tsx`, `ConductSectionCard.tsx`, `ExitFileSectionCard.tsx`, `PayrollSectionCard.tsx`, `TimelineSectionCard.tsx` | One card per dossier section |
| `src/components/employees/rejoin/RejoinDecisionBar.tsx` | Approve / Reject, remarks, absconding ack, confirm dialog, mutation |
| `src/components/employees/rejoin/RaiseRejoinDialog.tsx` | Raise form moved out of the list page, with the eligibility error panel |
| `src/pages/NativeEmployeeReactivation.tsx` | List: Review/View links, HR final step removed, roles from `/api/access/me` |
| `src/config/routes/people.routes.tsx`, `src/lib/pageRoutePageCodes.ts`, `src/components/layout/navConfig.tsx` | Route, page-code pattern, `manager` on the list route + nav |

`mountedRoutePaths.ts` lists static paths only (its test strips `:param` routes), so the new
parameterised route is not added there.

## Page layout (top to bottom)

1. Back link + title. 2. Header card. 3. Verdict strip (rating, reasons, eligibility panel, "advisory"
note). 4. Two-column grid on `lg` (one column below): Attendance, Late coming, KPI, Leave, Learning,
Conduct, Exit file, Payroll, Timeline. 5. Decision bar (branch_head only) — sticky to the bottom of the
viewport below `md`, static card above.

## Section rendering

- Every card takes a `SectionResult<T>`. `status:'error'` → compact inline error (icon + "Could not load
  <section>" + backend message) and nothing else. Section-level empty → explicit "No data" line.
- `null` percentages/averages render "—", never `0%`. `pendingRecoveries === null` → "Unavailable".
- Attendance: KPI tiles (attendance %, absent, LOP, regularizations approved/rejected/pending) + 12-month bar
  chart of monthly attendance % (same formula as the backend total; month with 0 working days = gap).
- Late coming: bar chart of late marks by month + avg/month, avg minutes, worst month.
- KPI: bar chart of monthly achievement % with a "Target" reference line at 100 (backend caps at 100),
  months at target X/Y (Z%), best / worst month.
- Leave: table by type (requests, days, paid/unpaid, short notice, weekend-adjacent), totals, short-notice %
  labelled "applied at/after the day before start", weekend-adjacent % ("starts Monday or ends Friday").
- Learning: courses completed X/Y, average completion, certifications list.
- Conduct: disciplinary flag (and lift), warnings with severity chips (icon + text), PIPs, prior absconding
  exits / rejoins / rejoin requests, coaching sessions, open alerts.
- Exit file: type/sub-type, reason, absconding since, LWD, notice required vs served (+ shortfall),
  clearance X/Y + pending departments, assets still held, F&F status/amount/paid.
- Payroll: last net, average net, current gross/CTC, pending recoveries (or Unavailable), recent payslips.
- Timeline: vertical list newest first; `skipped.length > 0` → "may be incomplete (missing: …)".
- Charts use `ChartContainer` (`@/components/ui/chart`), theme tokens (`hsl(var(--chart-n))`), a
  `role="img"` + `aria-label` summary and an sr-only data table.

## Verdict / eligibility

Rating badge: Strong / Average / Weak / Insufficient data, each with its own icon + text. Reasons carry a
tone icon (check / alert / info) besides colour. Eligibility: status badge (Eligible / Needs review /
Blocked) + every reason with a severity chip (Blocked red, Review amber) and its code. Copy states the
rating is advisory and eligibility is re-checked by the server on approval.

## Decision rules (pure, `rejoinDecisionRules.ts`)

- Request not `pending` → both buttons disabled, reason shown.
- Remarks (trimmed) < 5 → both disabled with a counter.
- `eligibility.status === 'blocked'` → Approve disabled ("blocked: <first blocked reason>"); Reject allowed.
- `eligibility.requiresAbscondingAck` → Approve needs the ack checkbox and remarks >= 20 (backend rule).
- Approve opens a confirm dialog. Success: toast, invalidate dossier + reactivation queries, navigate to
  the list. Failure: backend message shown verbatim inline and in a toast; a returned `eligibility`
  triggers a dossier refetch so the panel shows the fresh verdict.

## States

Loading: skeleton header + cards. Query error: 403 → "not in your scope", 404 → "request not found",
else message + Retry. Blocked: verdict strip red + decision bar explains. Not pending: status banner,
decision bar disabled.

## Roles / routing

- `/employees/reactivation/:id/review`: `ProtectedRoute roles={branch_head, hr, admin, super_admin}` — the
  dossier API's `requireRole` exactly (payroll_head would only ever get 403) — plus pattern page code
  `EMPLOYEE_REACTIVATION` (granted in migration 1894 to those roles + payroll_head).
- List route + nav entry gain `manager` (an `AppRole`; `/initiate` accepts it).
- Decision bar only when the user's role keys include `branch_head` (`/branch-action` is branch_head only).

## Tests

- Vitest (node env, existing `vitest.config.ts`): `rejoinReviewFormat.test.ts`, `rejoinDecisionRules.test.ts`,
  and a `renderToStaticMarkup` test for the section shell (error / no data / null % → "—"), matching how
  the repo already tests components (no jsdom / testing-library).
- Guard suites: `mountedRoutePaths`, `page-access-deployment`, `page-catalog-route-drift`,
  `route-role-ceiling`, `app-shell-routing`, navigation tests — compared against a clean `origin/main`
  worktree to separate new from pre-existing failures.
- `npm run typecheck`, `npm run build`.
- Browser: vite dev server, dossier route stubbed (Playwright), desktop 1280 + mobile 390 for strong, weak
  with two section errors, blocked, absconder. A stubbed render is not a live audit.
