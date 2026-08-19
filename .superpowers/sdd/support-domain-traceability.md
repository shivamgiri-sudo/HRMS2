# Support Domain — Traceability Matrix
_Generated 2026-08-19 | Phase-0 read-only audit | Do not modify without updating the defect ledger_

---

## Architecture Snapshot

| Layer | Technology |
|---|---|
| Frontend pages | React 18 / TypeScript / Tailwind — inline className, no shadcn primitives imported directly |
| API client | `hrmsApi` (custom fetch wrapper, JWT auto-injected) — raw `fetch` with manual token only in Letters preview/download |
| Backend | Express Router, `requireAuth` → `requireRole` guard pattern, `h()` error wrapper |
| DB | MySQL `mas_hrms`, raw `mysql2` pool — no ORM |
| Audit | `writeSensitiveAuditLog` (sensitive ops) + `writeAuditLog` (general), both non-throwing |
| Notifications | `inboxService.createItem()` — dedup per (user, type, entity, action_url) |

---

## Module 1 — Helpdesk

**Frontend:** `src/pages/NativeHelpdesk.tsx` (1,457 lines)  
**Route:** `/helpdesk` | Gate: `pageCode="HELPDESK_KB"` via `WorkforcePageGate`  
**Sidebar roles:** admin, super_admin, hr, manager, process_manager, branch_head

| Frontend Action | API Call | Backend Route File | Service Call | DB Tables | Status |
|---|---|---|---|---|---|
| List tickets (admin) | `GET /api/helpdesk/tickets` | helpdesk.routes.ts:105 | `listTickets(filters, scope)` | helpdesk_ticket | ✅ Working |
| List tickets (employee) | `GET /api/helpdesk/tickets` | helpdesk.routes.ts:105 | `listTickets({employee_id})` | helpdesk_ticket | ✅ Working |
| Get ticket detail | `GET /api/helpdesk/tickets/:id` | helpdesk.routes.ts | `getTicket(id)` | helpdesk_ticket, helpdesk_ticket_comment | ✅ Working |
| Raise ticket | `POST /api/helpdesk/tickets` | helpdesk.routes.ts:116 | `createTicket(data)` | helpdesk_ticket | ✅ Working — calls `calculateSlaDueAt`, fires SMS |
| Add comment | `POST /api/helpdesk/tickets/:id/comments` | helpdesk.routes.ts:249 | `addComment(...)` | helpdesk_ticket_comment | ✅ Working |
| Assign ticket | `POST /api/helpdesk/tickets/:id/assign` | helpdesk.routes.ts | `updateTicket(id, {assigned_to})` | helpdesk_ticket | ✅ Working |
| Self-assign (take) | `POST /api/helpdesk/tickets/:id/take` | helpdesk.routes.ts:489 | `takeTicket(id, userId)` | helpdesk_ticket | ✅ Working — atomicity guard |
| Put on hold | `POST /api/helpdesk/tickets/:id/hold` | helpdesk.routes.ts | `holdTicket(id, userId, reason)` | helpdesk_ticket | ✅ Working |
| Resolve | `POST /api/helpdesk/tickets/:id/resolve` | helpdesk.routes.ts:207 | `updateTicket(id, {status:resolved,...})` | helpdesk_ticket | ✅ Working |
| Escalate | `POST /api/helpdesk/tickets/:id/escalate` | helpdesk.routes.ts | `updateTicket(id, {escalation_level})` | helpdesk_ticket | ✅ Working |
| Reopen | `POST /api/helpdesk/tickets/:id/reopen` | helpdesk.routes.ts:215 | `reopenTicket(id, userId)` | helpdesk_ticket | ✅ Working |
| CSAT rating | `POST /api/helpdesk/tickets/:id/rating` | helpdesk.routes.ts:235 | `rateTicket(id, rating, empId)` | helpdesk_ticket | ✅ Working |
| Update priority/IT fields | `PATCH /api/helpdesk/tickets/:id` | helpdesk.routes.ts | `updateTicket(id, data)` | helpdesk_ticket | ✅ Working — recalculates SLA on priority change |
| List agents (assign dropdown) | `GET /api/helpdesk/agents?branch_id=` | helpdesk.routes.ts:481 | `listAgents({branch_id})` | auth_user, user_roles | ✅ Working |
| List grievances (employee tab) | `GET /api/helpdesk/grievances` | helpdesk.routes.ts:284 | `listGrievances({employee_id})` | grievance | ✅ Working |
| Submit grievance | `POST /api/helpdesk/grievances` | helpdesk.routes.ts:294 | `createGrievance(data)` | grievance | ✅ Working |
| List KB articles | `GET /api/helpdesk/kb?search=` | helpdesk.routes.ts | `listKbArticles(filters)` | helpdesk_kb_article | ✅ Working |
| KB article detail | `GET /api/helpdesk/kb/:id` | helpdesk.routes.ts | `getKbArticle(id)` | helpdesk_kb_article | ✅ Working — increments view_count |
| Vote helpful | `POST /api/helpdesk/kb/:id/helpful` | helpdesk.routes.ts | `markKbHelpful(articleId, userId, isHelpful)` | helpdesk_kb_feedback, helpdesk_kb_article | ✅ Working |
| Create KB article (admin) | `POST /api/helpdesk/kb` | helpdesk.routes.ts | `createKbArticle(data)` | helpdesk_kb_article | ✅ Working |

---

## Module 2 — Support Command Center

**Frontend:** `src/pages/NativeSupportCommandCenter.tsx` (703 lines)  
**Route:** `/support/command-center` | Gate: `pageCode="SUPPORT_COMMAND_CENTER"`  
**Backend roles required:** admin, hr, super_admin, manager, process_manager, it, branch_it, it_admin

| Frontend Action | API Call | Backend Route File | Service Call | DB Tables | Status |
|---|---|---|---|---|---|
| Load all KPIs + SLA + breakdown | `GET /api/helpdesk/command-center?from=&to=&...` | helpdesk.routes.ts:62 | `getSupportCommandCenter(filters)` | helpdesk_ticket | ✅ Working — calls `refreshSlaBreachFlags()` ⚠️ see D-SLA-01 |
| IT depth analysis | `GET /api/helpdesk/it-analysis?from=&to=` | helpdesk.routes.ts:98 | `getItDepthAnalysis(filters)` | helpdesk_ticket | ✅ Working |
| Open ticket queue | `GET /api/helpdesk/tickets?status=open` | helpdesk.routes.ts:105 | `listTickets({status:open}, scope)` | helpdesk_ticket | ✅ Working |
| Agent list (queue assign dropdown) | `GET /api/helpdesk/agents` | helpdesk.routes.ts:481 | `listAgents({})` | auth_user, user_roles | ✅ Working |
| Assign from queue | `POST /api/helpdesk/tickets/:id/assign` | helpdesk.routes.ts | `updateTicket(id, {assigned_to})` | helpdesk_ticket | ✅ Working |
| Take from queue | `POST /api/helpdesk/tickets/:id/take` | helpdesk.routes.ts:489 | `takeTicket(id, userId)` | helpdesk_ticket | ✅ Working |
| Escalate from queue | `POST /api/helpdesk/tickets/:id/escalate` | helpdesk.routes.ts | `updateTicket(id, {escalation_level})` | helpdesk_ticket | ✅ Working |

**Note:** `/sla-summary`, `/category-breakdown`, `/owner-workload`, `/aging`, `/root-causes` sub-routes exist and are valid but the command center calls the aggregate `/command-center` endpoint; sub-routes are standalone for other consumers.

---

## Module 3 — Grievance Command Center

**Frontend:** `src/pages/NativeGrievanceCommandCenter.tsx` (806 lines)  
**Route:** `/support/grievance-command-center` | Gate: `pageCode="GRIEVANCE_COMMAND_CENTER"`  
**Backend roles required for command-center endpoint:** admin, hr, super_admin

| Frontend Action | API Call | Backend Route File | Service Call | DB Tables | Status |
|---|---|---|---|---|---|
| Load dashboard + case list | `GET /api/helpdesk/grievances/command-center?...` | helpdesk.routes.ts:274 | `getGrievanceCommandCenter(filters)` | grievance | ✅ Working |
| Get case detail | `GET /api/helpdesk/grievances/:id` | helpdesk.routes.ts:308 | `getGrievance(id, roles)` | grievance | ✅ Working — GRIEVANCE_VIEWED audit logged |
| Get case timeline | `GET /api/helpdesk/grievances/:id/timeline` | helpdesk.routes.ts:357 | `getGrievanceTimeline(id)` | sensitive_action_log, grievance | ✅ Working |
| Update assignment / due date | `PATCH /api/helpdesk/grievances/:id` | helpdesk.routes.ts:373 | `updateGrievance(id, body)` | grievance | ✅ Working |
| **Mark Under Review** | `POST /api/helpdesk/grievances/:id/status` | **MISSING** | — | — | ❌ **BROKEN — D-GCC-01** |
| **Mark Resolved** | `POST /api/helpdesk/grievances/:id/status` | **MISSING** | — | — | ❌ **BROKEN — D-GCC-01** |
| Escalate | `POST /api/helpdesk/grievances/:id/escalate` | helpdesk.routes.ts:405 | `updateGrievance(id, {escalation_level, status:escalated})` | grievance | ✅ Working |
| Save investigation note | `POST /api/helpdesk/grievances/:id/investigation-note` | helpdesk.routes.ts:423 | `updateGrievance(id, {investigation_notes, status:under_review})` | grievance | ✅ Working |
| Close case | `POST /api/helpdesk/grievances/:id/close` | helpdesk.routes.ts:440 | `updateGrievance(id, {status:closed, resolution_note})` | grievance | ✅ Working |
| Reopen case | `POST /api/helpdesk/grievances/:id/reopen` | helpdesk.routes.ts:457 | `updateGrievance(id, {status:submitted})` | grievance | ✅ Working |
| Employee search (assign picker) | `GET /api/employees?search=&limit=10&recordStatus=active` | employee.routes.ts | `listEmployees(filters)` | employees | ✅ Working (shared) |

---

## Module 4 — Benefits & Claims

**Frontend:** `src/pages/NativeBenefitsClaims.tsx` (1,379 lines)  
**Route:** `/benefits` | Gate: `pageCode="BENEFITS"`  
**Sidebar roles:** admin, super_admin, hr, manager, branch_head  
**Route file:** `backend/src/modules/benefits/benefits.routes.ts` | Mount: `app.use("/api/benefits", ...)`

| Frontend Action | API Call | Backend Route File | Service Call | DB Tables | Status |
|---|---|---|---|---|---|
| My claims list | `GET /api/benefits/claims?status=` | benefits.routes.ts | `listClaims({employee_id, status})` | reimbursement_claim, employees | ✅ Working |
| Submit claim | `POST /api/benefits/claims` | benefits.routes.ts | `submitClaim(input)` | reimbursement_claim | ✅ Working |
| Admin claims + stats | `GET /api/benefits/claims` (admin) | benefits.routes.ts | `listClaims({}), claimStats()` | reimbursement_claim | ✅ Working |
| Approve/Reject claim | `PATCH /api/benefits/claims/:id/review` | benefits.routes.ts | `reviewClaim(id, action, by, remarks)` | reimbursement_claim | ✅ Working — enforces status='submitted' |
| Mark as paid | `POST /api/benefits/claims/:id/pay` | benefits.routes.ts | `payClaim(id, paymentReference)` | reimbursement_claim | ✅ Working — enforces status='approved' |
| List benefit plans | `GET /api/benefits/plans?all=true` | benefits.routes.ts | `listPlans(activeOnly)` | benefit_plan | ✅ Working |
| Create plan | `POST /api/benefits/plans` | benefits.routes.ts | `createPlan(input)` | benefit_plan | ✅ Working |
| Toggle plan active | `PATCH /api/benefits/plans/:id` | benefits.routes.ts | `updatePlan(id, isActive)` | benefit_plan | ✅ Working |
| Employee enrollments | `GET /api/benefits/enrollments/:employeeId` | benefits.routes.ts | `listEnrollments(employeeId)` | benefit_enrollment, benefit_plan | ✅ Working |
| Enroll employee | `POST /api/benefits/enrollments` | benefits.routes.ts | `enroll(input)` | benefit_enrollment | ✅ Working — ON DUPLICATE KEY UPDATE |
| Employee search (picker) | `GET /api/employees?search=&limit=10&recordStatus=active` | employee.routes.ts | `listEmployees(filters)` | employees | ✅ Working (shared) |

**RBAC note:** `BENEFITS` page code has no entry in `PAGE_CODE_BY_ROUTE` — see D-RBAC-01.

---

## Module 5 — Letters

**Frontend:** `src/pages/NativeLetters.tsx` (~650 lines) + `src/pages/NativeLetterPreview.tsx`  
**Routes:** `/letters` (gate: `pageCode="LETTERS"`, roles: admin, hr) | `/letters/:id/preview` (plain ProtectedRoute, no gate)  
**Route file:** `backend/src/modules/letters/letters.routes.ts` | Mount: `app.use("/api/letters", ...)`

| Frontend Action | API Call | Backend Route File | Service Call | DB Tables | Status |
|---|---|---|---|---|---|
| List templates | `GET /api/letters/templates` | letters.routes.ts:28 | `listTemplates()` | letter_template | ✅ Working |
| All letters (admin) | `GET /api/letters/all` | letters.routes.ts:64 | `listAll()` | generated_letter, letter_template, employees | ✅ Working |
| Employee letter history | `GET /api/letters/employee/:empId` | letters.routes.ts:69 | `listGenerated(employeeId)` | generated_letter | ✅ Working |
| Preview (before generate) | `POST /api/letters/preview-html` | letters.routes.ts:159 | inline — fetch emp + salary + renderLetterHtml() | employees, letter_template, employee_salary_assignment | ✅ Working — raw fetch with manual Bearer token ✓ |
| Generate letter | `POST /api/letters/generate` | letters.routes.ts:34 | `generateLetter({employee_id, template_code, ...})` | generated_letter, employees, letter_template | ✅ Working — LETTER_GENERATED audit |
| Auto-fill salary vars | `GET /api/payroll/salary-assignments/:empId` | payroll.routes.ts | salary assignment resolver | employee_salary_assignment | ✅ Working (shared payroll module) |
| View as HTML | `GET /api/letters/:letterId/html` | letters.routes.ts:76 | `getById()` + `renderLetterHtml()` | generated_letter, letter_template | ✅ Working |
| Download | `GET /api/letters/:letterId/download` | letters.routes.ts:118 | `getById()` + `renderLetterHtml()` | generated_letter, letter_template | ✅ Working — raw fetch with manual Bearer token ✓ |
| Acknowledge | `POST /api/letters/:letterId/acknowledge` | letters.routes.ts:229 | `acknowledge(letterId)` | generated_letter | ✅ Working — LETTER_ACK_ADMIN_OVERRIDE audit for admin |
| Employee search (picker) | `GET /api/employees?search=&limit=10&status=active` | employee.routes.ts | `listEmployees(filters)` | employees | ✅ Working (shared) |

**Render service:** `backend/src/modules/letters/letters-render.service.ts` — `renderLetterHtml(letterType, data, logoUrl)`. Called by both `/html` and `/download` and `/preview-html`.

---

## Shared Infrastructure — Do Not Duplicate

These are used by ≥2 support modules. Patch the shared file, not per-module copies:

| Infrastructure | File | Consumers |
|---|---|---|
| `requireAuth` JWT guard | `backend/src/middleware/authMiddleware.ts` | all 5 |
| `requireRole(...)` RBAC | `backend/src/middleware/requireRole.ts` | all 5 |
| `getEmployeeForUser(userId)` | `backend/src/shared/accessGuard.ts` | Helpdesk, Grievance, Letters |
| `hasRoleForRequest(authUser, ...)` | `backend/src/shared/accessGuard.ts` | Helpdesk, Grievance |
| `resolveUserBusinessScope` + `buildProcessScopeCondition` | `backend/src/shared/enterpriseScope.ts` | Helpdesk |
| `writeSensitiveAuditLog` / `logSensitiveAction` | `backend/src/shared/auditLog.ts` | Helpdesk, Grievance, Letters |
| `inboxService.createItem()` | `backend/src/modules/inbox/inbox.service.ts` | (none in Support yet — see D-NOTIF-01) |
| `DashboardLayout` | `src/components/layout/DashboardLayout.tsx` | all 5 |
| `DashboardLoading`, `FilterField`, `KpiTile`, `SelectFilter` | `src/components/command-center/CommandCenterUi.tsx` | Support CC, Grievance CC |
| `hrmsApi` | `src/lib/hrmsApi.ts` | all 5 |
| `WorkforcePageGate` | `src/components/auth/WorkforcePageGate.tsx` | all 5 |
| Employee search `GET /api/employees?search=&limit=10` | `backend/src/modules/employees/employee.routes.ts` | Benefits, Grievance CC, Letters |

---

## Page Code / Route Registry

| Route | pageCode | In PAGE_CODE_BY_ROUTE | In KNOWN_UNMAPPED | Status |
|---|---|---|---|---|
| `/helpdesk` | `HELPDESK_KB` | ✅ line 221 | ✅ `HELPDESK` (legacy grant) | Note only — `HELPDESK_KB` works; `HELPDESK` is stale grant |
| `/support/command-center` | `SUPPORT_COMMAND_CENTER` | ✅ line 173 | — | ✅ Clean |
| `/support/grievance-command-center` | `GRIEVANCE_COMMAND_CENTER` | ✅ line 174 | — | ✅ Clean |
| `/benefits` | `BENEFITS` | ❌ Missing | ✅ line 75 (known drift) | ⚠️ D-RBAC-01 |
| `/letters` | `LETTERS` | ✅ line 85 | — | ✅ Clean |

---

## Database Tables — Support Domain

| Table | Module | Migration File |
|---|---|---|
| `helpdesk_ticket` | Helpdesk, Support CC | 016, 204, 217, 419 |
| `helpdesk_ticket_comment` | Helpdesk | 016 |
| `helpdesk_kb_article` | Helpdesk | 419 |
| `helpdesk_kb_feedback` | Helpdesk | 419 |
| `grievance` | Grievance CC, Helpdesk (submit) | 016, 204, 217 |
| `benefit_plan` | Benefits | 022 |
| `benefit_enrollment` | Benefits | 022 |
| `reimbursement_claim` | Benefits | 022, 431 |
| `letter_template` | Letters | 016, 277 |
| `generated_letter` | Letters | 016 |
| `sensitive_action_log` | Helpdesk, Grievance, Letters | 015, 237 |
| `audit_action_log` | Letters (generate) | 218 |
| `work_inbox_item` | (inbox — not yet used by Support) | 026 |