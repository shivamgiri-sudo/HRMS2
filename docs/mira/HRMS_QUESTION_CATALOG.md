# Mira HRMS Question Catalog

**Purpose.** A grounded inventory of the questions a real HRMS user (employee, manager, HR, finance, admin) might ask Mira, mapped to the real backend data source that should answer each one, its RBAC scope, and whether Mira already covers it. Built 2026-08-06 by reading the actual route files, service files, and SQL migrations across every module — not guessed, and not a synthetic training set. This is a working backlog, not a finished feature list: **most rows are still GAP**.

**Why this exists instead of "train Mira on 10,000 questions."** Mira's intent detection is a small, fast, auditable set of regex-pattern rules (`ai-account.service.ts` for self-account data, `ai-howto-catalog.ts` for navigation), not a model you feed examples to. The real lever for "Mira handles more of HRMS" is: for each question a real user actually asks, confirm the backend already has the right data/endpoint, write one precise pattern for it, wire it to the right query, and test it. This document is the map of where that work is real and where it's needed — a handful of the entries below have already been closed as a result of building this (see "Status" section).

**How this was built.** Five research passes, one per module cluster, each independently reading:
- The real mounted frontend routes (`src/config/routes/*.tsx`)
- The real backend route files and their RBAC (`requireRole`, `hasRole`, scope checks)
- The real SQL schema (migrations under `backend/sql/`, not assumed column names)
- `ai-account.service.ts` (self-account data intents) and `ai-howto-catalog.ts` (navigation intents) in full, to mark each question as **ALREADY COVERED** or **GAP**

Every citation below is `file:line`, verified against the actual code at research time (2026-08-06). Code changes since then (including several made in the same session, see "Status") are not reflected in the GAP/COVERED marks below unless noted.

---

## Status — closed since this catalog was built (2026-08-06, same session)

- ✅ `leave_status` — "what's the status of my leave request" (was GAP, closed)
- ✅ `holidays` — "when is the next holiday" (was GAP, closed)
- ✅ `resignation` — "what's my resignation status / last working day / notice period" (was GAP, closed)
- ✅ Reimbursement `rejection_reason` now rendered (was selected but not shown)
- ✅ Two real live bugs found *while researching this*, unrelated to coverage gaps, fixed separately:
  - `TeamAttendanceTab.tsx` always 400'd — a route collision on `/api/wfm/attendance/daily` shadowed the correctly-scoped handler
  - `roster.governance.routes.ts`'s `/my-cycles` and `/my-roster/:cycleId` are dead code (documented, not fixed — see file comments)

Everything else below is still open.

---

## Coverage summary

| Area | Already covered | Gap | Notes |
|---|---|---|---|
| Employee Profile | 7 | 13 | `profile` intent covers name/code/joining date/manager/branch/process only |
| Attendance | 11 | 10 | Self-service well covered; **zero** manager team-attendance coverage |
| Leave | 6 (+3 new) | 12 | Balance well covered; eligibility, history, cancellation open |
| WFM / Roster | 3 (+1 implicit) | 18 | Self roster (7-day) covered; nothing for preferences, swaps, acknowledgement |
| Payroll / Salary / Payslip | 10 | 11 | Latest run covered; history, CTC, UAN/PF, certificates open |
| Reimbursements | 8 (+1 fixed) | 8 | Status/history covered; team approval queue, policy limits open |
| Loans | 4 | 12 | Balance/EMI covered; schedule, payoff date, guarantor open |
| Tax Declaration | 1 (how-to only) | 16 | Navigation covered; **zero** data coverage (declared amounts, TDS projection) |
| F&F / Gratuity | 1 (how-to, upstream step only) | 17 | **Total gap** — no self-service backend route even exists yet |
| ATS / Recruitment | 0 | 19 | **Total gap** |
| Onboarding | 4 | 12 | Basic profile fields covered via `profile`; joining docs/kit/BGV open |
| Documents / Assets | 2 | 14 | Generic doc verification covered; assets, joining-specific docs open |
| Resignation / Exit | 2 (how-to only, +1 new) | 15 | Navigation to the two pages covered; almost all status data was gap |
| KPI / Performance | 4 | 13 | Self KPI via `coach` covered reasonably; **zero** manager-scope KPI |
| Operations / Quality | 0 | 15 | **Total gap** — QA scores, call quality, live ops all uncovered |
| LMS / Training | 1 (how-to only) | 13 | Navigation covered; progress/certification/team-readiness all gap |
| Helpdesk / Grievances | 2 | 18 | Self ticket/grievance status covered; everything manager/admin gap |
| Client Portal | ~1 (indirect) | 16 | Separate auth system; navigation-only scaffold exists, unwired to any UI |
| ERP (procurement/vendor/GRN/billing) | 2 (reimbursements) | 20 | Only the reimbursement pair overlaps; rest untouched |
| Integration Hub | 0 | 15 | **Total gap**, and admin-only by design |
| RBAC / Access Admin | ~1 (indirect, via `getAccessMe`) | 19 | No conversational coverage; `getAccessMe` underlies every howto RBAC check |

**Total: roughly 70 already covered (including today's closures) against 330+ real, cited gaps.**

---

## 1. Employee Profile

Routes: `/profile` (`platform.routes.tsx:106`), `/employees`, `/employees/:id`, `/employees/:id/360`, `/org-chart`, `/my-team`, `/employee-journey`, `/employees/:employeeId/complete-profile`, `/employees/:employeeId/epf-compliance`, `/employees/:employeeId/joining-documents`, `/employees/bgv-status[/:employeeId]`, `/employee-lifecycle` — all in `src/config/routes/people.routes.tsx`.

| Question | Data source | Coverage |
|---|---|---|
| Employee code / joining date / designation | `employees` join, `ai-account.service.ts:290-298`, intent `profile` | ✅ COVERED |
| Reporting manager | same | ✅ COVERED |
| Branch / process | same | ✅ COVERED |
| How do I update my profile? | `/profile` nav | GAP — not in howto catalog |
| My documents / pending verification | `employee_documents`, intent `documents` | ✅ COVERED |
| Employment history / journey | `employee_journey_log`, intent `journey` | ✅ COVERED |
| Full account summary | composite, intent `account_overview` | ✅ COVERED |
| Manager: view an employee's 360 profile | `GET /api/employees/:id`, `employee.routes.ts:1247` | GAP |
| Manager: how many direct reports do I have | `GET /api/management/team-members`, `management.routes.ts:128` | GAP |
| Who is my skip-level / branch head | employee self-join chain | GAP |
| How do I raise an RM (reporting manager) change | `rm-change.routes.ts` | GAP |
| Is my EPF/UAN KYC complete | `/employees/:employeeId/epf-compliance` | GAP |
| BGV status | `employee-bgv.service.ts`, `GET /api/bgv/employee/me` | GAP |
| My employee ID / UAN / PAN | `employees` columns not currently SELECTed by `profile()` | GAP — data model gap too |
| Org chart navigation | `/org-chart` | GAP |
| Access to `/my-team` | `people.routes.tsx:117` | GAP |
| Another employee's profile/salary | cross-employee guard | ✅ COVERED (refused correctly) |
| Onboarding profile completion (HR-run) | `/employees/:employeeId/complete-profile` | GAP (admin/hr/super_admin only, not self) |

---

## 2. Attendance

Routes: `/attendance`, `/attendance/biometric-logs[/:employeeId]`, `/attendance-regularization`, `/attendance/disputes`, `/wfm/mismatch-queue`, `/wfm/attendance-exceptions`, `/attendance-rules-master`, `/hr/attendance-lookup`, `/wfm/live-tracker` — `src/config/routes/workforce.routes.tsx`.

| Question | Data source | Coverage |
|---|---|---|
| Was I late today / present days this month / punch today | `attendance_daily_record`, intent `attendance` | ✅ COVERED |
| LWP days this month | same | ✅ COVERED |
| How do I regularize a missed punch | how-to `attendance_regularization`, `ai-howto-catalog.ts:163-177` | ✅ COVERED |
| Status of my regularization request | `GET /api/wfm/regularizations/mine` | GAP |
| How do I raise an attendance dispute | `attendance.dispute.routes.ts` | GAP |
| How many hours this **week** | `attendanceScope()` doesn't recognize "week" — falls back to month-to-date, wrong scope | GAP (partial — silently wrong, not just missing) |
| Manager: who hasn't punched in today | `wfm_roster_assignment` + `wfm_attendance_session`, `getLiveTracker()` | GAP |
| Manager: team present/absent count today | `GET /api/management/team-overview` | GAP |
| Manager: team attendance for today | `GET /api/wfm/attendance/daily` (**fixed 2026-08-06** — was 400ing, see Status) | now reachable, still no Mira intent |
| Biometric punch logs | `/attendance/biometric-logs` | GAP |
| Why is my attendance showing a mismatch | `/wfm/mismatch-queue` | GAP |
| HR: look up an employee's attendance | `/hr/attendance-lookup` | GAP |
| Late marks this **quarter** | `attendanceWindow()` supports arbitrary spans (used by `coach`) but the plain `attendance` intent doesn't expose "quarter" | GAP (partial) |
| What counts as late/half-day (policy) | `/attendance-rules-master`, admin-facing, no employee FAQ answer exists | GAP |
| Manager: approve a team regularization | `PATCH /api/wfm/regularizations/:id/review` | GAP — not in howto catalog |

---

## 3. Leave

Routes: `/leaves` (apply + approve), `/leave-types`, `/maternity-leave`, `/calendar`.

| Question | Data source | Coverage |
|---|---|---|
| Leave balance (any type) | `leave_balance_ledger`, intent `leave` | ✅ COVERED |
| How do I apply for leave | how-to `leave_apply` | ✅ COVERED |
| How do I approve/reject a team leave request | how-to `leave_approve` | ✅ COVERED |
| Status of my leave request | `leave_request`, intent `leave_status` | ✅ COVERED (closed 2026-08-06) |
| Next holiday / holiday calendar | `leave_holiday_master`, intent `holidays` | ✅ COVERED (closed 2026-08-06) |
| What leave types am I eligible for (gender-gated ML/PL) | `GET /api/leave/eligibility/:employeeId` | GAP |
| Leave history from before HRMS migration | upstream `leave_management` (read-only) | GAP |
| Manager: who's on leave today / pending requests for my team | `GET /api/leave/requests?status=&activeOn=`, already scope-built server-side | GAP |
| How is my balance calculated (carry-forward vs new) | `leave_balance_ledger.adjusted_days`/`allocated_days` | GAP |
| Can I cancel a submitted leave request | `leave_request.status` update path exists in service | GAP |
| Maternity leave specifically | `/maternity-leave` route is **HR-admin only**, not self-service — real self-service path is the generic `/leaves` apply flow with leave type ML | GAP + a UX trap worth flagging |
| Leave type policy metadata (max days, carry-forward rules) | `GET /api/leave/types`, viewable by anyone | GAP |
| Prior-year leave balance (e.g. 2025) | `leave()` hardcodes current year only | GAP (partial — silently wrong year, not just missing) |

---

## 4. WFM / Roster

Routes: `/wfm/roster`, `/wfm/roster-workspace`, `/my-roster`, `/roster-preference`, `/week-off-preferences`, `/wfm/live-tracker`, `/wfm/cosec-monitoring`, and 15+ more admin/WFM pages — `workforce.routes.tsx:81-105`.

| Question | Data source | Coverage |
|---|---|---|
| My shift tomorrow / next week off | `roster_daily_assignment`, intent `roster` (bounded to next 7 days) | ✅ COVERED |
| Manager: view team roster | how-to `team_roster_view` | ✅ COVERED |
| Can I swap my week off | `POST /api/roster-gov/weekoff-preferences` — one-sided preference request, **not** a peer swap | GAP — and the real feature doesn't match the natural phrasing |
| Can I swap my shift with a colleague | `wfm_shift_swap_request` table exists but **no submission endpoint found anywhere** — reporting-only | GAP, and don't assume this feature exists end-to-end |
| How do I acknowledge my published roster | `POST /api/roster-gov/assignments/:id/acknowledge` | GAP |
| How do I dispute a roster assignment | `POST /api/roster-gov/assignments/:id/dispute` | GAP |
| Manager: who's scheduled today / pending week-off approvals | `GET /api/wfm/live`, `GET /api/wfm/roster-preferences/pending` | GAP |
| How do I submit my roster/shift preference | `POST /api/wfm/roster-preferences` — self-service, `requireAuth` only | GAP — genuinely self-service, uncatalogued |
| Is my roster published yet | implicit in `roster` intent's empty-state message | ✅ COVERED (implicitly) |
| **Known route-drift, verify before building on it**: `GET /api/wfm/attendance/daily` was double-defined (fixed 2026-08-06); `GET /api/roster-gov/my-cycles` and `/my-roster/:cycleId` are still double-defined (documented as dead code in `roster.governance.routes.ts`, not fixed) | — | — |

---

## 5. Payroll / Salary / Payslip

Routes: `/payroll/payslips`, `/payroll/running-breakdown`, `/payroll/salary-certificates`, `/payroll/tds-certificate-part-a`, `/salary-increment`, `/profile` (bank/UAN section).

| Question | Data source | Coverage |
|---|---|---|
| Latest net pay / salary breakup | `salary_prep_line`, intent `salary` | ✅ COVERED |
| Download payslip | how-to `payslip_download` | ✅ COVERED |
| Payroll readiness / why is payroll blocked | `payroll_readiness_snapshot`, intent `payroll_readiness` | ✅ COVERED |
| Why is my salary less this month (comparison) | same table, no month-over-month diff logic exists | GAP |
| PF/UAN number | `employee_uan`, not selected by `profile()`/`salary()` | GAP |
| Employer PF/ESIC contribution | `salary_prep_line.pf_employer`/`.esic_employer` exist, not selected | GAP |
| Is my bank account verified | `employee_bank_details` | GAP |
| How do I acknowledge my payslip | `salary_payslip.acknowledged_at` | GAP |
| My CTC | `employees.ctc` / `employee_salary_assignment` | GAP |
| Historical payslips (last 6 months) | `salary()` only fetches the latest run, no history list | GAP |
| Salary certificate / employment letter | `salary_certificate_request` — real backend, zero Mira coverage | GAP |
| Salary increment / next increment date | `/salary-increment` page, zero Mira coverage | GAP |

---

## 6. Reimbursements

| Question | Data source | Coverage |
|---|---|---|
| How do I raise / status of my claim | how-to `reimbursement_raise` + intent `reimbursements` | ✅ COVERED |
| How do I approve a team claim (manager excluded, unlike leave) | how-to `reimbursement_approve` | ✅ COVERED |
| Why was my claim rejected | `rejection_reason` | ✅ COVERED (closed 2026-08-06 — was selected, not rendered) |
| Total claimed this year (yearly sum) | no aggregation exists, only last-10 list | GAP |
| Documents needed for a claim type | no policy text anywhere | GAP |
| Edit/delete a draft claim | `DELETE /:id`, draft-only | GAP |
| Submit a draft claim for approval | `POST /:id/submit` | GAP |
| Manager/finance: pending approval queue | `GET /` list, role-scoped | GAP (out of self-account scope by design) |

---

## 7. Loans / Salary Advances

| Question | Data source | Coverage |
|---|---|---|
| Active loan / pending amount / EMI | `employee_loans`, intent `loans` | ✅ COVERED |
| Remaining installments | requires deriving from `/schedule`, not currently done | GAP |
| Projected payoff date | `end_date` or last row of schedule | GAP |
| How do I apply for a loan/advance | **no self-service creation endpoint exists** — explicitly excluded in the how-to catalog's own header comment as "investigated and excluded" | GAP, confirmed no path exists |
| Repayment schedule | `GET /:id/schedule` | GAP |
| Guarantor name | `.guarantor_name` | GAP |
| Manual/early repayment | payroll/finance/admin only, employee cannot self-record | GAP + a real "no you can't" answer needed |

---

## 8. Tax Declaration

Route: `/payroll/tax-declaration`.

| Question | Data source | Coverage |
|---|---|---|
| How do I submit my tax declaration | how-to `tax_declaration_submit` | ✅ COVERED (navigation only) |
| Declared 80C / HRA / 80D / NPS amounts | `tax_declaration`, `tax_declaration_form12bb_detail` | GAP — **zero data intent exists at all** |
| Have I submitted for this FY | same tables | GAP |
| Projected TDS for the year | `.tds_projected` (computed, config-gated per CLAUDE.md) | GAP — only the *actual monthly deducted* TDS is covered, not the annual projection |
| Old vs new regime | `.regime` | GAP |
| Declaration history (previous years) | `listHistory()` exists, unused by Mira | GAP |
| **Note**: no document/proof-upload fields exist in either table — may be a real product gap, not just a Mira gap | — | — |

---

## 9. F&F (Full & Final Settlement) / Gratuity

| Question | Data source | Coverage |
|---|---|---|
| Is my F&F settled | `full_final_calculation.status` | GAP — **no self-service backend route exists at all**; `/ff` endpoints are admin/hr/finance/payroll only |
| My gratuity amount / eligibility | same table / `calculateGratuityFromEmployee()` | GAP, and must stay "draft, requires verification" per CLAUDE.md, never a final figure |
| Why is my F&F blocked ("provisional") | `.is_ff_provisional` flag | GAP |
| Notice-period recovery in my F&F | `.notice_recovery` | GAP |
| Gratuity nominee split | `gratuity_distribution` / `employee_nominee` | GAP |
| HR: approve an F&F (admin-only, narrower than create/view) | `POST /ff/:id/approve`, `admin` only | GAP — no how-to entry exists |

This entire area needs a **new self-service backend endpoint before any Mira intent can safely exist** — closing this is backend work first, Mira work second.

---

## 10. ATS / Recruitment

**Zero Mira coverage of any kind.** Candidate-facing questions (application status, documents needed, interview result, BGV, offer letter) use a separate token-based candidate auth (`candidateAuth` middleware), not Mira's RBAC-role model at all — a genuinely different integration shape. Recruiter/HR-facing questions (pipeline counts, time-to-hire, sourcing channel performance, offer approval) are all real, working, role-scoped endpoints (`ats.service.ts`, `job-requisition.routes.ts`) with no Mira mapping.

19 questions catalogued, all GAP. See commit history / session notes for the full table if rebuilding this area.

---

## 11. Onboarding

| Question | Data source | Coverage |
|---|---|---|
| Employee code / joining date / manager / branch (new joiner) | `profile` intent (generic, overlaps here) | ✅ COVERED |
| Joining documents still needed | `employee_joining_document_checklist` — **distinct table** from the generic `employee_documents` the `documents` intent reads | GAP |
| Is my joining kit ready/dispatched | `employee_joining_esign_kit` | GAP |
| EPF/UAN compliance status | EPF-specific tables, separate route | GAP |
| HR: pending onboarding approvals | `ats_onboarding_bridge` | GAP |

---

## 12. Documents / Assets

| Question | Data source | Coverage |
|---|---|---|
| My pending/verified documents | `employee_documents`, intent `documents` | ✅ COVERED |
| Assets assigned to me (laptop, ID card, etc.) | `asset_assignment`, `GET /api/assets/employee/:employeeId` — self-or-admin | GAP |
| How do I upload a document | `employee.documents.routes.ts` | GAP |
| Can I delete my own document | **no** — `admin`/`hr` only, not self | GAP, and the honest answer is "no" |
| Public: verify an appointment letter / employee ID by QR | token/public routes | GAP (not self-account-shaped, would need its own path) |

---

## 13. Resignation / Exit

| Question | Data source | Coverage |
|---|---|---|
| How do I submit my resignation | how-to `resignation_raise` | ✅ COVERED |
| How do I approve a resignation | how-to `resignation_approve` | ✅ COVERED |
| My resignation status / last working day / notice period | `exit_request`, intent `resignation` | ✅ COVERED (closed 2026-08-06) |
| Can I withdraw my resignation | `POST /:exitId/withdraw`, self-ownership-checked | GAP |
| Did I get a retention offer / how do I respond | `retention_offer` — **the respond endpoint has no `requireRole` at all**, effectively open to the employee | GAP, and a good self-service candidate |
| HR: how many exits pending review company-wide | `getExitStats()` | GAP |
| **Data-model flag**: `exit_clearance_task` is referenced across 15 active backend files with **no CREATE TABLE anywhere** in `backend/sql/` — the actually-migrated table is `exit_clearance_checklist`. Verify against the live DB schema before building anything on top of "exit clearance" data. | — | — |

---

## 14. KPI / Performance

| Question | Data source | Coverage |
|---|---|---|
| My KPI score / am I hitting target / how's my performance | `kpi_daily_actual` via `coach` intent | ✅ COVERED |
| My locked scorecard history | `kpi_score_summary` — **different table** from what `coach` reads | GAP |
| Month-over-month KPI improvement | `coachKpis()` only does a rolling 90-day average, no trend | GAP |
| My PIP status | `pip_record` | GAP |
| My leaderboard rank | `GET /api/kpi/leaderboard` — note: **not** open to plain `employee` role at all | GAP, and likely a real RBAC surprise if a plain agent asks |
| Manager: team KPI performance / who's below target | `coach`'s team view is **attendance-only** (`buildTeamPoints` has no KPI field at all) | GAP — a real, notable coverage hole given how much self-KPI *is* covered |

---

## 15. Operations / Quality

**Zero Mira coverage of any kind.** QA audit scores (`qa_audit`, with an explicit self-only carve-out already built into the route — "unprivileged callers get their own record regardless of what they asked for"), call quality trends (`db_audit.call_quality_assessment`, an upstream read-only source), live ops tracker, executive quality dashboards — all real, working, RBAC-correct endpoints with no Mira mapping at all.

---

## 16. LMS / Training

| Question | Data source | Coverage |
|---|---|---|
| How do I access my training | how-to `lms_access` | ✅ COVERED (navigation only) |
| My course progress / completion % | `lms_learning_progress_snapshot`, `GET /api/lms/progress/me` — self-only, ready to use | GAP |
| Am I certified / completed mandatory training | `lms_certification_snapshot`, `GET /api/lms/certifications/me` — self-only, ready to use | GAP |
| Manager: who hasn't completed training | live read-through to the **external LMS DB** (`batch_master`, `trainee_master`) — a genuinely different query shape than the synced snapshot tables | GAP |
| Team training readiness / handover status | `lms_learner_progress` (readiness_score, attrition_risk_signal) — note: role list is `admin/hr/super_admin/operations_head/branch_head`, **not** `manager`/`team_leader` | GAP, and a real RBAC surprise |

`/api/lms/progress/me` and `/api/lms/certifications/me` are the two highest-value, lowest-risk next additions in this whole document — self-only, already built, already correct, zero new backend work.

---

## 17. Helpdesk / Grievances

| Question | Data source | Coverage |
|---|---|---|
| Status of my helpdesk ticket / open grievances | `helpdesk_ticket`, `grievance`, intent `support` | ✅ COVERED |
| How do I raise a ticket / file a complaint | `POST /api/helpdesk/tickets` — self-only, real, working | GAP — explicitly flagged in the how-to catalog's own comments as investigated and not found at the time; it does exist |
| A specific ticket's resolution note | `GET /api/helpdesk/tickets/:id` — `support()` only returns the 10-most-recent summary, not one ticket's full detail | GAP |
| Manager: team ticket dashboard, SLA breaches, category breakdown | `helpdesk-sla.service.ts`, multiple scoped endpoints | GAP |
| HR/Admin: root causes, owner workload, grievance command center | admin-only endpoints | GAP |

---

## 18. Client Portal

**Separate auth system entirely** — `requireClientAuth` (a portal JWT with `role: "client"`), not Mira's internal RBAC. `portal-howto-catalog.ts`/`portal-howto.service.ts` exist as backend-only navigation scaffolding but **no chat UI is wired to the client portal at all today** — building real coverage here means a new, portal-JWT-scoped data-answering service analogous to `ai-account.service.ts`, which doesn't exist yet. CLAUDE.md's `CLIENT_PORTAL_BLOCKED_DATA` list (payroll, payslip, attendance reasons, employee PII, etc.) must be respected by any such service from day one.

---

## 19. ERP (Procurement / Vendors / GRN / Client Billing)

Only the reimbursement pair overlaps with existing Mira coverage. Everything else — purchase requisitions, vendor payments, GRN, contracts, client billing invoices, expense policy limits, billability/seat-cost — is real, RBAC-correct, and entirely uncovered. Note: `/expenses/*` routes are dead redirect shims to `/payroll/reimbursements` (the `expenses` module's own tables don't exist in `mas_hrms`) — any new catalog entry must point at the reimbursements path, not `/expenses`.

---

## 20. Integration Hub

Entirely `admin`-only at the backend, regardless of page-level grants (`integration.routes.ts:13`, hardcoded). Any Mira coverage here must explicitly deny non-admins outright — there's no partial/branch-scoped visibility to model, unlike Finance/GRN.

---

## 21. RBAC / Access Administration

No conversational coverage exists, but `getAccessMe()` (`GET /api/access/me`) is the actual foundation every `page_code`-mode how-to entry already depends on. High-value, admin-facing candidates: "how do I grant a user access to a page," "why can't this employee see X," "what access requests are pending" — all real, `admin`-scoped, working endpoints. One genuinely self-service exception: "I don't have access to a page I need, how do I request it" (`POST /api/access/access-requests`, `requireAuth` only) — the same action the "Request Access" button on every denied page already performs.

---

## Recommended next priorities (highest value, lowest risk)

Ranked by "real self-service backend endpoint already exists + zero RBAC ambiguity + clear user value":

1. **LMS progress/certification** (`/api/lms/progress/me`, `/api/lms/certifications/me`) — self-only, ready, zero new backend work.
2. **QA audit score (self)** — the route already has an explicit self-only carve-out built in specifically for this case.
3. **Helpdesk ticket detail / raise a ticket** — the "raise a ticket" how-to was previously assumed not to exist; it does.
4. **Access request self-service** ("how do I request access to a page") — mirrors the existing "Request Access" button exactly.
5. **Assets assigned to me** — self-or-admin, simple query, high everyday relevance.
6. **Manager team-attendance-today** — now that the underlying route actually works (fixed 2026-08-06), this is a clean intent to add.

Lowest priority / needs backend work first, not just a Mira intent: **F&F/gratuity** (no self-service route exists yet), **ATS candidate-facing** (separate auth system), **Client Portal data answers** (no chat UI wired at all).
