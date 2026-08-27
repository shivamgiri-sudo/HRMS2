### Task 2 — Backend: COSEC monitoring + billing-config API alignment

**2a. `cosecMonitoringRouter` roles** (`backend/src/modules/peopleos/peopleos.routes.ts`).
Currently `requireRole("admin","hr","ceo","wfm")` while the page code `WFM_LIVE_TRACKER` grants
view to `super_admin, branch_head, branch_wfm, manager, process_manager, wfm`.
Widen to the union of both sets. This data is read-only device/run health with no per-employee
rows in the three run endpoints, so no scoping is required for them.
`GET /latest-punches` **does** return per-employee rows — leave its role list at the narrower
`admin, hr, ceo, wfm, super_admin` OR scope it; pick one and say which in the report. Do not
return per-employee punches to a role that cannot otherwise see that employee.

**2b. `getCosecMonitoring` does 4 queries and throws 3 away.**
(`backend/src/modules/peopleos/peopleos.service.ts:527`) Every one of the four endpoints calls the
same function, so `/sync-status` runs the 100-row punch join and the two 50-row run queries and
discards them. Split it into focused readers so each endpoint issues only the queries it returns.
Keep the existing SQL verbatim — it was fixed once already (the `biometric_punch` table never
existed; the live table is `biometric_attendance_log`) and that comment block must survive.

**2c. Billing-config GET roles** (`backend/src/modules/attendance/billing-config.routes.ts:24`).
`ATTENDANCE_BILLING_CONFIG` grants view to `super_admin, admin, finance_head, hr, wfm`; the list
endpoint accepts `finance_head, super_admin, admin, hr`. Add `wfm` — today `wfm` can open the page
and the list 403s.
Leave every write endpoint's roles unchanged: create/update stay `finance_head, super_admin`,
delete stays `super_admin`. This table drives the extra-day-salary rule in
`payrollCalculate.service.ts`, so the write surface stays narrow; the UI is fixed to match in
Task 3c rather than the API being widened to match the UI.

Tests: `backend/src/__tests__/cosec-monitoring.roles.contract.test.ts` (new) — assert a
`process_manager` gets 200 on `/sync-runs`, and that `/sync-status` no longer issues the punch
query. Plus one case for 2c.
Run: `cd backend && npx vitest run src/__tests__/cosec-monitoring.roles.contract.test.ts`

