# Role-Wise ATS Journey

## Role: Recruiter (recruiter, hr, branch_hr)
- Create candidate: POST /api/ats/candidates ✓
- Update candidate: PUT /api/ats/candidates/:id ✓
- Schedule interview: POST /api/ats/interviews ✓
- Move stage: POST /api/ats/candidates/:id/stage ✓
- Send onboarding link: POST /api/ats/candidates/:id/send-onboarding-link — ONLY after status=selected
- View: own assigned candidates only via GET /api/ats/recruiter/my-candidates (scoped by recruiter profile linked to JWT; admin/hr/super_admin may override with ?recruiterName=)

## Role: Interviewer / Process Manager (process_manager, team_lead)
- View: GET /api/ats/interviews/assigned
- Submit feedback: POST /api/ats/interviews/:id/feedback
- Recommend: PUT /api/ats/candidates/:id/recommendation

## Role: HR / Branch HR (hr, branch_hr, ho_hr)
- Review selected: GET /api/ats/candidates?status=selected
- Send onboarding token: POST /api/ats/onboarding/send-token/:candidateId (requireRole hr, recruiter, admin; row-scoped to actor branch/process)
- Monitor onboarding: GET /api/ats/onboarding/requests
- Review docs/BGV: GET /api/bgv/candidates/:id
- Raise blockers: POST /api/ats/candidates/:id/blockers

## Role: Payroll HR (payroll_hr, payroll_head)
- Validate joining: POST /api/ats/payroll-hr/:candidateId/validate
- Fill JCLR fields: POST /api/ats/jclr/:candidateId
- Prepare readiness: PUT /api/ats/payroll-hr/:candidateId/readiness

## Role: Branch Head / BM (branch_head, bm)
- Approve JCLR: POST /api/ats/jclr/:candidateId/approve
- Approve offers: POST /api/ats/onboarding/offers/:id/approve (requireRole branch_head, admin)
- Reject offers: POST /api/ats/onboarding/offers/:id/reject (requireRole branch_head, admin)
- Review branch readiness: GET /api/ats/candidates?branch_id={id}&status=jclr_pending
- Review pending approvals: GET /api/ats/onboarding/pending-approval (scoped to actor branch)

## Role: Admin / Super Admin
- All access
- Override with audit: POST /api/ats/admin/override

---

## Audit Findings

### STEP 1 — Route-level requireRole gaps in ats.routes.ts

| Route | Method | Guard Status |
|---|---|---|
| POST /api/ats/candidates | public | INTENTIONAL — walk-in self-registration |
| POST /api/ats/candidates/:id/upload | public | INTENTIONAL — 1-hour window after registration; time-bounded |
| GET/USE /api/ats/onboarding-full/* | public | INTENTIONAL — token-gated onboarding form |
| GET/USE /api/ats/bgv/* | public | INTENTIONAL — token-gated BGV form |
| POST /api/ats/recruiter/verify | requireAuth only, no requireRole | RISK — any authenticated user can verify recruiter credentials; should be restricted to recruiter, hr, admin |
| GET /api/ats/candidates | requireRole admin,hr,recruiter,manager | OK |
| PUT /api/ats/candidates/:id | requireRole admin,recruiter | OK |
| POST /api/ats/candidates/:id/move-stage | requireRole admin,recruiter,manager | OK — note: branch_hr not included |
| GET /api/ats/candidates/:id/stage-logs | requireRole admin,hr,recruiter,manager | OK |
| POST /api/ats/convert/:candidateId | requireRole admin,hr | OK |
| POST /api/ats/onboarding-bridge | requireRole admin,hr | OK |
| PATCH /api/ats/onboarding-bridge/:id | requireRole admin,hr | OK |
| GET /api/ats/stats | requireRole admin,hr,recruiter,manager | OK |
| GET /api/ats/walkin-queue | requireRole admin,hr,recruiter | OK |
| GET /api/ats/waiting-queue | requireRole admin,hr,recruiter,manager | OK |
| All queue-token routes | requireRole admin,hr,super_admin,recruiter | OK |

### STEP 2 — ats.enhanced.service.ts (lines 1–120)

No `getQueueForRole` function in the first 120 lines. The file contains:
- `getBranchAliases()` — resolves branch alias master
- `resolveBranchFromAlias()` — alias-to-canonical key lookup
- `getAvailableRecruiters(branchName)` — returns active HR/executive employees at a branch with present-today flag
- `isRecruiterAvailableToday(recruiterId)` — returns true for any active employee (attendance absence tolerated)
- `assignRecruiterToCandidate(candidateId, preferredRecruiterId)` — fair-assignment logic with load balancing across active queue counts

Queue/role filtering is implemented separately in `ats.queue.service.ts` and `ats-full-parity/recruiterInterview.service.ts`.

### STEP 4 — send-onboarding-link route

The `/candidates/:id/send-onboarding-link` route does NOT exist in ats.routes.ts or ats.onboarding.routes.ts.
The functionally equivalent route is `POST /api/ats/onboarding/send-token/:candidateId` in ats.onboarding.routes.ts (requireRole hr, recruiter, admin; row-scope enforced via `hasScopedAccess`).
The missing route has been added to ats.onboarding.routes.ts — see STEP 4 implementation below.

### STEP 5 — NativeATSRecruiterWorkspace.tsx candidate fetch

The workspace fetches from `GET /api/ats/recruiter/my-candidates` (line 206–207), NOT from `/api/ats/candidates`.
The backend endpoint correctly scopes results:
- For privileged roles (admin, hr, super_admin): returns all or filters by ?recruiterName=
- For recruiter role: resolves recruiter profile from JWT → employee → recruiter table chain; returns only that recruiter's pending candidates
- If no recruiter profile is linked to the JWT, returns 403

Status: NO unfiltered all-candidates fetch. The workspace is correctly scoped.
