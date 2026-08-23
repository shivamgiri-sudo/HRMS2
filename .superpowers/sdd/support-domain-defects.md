# Support Domain — Defect Ledger
_Generated 2026-08-19 | Phase-0 audit | Lock this file before dispatching patch agents_

Each defect has exactly ONE set of owner files. No two patch agents may edit the same owner file for different defects in the same push. Update `Status` here when a defect is patched.

---

## Severity Key
- **CRITICAL** — user-facing action silently fails or returns 404/500
- **HIGH** — feature partially broken; workaround exists but data may be wrong
- **MEDIUM** — missing capability that the UI implies exists; no crash
- **LOW** — contract drift, performance concern, or cosmetic

---

## Open Defects

_(none — all defects verified fixed as of 2026-08-23; see Resolved section below)_

---

## Previously Open — Now Fixed

### D-GCC-01 · CRITICAL · Grievance Command Center
**Title:** `POST /api/helpdesk/grievances/:id/status` route missing — "Mark Under Review" and "Mark Resolved" return 404

**Root cause:**  
`NativeGrievanceCommandCenter.tsx` uses a generic `doAction(action, body)` dispatcher. When `action="status"`, it calls `POST /api/helpdesk/grievances/:id/status`. No such route exists in `helpdesk.routes.ts`. The backend has `PATCH /grievances/:id` (general update, requires admin/hr) and specific action routes, but no `/status` sub-route.

**Symptom:**  
Clicking "Mark Under Review" or "Mark Resolved" in the grievance detail drawer fires `POST .../status` → Express returns 404 → `doAction` catch block shows "status failed" toast. Case status never changes.

**Reproduction:**  
1. Login as admin or hr
2. Open `/support/grievance-command-center`
3. Click any open case → detail drawer opens
4. Click "Mark Under Review" → network tab shows 404

**Fix — minimal:**  
Add one route handler to `helpdesk.routes.ts` (after the existing `PATCH /grievances/:id` at line 373):
```typescript
router.post("/grievances/:id/status", requireRole("admin", "hr"), h(async (req, res) => {
  const { status } = req.body;
  const ALLOWED = ["under_review", "resolved", "submitted", "closed", "escalated"];
  if (!ALLOWED.includes(status)) return res.status(400).json({ error: `Invalid status: ${status}` });
  const data = await helpdeskService.updateGrievance(req.params.id, { status });
  await writeSensitiveAuditLog({
    actorUserId: req.authUser!.id,
    actionType: "GRIEVANCE_STATUS_CHANGED",
    moduleKey: "PEOPLE_EXPERIENCE",
    entityType: "grievance",
    entityId: req.params.id,
    changeSummary: { status },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  });
  res.json({ data });
}));
```

**Sole owner files (this defect only):**
- `backend/src/modules/helpdesk/helpdesk.routes.ts` — add route handler only; no service change needed

**No other files touched.** `helpdeskService.updateGrievance` already accepts `{ status }` and validates nothing (the route validates). `writeSensitiveAuditLog` already exists and is imported.

**Status:** FIXED — route exists at `helpdesk.routes.ts:465-466` (verified 2026-08-23)
**Regression risk:** None — new route, no existing behaviour changed.

---

### D-RBAC-01 · LOW · Benefits
**Title:** `BENEFITS` page code absent from `PAGE_CODE_BY_ROUTE` — drift contract test flags it

**Root cause:**  
When the Benefits module was added, `/benefits: "BENEFITS"` was not added to `PAGE_CODE_BY_ROUTE` in `pageRoutePageCodes.ts`. To avoid failing the drift test, `"BENEFITS"` was placed in `KNOWN_UNMAPPED_PAGE_CODES`. The primary `WorkforcePageGate` uses the `pageCode` prop directly (not the URL lookup), so access control itself is not broken. However, any utility that derives page codes from URL (breadcrumbs, logging, permission editors) will fail silently for this route.

**Symptom:**  
Drift contract test shows "BENEFITS" in the known-unmapped list rather than clean. No UI crash; a subtle gap in observability tooling.

**Fix — two-line change:**  
1. `src/lib/pageRoutePageCodes.ts` — add `"/benefits": "BENEFITS"` adjacent to other route entries (around line 221 where `/helpdesk` is defined).
2. `src/tests/page-catalog-route-drift.contract.test.ts` — remove `"BENEFITS"` from `KNOWN_UNMAPPED_PAGE_CODES` (line 75).

**Sole owner files:**
- `src/lib/pageRoutePageCodes.ts`
- `src/tests/page-catalog-route-drift.contract.test.ts`

**Status:** FIXED — `/benefits: "BENEFITS"` present at `pageRoutePageCodes.ts:31`; "BENEFITS" absent from KNOWN_UNMAPPED list (verified 2026-08-23)
**Regression risk:** Zero — additive change; drift test will go from "known-unmapped" to "clean".

---

### D-SLA-01 · LOW · Support Command Center / Helpdesk
**Title:** `refreshSlaBreachFlags()` called on every dashboard GET — full-table UPDATE on each request

**Root cause:**  
`helpdesk.routes.ts` line 68 calls `refreshSlaBreachFlags()` inline on every `GET /dashboard` request. `refreshSlaBreachFlags()` does `UPDATE helpdesk_ticket SET sla_breached=1 WHERE status NOT IN ('resolved','closed','cancelled') AND sla_due_at IS NOT NULL AND sla_due_at < NOW()`. This is a full-table scan + update on each request. Currently harmless at low ticket volumes but will degrade under load.

The `/command-center` route (line 62) delegates to `getSupportCommandCenter()` which does NOT call refreshSlaBreachFlags — so the command center already has stale breach data.

**Symptom:**  
No user-visible failure today. At ~1k+ open tickets, dashboard loads will serialise on the UPDATE lock. Breach badges on the command center may lag by up to 30 minutes.

**Fix:**  
- Remove the `await refreshSlaBreachFlags()` call from the `/dashboard` route handler.
- Create `backend/src/modules/helpdesk/helpdesk-sla.cron.ts` that calls `refreshSlaBreachFlags()` on a 5-minute schedule via the existing cron pattern used by `payroll-window.cron.ts`.
- Register the cron in `backend/src/platform/cron/cronRegistry.ts` (or equivalent).

**Sole owner files:**
- `backend/src/modules/helpdesk/helpdesk.routes.ts` — remove inline call (1 line)
- `backend/src/modules/helpdesk/helpdesk-sla.cron.ts` — new file (cron registration)
- Cron registry file (identify by reading `ats-reminders.cron.ts` for the pattern)

**Status:** FIXED — `helpdesk-sla.cron.ts` exists and is registered in `server.ts:237` and `all-workers.ts:287`; inline call removed from dashboard route (verified 2026-08-23)
**Regression risk:** Low — SLA flags continue to be updated by cron; dashboard no longer takes the write hit.

---

### D-GRIEV-EVIDENCE-01 · MEDIUM · Grievance Command Center
**Title:** Grievance evidence upload is metadata-only — no file is persisted

**Root cause:**  
`POST /api/helpdesk/grievances/:id/evidence` accepts only JSON `{ file_name, file_type, description }`. It calls `addEvidenceMetadata` which writes to `sensitive_action_log` and increments `grievance.evidence_count`. No multer middleware, no actual file is stored. The central files module (`src/modules/files/`) provides the correct upload pattern (magic-byte validation, document vault registration, DPDP auth) but it is not wired to the grievance evidence endpoint.

Additionally, `NativeGrievanceCommandCenter.tsx` has no evidence upload UI — the `doAction("evidence", ...)` path is never called from the rendered buttons.

**Symptom:**  
The `evidence_count` badge in the case list increments, but no file is retrievable. An investigator expecting to attach documents has no UI pathway.

**Fix requires two sub-tasks (coordinate to avoid conflict):**
1. **Backend** — `helpdesk.routes.ts`: add multer to the `/grievances/:id/evidence` route; wire to the files module's upload + vault registration pattern. Update `helpdesk.service.ts` `addEvidenceMetadata` to accept and store `file_url`.
2. **Frontend** — `NativeGrievanceCommandCenter.tsx`: add a file input to the detail drawer for evidence attachment, calling `POST /grievances/:id/evidence` as multipart.

**Sole owner files:**
- `backend/src/modules/helpdesk/helpdesk.routes.ts` (multer wiring)
- `backend/src/modules/helpdesk/helpdesk.service.ts` (addEvidenceMetadata signature + file_url)
- `src/pages/NativeGrievanceCommandCenter.tsx` (evidence upload UI)

**Dependency:** Backend patch must land before frontend patch.

**Status:** FIXED — `helpdesk.routes.ts:29-647` has multer wiring, file vault registration, and `file_url` stored; frontend evidence upload UI confirmed present (verified 2026-08-23)
**Regression risk:** Medium — modifying `addEvidenceMetadata` signature; verify existing callers (`addGrievanceEvidence` delegates to it — update that too).

---

### D-NOTIF-01 · MEDIUM · Helpdesk / Benefits
**Title:** No inbox notifications fired for ticket assignment, claim approval, or grievance status changes

**Root cause:**  
The `inboxService.createItem()` pattern is used by payroll, ATS, and IT provisioning to push work items to user inboxes. None of the support-domain actions (ticket assigned to agent, grievance status changed, claim approved/rejected) create inbox items. The `work_inbox_item` table has no rows from the support domain.

**Symptom:**  
An IT agent assigned a ticket gets no inbox notification. An employee whose claim is approved gets no notification. Grievance status updates are silent to the employee.

**Fix — add `inboxService.createItem()` calls at action points:**
- Ticket assigned → notify assignee
- Ticket resolved → notify reporter
- Grievance status change → notify employee (unless anonymous)
- Claim approved/rejected → notify employee
- Claim paid → notify employee

**Sole owner files (must be patched together, one commit):**
- `backend/src/modules/helpdesk/helpdesk.routes.ts` (ticket assign/resolve notification calls)
- `backend/src/modules/helpdesk/helpdesk.service.ts` (if notifications are moved inside service functions)
- `backend/src/modules/benefits/benefits.routes.ts` (claim review/pay notification calls)

**Note:** Anonymous grievances — never send inbox notifications that reveal the grievant's identity. Check `is_anonymous` before notifying.

**Status:** FIXED — `helpdesk.routes.ts:228,273,491` and `benefits.routes.ts:242,283` have `inboxService.createItem` calls for ticket/grievance/claim events (verified 2026-08-23)
**Regression risk:** Low — additive only; inbox `createItem` is idempotent with dedup.

---

### D-LETTER-PREVIEW-01 · LOW · Letters
**Title:** `/letters/:id/preview` route has no `WorkforcePageGate` — any authenticated user can open a letter preview

**Root cause:**  
`platform.routes.tsx` line 131 registers `/letters/:id/preview` as a plain `ProtectedRoute` without a `WorkforcePageGate pageCode="LETTERS"` wrapper. The backend `GET /:letterId/html` correctly enforces admin/hr OR own-employee scope, so a non-hr employee cannot render someone else's letter. The gap is that the frontend route doesn't check whether the user has the `LETTERS` page code grant at all — it only checks `requireAuth`.

**Symptom:**  
An employee who navigates directly to `/letters/<some_uuid>/preview` will render the React page (no 403 from the gate). The underlying `GET /api/letters/:id/html` will then 403 them if the letter isn't theirs. The frontend just shows an empty/error page rather than the proper "access denied" screen.

**Fix:**  
Wrap the preview route in `WorkforcePageGate` with `pageCode="LETTERS"`, OR add employee self-service gate (employees may view their own letter via the `/helpdesk` self-service surface — if that's intentional, this is working as designed and the finding can be closed).

**Sole owner files:**
- `src/config/routes/platform.routes.tsx` (wrap preview route, line ~131)

**Status:** FIXED — `platform.routes.tsx:143` now wraps preview in `<Gate pageCode="LETTERS">` matching the list route; backend remains the authoritative own-employee guard (2026-08-23)
**Regression risk:** Zero.

---

## Resolved Defects

_(moved above — all 6 defects now carry FIXED status with verification notes)_

---

## Agent Dispatch Rules

Before dispatching any patch agent, check this table to ensure no file collision:

| File | Claimed By Defect |
|---|---|
| `backend/src/modules/helpdesk/helpdesk.routes.ts` | D-GCC-01, D-SLA-01, D-GRIEV-EVIDENCE-01, D-NOTIF-01 |
| `backend/src/modules/helpdesk/helpdesk.service.ts` | D-GRIEV-EVIDENCE-01, D-NOTIF-01 |
| `backend/src/modules/benefits/benefits.routes.ts` | D-NOTIF-01 |
| `src/lib/pageRoutePageCodes.ts` | D-RBAC-01 |
| `src/tests/page-catalog-route-drift.contract.test.ts` | D-RBAC-01 |
| `src/pages/NativeGrievanceCommandCenter.tsx` | D-GRIEV-EVIDENCE-01 |
| `src/config/routes/platform.routes.tsx` | D-LETTER-PREVIEW-01 |
| `backend/src/modules/helpdesk/helpdesk-sla.cron.ts` (new) | D-SLA-01 |

**Rule:** If two defects share an owner file, they MUST be patched by the same agent or sequentially, never in parallel. D-GCC-01, D-SLA-01, D-NOTIF-01 all touch `helpdesk.routes.ts` — merge into one helpdesk-routes patch agent.

### Suggested dispatch grouping (no file collisions per group)

| Patch Agent | Defects | Files |
|---|---|---|
| **Agent A: helpdesk-routes-patch** | D-GCC-01 + D-SLA-01 + D-NOTIF-01 (ticket/grievance side) | helpdesk.routes.ts, helpdesk-sla.cron.ts, helpdesk.service.ts (notification calls only) |
| **Agent B: benefits-patch** | D-NOTIF-01 (claims side only) | benefits.routes.ts |
| **Agent C: rbac-drift-patch** | D-RBAC-01 | pageRoutePageCodes.ts, page-catalog-route-drift.contract.test.ts |
| **Agent D: evidence-upload** | D-GRIEV-EVIDENCE-01 | helpdesk.routes.ts (multer), helpdesk.service.ts — **must run AFTER Agent A** |
| **Agent E: letter-preview-gate** | D-LETTER-PREVIEW-01 | platform.routes.tsx |

Agents B, C, E have zero file overlap with each other or Agent A — they can run in parallel.  
Agent D must wait for Agent A to complete (both edit helpdesk.routes.ts).