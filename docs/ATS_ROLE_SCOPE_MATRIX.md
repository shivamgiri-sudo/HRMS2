# ATS Role ↔ Scope Matrix

> Version: 12.0.0  
> Date: 2026-06-10  
> Commit: post-S12 (see git log)
> Session: 12 — S12-A/B/C/D recruiter ownership enforcement (JWT-bound recruiterCode/name; impersonation block; journey scope)

---

## 1. Role Definitions

| Role Key | Description | Scope Type |
|----------|-------------|------------|
| `admin` | Global / HR Admin | `all` or `branch` (configurable) |
| `hr` | HR Personnel | `branch` or `process` |
| `recruiter` | Recruitment Staff | `branch` or `process` |
| `manager` | Operations / Process Manager | `branch` or `process` |
| `branch_head` | Branch Head | `branch` |
| `employee` | Regular Employee | `self` |
| `ceo` | CEO / Global Read | `all` |

---

## 2. Permission Matrix

### 2.1 Candidate Operations

| Operation | admin | hr | recruiter | manager | branch_head | employee | ceo |
|-----------|:-----:|:--:|:---------:|:-------:|:-----------:|:--------:|:---:|
| Create candidate (public) | — | — | — | — | — | — | — |
| List candidates (scoped) | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ |
| Get candidate detail | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ |
| Update candidate | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Move stage | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ |
| View stage logs | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ |
| Upload file (public, 1hr) | — | — | — | — | — | — | — |
| Convert to employee | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

### 2.2 Onboarding Bridge

| Operation | admin | hr | recruiter | manager | branch_head | employee | ceo |
|-----------|:-----:|:--:|:---------:|:-------:|:-----------:|:--------:|:---:|
| Create bridge | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Update bridge | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Send onboarding token | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

### 2.3 Onboarding Token (Public)

| Operation | admin | hr | recruiter | manager | branch_head | employee | ceo |
|-----------|:-----:|:--:|:---------:|:-------:|:-----------:|:--------:|:---:|
| Validate token | — | — | — | — | — | — | — |
| Submit profile | — | — | — | — | — | — | — |

### 2.4 Offer Management

| Operation | admin | hr | recruiter | manager | branch_head | employee | ceo |
|-----------|:-----:|:--:|:---------:|:-------:|:-----------:|:--------:|:---:|
| List onboarding requests | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Save offer draft | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Submit offer | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| View pending approvals | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ |
| Approve offer | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Reject offer | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |

### 2.5 Dashboard & Stats

| Operation | admin | hr | recruiter | manager | branch_head | employee | ceo |
|-----------|:-----:|:--:|:---------:|:-------:|:-----------:|:--------:|:---:|
| View ATS stats | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ |
| View walk-in queue | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ |
| View waiting queue | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ |
| View sourcing channels | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ |

### 2.6 Form Configuration

| Operation | admin | hr | recruiter | manager | branch_head | employee | ceo |
|-----------|:-----:|:--:|:---------:|:-------:|:-----------:|:--------:|:---:|
| Bootstrap (public) | — | — | — | — | — | — | — |
| View configs | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Update field schema | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Update option list | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Recruiter CRUD | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

---

## 3. Row-Scope Enforcement Status

| Endpoint | Role Check | Branch Scope | Process Scope | Row-Level | Status | Session |
|----------|------------|--------------|---------------|-----------|--------|---------|
| `GET /api/ats/candidates` | ✅ | ✅ `buildScopeWhereClause` on `c.applied_for_branch` | ✅ `buildScopeWhereClause` on `c.applied_for_process` | — | **✅ Fixed S5** (was using wrong column aliases) | S5 |
| `GET /api/ats/candidates/:id` | ✅ | ✅ `hasScopedAccess` | ✅ `hasScopedAccess` | ✅ | **✅ Fixed** | S2 |
| `PUT /api/ats/candidates/:id` | ✅ | ✅ `hasScopedAccess` | ✅ `hasScopedAccess` | ✅ | **✅ Fixed** | S2 |
| `POST /api/ats/candidates/:id/move-stage` | ✅ | ✅ `hasScopedAccess` | ✅ `hasScopedAccess` | ✅ | **✅ Fixed** | S2 |
| `GET /api/ats/walkin-queue` | ✅ | ✅ `buildScopeWhereClause` | ✅ `buildScopeWhereClause` | — | **✅ Fixed** | S2 |
| `GET /api/ats/waiting-queue` | ✅ | ✅ `buildScopeWhereClause` | ✅ `buildScopeWhereClause` | — | **✅ Fixed** | S2 |
| `POST /api/ats/convert/:id` | ✅ | ✅ `hasScopedAccess` | ✅ `hasScopedAccess` | ✅ | **✅ Fixed** | S2 |
| `POST /api/ats/onboarding-bridge` | ✅ | ✅ `hasScopedAccess` via candidate | ✅ `hasScopedAccess` via candidate | ✅ | **✅ Fixed S7** | S7 |
| `PATCH /api/ats/onboarding-bridge/:id` | ✅ | ✅ `hasScopedAccess` via bridge→candidate | ✅ `hasScopedAccess` via bridge→candidate | ✅ | **✅ Fixed S7** | S7 |
| `GET /api/ats/onboarding/requests` | ✅ | ✅ `buildScopeWhereClause` on `r.branch_id` | ❌ | — | **✅ Fixed S4** | — |
| `GET /api/ats/onboarding/pending-approval` | ✅ | ✅ `buildScopeWhereClause` on `r.branch_id` | ❌ | — | **✅ Fixed S4** | — |
| `POST /api/ats/onboarding/offers/:id/approve` | ✅ | ✅ `hasScopedAccess` | ✅ `hasScopedAccess` | ✅ | **✅ Fixed S4** | S4 |
| `POST /api/ats/onboarding/offers/:id/reject` | ✅ | ✅ `hasScopedAccess` | ✅ `hasScopedAccess` | ✅ | **✅ Fixed S4** | S4 |
| `GET /api/ats/stats` | ✅ | ❌ | ❌ | N/A | **Missing** (aggregates) | — |
| `GET /api/ats/sourcing-channels` | ✅ | N/A | N/A | N/A | N/A | — |
| `GET /api/ats/bgv/queue` | ✅ | ✅ `buildScopeWhereClause` on `c.applied_for_branch` | ✅ `buildScopeWhereClause` on `c.applied_for_process` | — | **✅ Fixed S7** | S7 |
| `GET /api/ats/bgv/candidates/:id` | ✅ | ✅ `hasScopedAccess` | ✅ `hasScopedAccess` | ✅ | **✅ Fixed S7** | S7 |
| `POST /api/ats/bgv/candidates/:id/manual-review` | ✅ | ✅ `hasScopedAccess` | ✅ `hasScopedAccess` | ✅ | **✅ Fixed S7** | S7 |
| `POST /api/ats/bgv/candidates/:id/waive` | ✅ | ✅ `hasScopedAccess` | ✅ `hasScopedAccess` | ✅ | **✅ Fixed S7** | S7 |
| `POST /api/ats/onboarding/send-token/:id` | ✅ | ❌ | ❌ | ❌ | **Missing** | — |
| `GET /api/ats/onboarding/requests` | ✅ | ✅ `buildScopeWhereClause` | ❌ | — | **✅ Fixed S4** | — |
| `POST /api/ats/onboarding/requests/:id/offer` | ✅ | ❌ | ❌ | ❌ | **Missing** | — |
| `GET /api/ats/onboarding/pending-approval` | ✅ | ✅ `buildScopeWhereClause` | ❌ | — | **✅ Fixed S4** | — |
| `POST /api/ats/onboarding/offers/:id/approve` | ✅ | ✅ `hasScopedAccess` | ✅ `hasScopedAccess` | ✅ | **✅ Fixed S4** | S4 |
| `POST /api/ats/onboarding/offers/:id/reject` | ✅ | ✅ `hasScopedAccess` | ✅ `hasScopedAccess` | ✅ | **✅ Fixed S4** | S4 |
| `GET /api/ats-full-parity/web-data` | ✅ | ✅ `buildScopeWhereClause` in SQL | ✅ `buildScopeWhereClause` in SQL | — | **✅ Fixed S11** | S11 |
| `GET /api/ats-full-parity/queue` | ✅ | ✅ `buildScopeWhereClause` in SQL | ✅ `buildScopeWhereClause` in SQL | — | **✅ Fixed S11** | S11 |
| `GET /api/ats-full-parity/daily-report/snapshot` | ✅ | ✅ actorId forwarded to webData() | ✅ actorId forwarded to webData() | — | **✅ Fixed S11** | S11 |
| `GET /api/ats/recruiter/my-candidates` | ✅ | N/A | N/A | ✅ JWT→resolveRecruiterForActor | **✅ Fixed S12** (was untrusted query param) | S12 |
| `GET /api/ats/recruiter/submission-history` | ✅ | N/A | N/A | ✅ JWT→resolveRecruiterForActor | **✅ Fixed S12** (was untrusted query param) | S12 |
| `POST /api/ats-full-parity/recruiter-submission` | ✅ | N/A | N/A | ✅ JWT→resolveRecruiterForActor; body mismatch → 403 | **✅ Fixed S12** (was body-trusted recruiterCode) | S12 |
| `GET /api/ats-full-parity/journey` | ✅ | ✅ `hasScopedAccess` on candidate branch | ✅ `hasScopedAccess` on candidate process | ✅ | **✅ Fixed S12** (was unchecked) | S12 |

---

## 4. Scope Enforcement Strategy

### 4.1 Required Patterns

For every endpoint that reads or mutates a single candidate or offer record:

1. **Extract candidate's branch/process** from the record.
2. **Call `hasScopedAccess(req.authUser!.id, 'candidate', candidateId)`** OR reuse the `buildScopeWhereClause` approach.
3. **Return 403** if the user's scope does not cover the candidate's branch/process.

### 4.2 Candidate Scope Check Helper (Proposed)

```typescript
// backend/src/modules/ats/ats.scope.ts
import { hasScopedAccess } from "../../shared/scopeAccess.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

export async function requireCandidateScope(
  userId: string,
  candidateId: string
): Promise<{ branchId: string | null; processId: string | null }> {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT applied_for_branch AS branchId, applied_for_process AS processId FROM ats_candidate WHERE id = ?",
    [candidateId]
  );
  const row = (rows as RowDataPacket[])[0];
  if (!row) throw Object.assign(new Error("Candidate not found"), { status: 404 });

  const allowed = await hasScopedAccess(userId, "candidate", candidateId);
  if (!allowed) throw Object.assign(new Error("Access denied"), { status: 403 });

  return { branchId: row.branchId ?? null, processId: row.processId ?? null };
}
```

### 4.3 Priority Order for Fixes

| Priority | Endpoint | Rationale | Status |
|----------|----------|-----------|--------|
| P0 | `GET /api/ats/candidates/:id` | Direct PII exposure risk | ✅ Fixed S2 |
| P0 | `POST /api/ats/convert/:id` | Creates employee — must verify actor authority | ✅ Fixed S2 |
| P1 | `PUT /api/ats/candidates/:id` | Mutation without scope check | ✅ Fixed S2 |
| P1 | `POST /api/ats/candidates/:id/move-stage` | State mutation without scope check | ✅ Fixed S2 |
| P1 | `GET /api/ats/walkin-queue` | Queue may expose cross-branch candidates | ✅ Fixed S2 |
| P1 | `GET /api/ats/waiting-queue` | Queue may expose cross-branch candidates | ✅ Fixed S2 |
| P2 | `GET /api/ats/onboarding/requests` | HR views all branches | ✅ Fixed S4 |
| P2 | `GET /api/ats/onboarding/pending-approval` | Branch head views all branches | ✅ Fixed S4 |
| P2 | Offer approve/reject | Must verify branch_head matches candidate branch | ✅ Fixed S4 |
| P1 | `GET /api/ats/bgv/queue` | HR/recruiter views all-branch BGV queue | 🔴 Open |
| P1 | `GET /api/ats/bgv/candidates/:id` | HR reads BGV details cross-branch | 🔴 Open |
| P1 | `POST /api/ats/bgv/candidates/:id/waive` / `manual-review` | Admin overrides BGV cross-branch | 🔴 Open |
| **P0** | **CI-BGV-01: `POST /api/ats/bgv/provider/callback` — no signature validation** | **BGV results can be forged** | **✅ Fixed S7 — HMAC-SHA256 + timingSafeEqual** |
| **P0** | **CI-FP-01: `POST /api/ats-full-parity/intake` — public PII intake** | **Unauthenticated PII submission** | **🔴 Open — CRITICAL** |
| **P0** | **CI-FP-02: `POST /api/ats-full-parity/bgv` — public BGV submission** | **No token/auth validation** | **🔴 Open — CRITICAL** |
| **P0** | **CI-FP-03: `POST /api/ats-full-parity/doc-upload-response` — public doc callback** | **No validation** | **🔴 Open — CRITICAL** |
| **P0** | **CI-001: `submit-profile` writes Aadhaar/PAN/bank unmasked** | **PII exposure in ats_candidate** | **✅ Fixed S4** |

---

## Document Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-06-10 | Audit Agent | Initial role scope matrix |
| 2.0.0 | 2026-06-10 | Audit Agent | Session 2: 6 P0/P1 endpoints fixed; priority table status updated |
| 3.0.0 | 2026-06-10 | Audit Agent | Session 3: BGV, onboarding, offer scope gaps added; CI-001 PII issue added to priority table |
| 4.0.0 | 2026-06-10 | Audit Agent | Session 4: CI-001 fixed; requests/pending-approval scoped; offer approve/reject scoped; 4 new P0 CI issues from full-parity audit |
| 5.0.0 | 2026-06-10 | Audit Agent | Session 5: GET /candidates scope column bug fixed (c.branch_id→c.applied_for_branch); queue token endpoints added with branch/process scope |
| 6.0.0 | 2026-06-10 | Audit Agent | Session 6: recruiter verify endpoint (bcrypt+biometric); my-candidates scoped to recruiter's assigned Waiting candidates; submission via ats_interview_submission with ownership check |
| 7.0.0 | 2026-06-10 | Audit Agent | Session 7: CI-BGV-01 HMAC-SHA256 webhook (timingSafeEqual); BGV queue+candidate+manual-review+waive row-scope; onboarding bridge POST+PATCH row-scope; validateToken/ensureConsent statusCode fix |
| 8.0.0 | 2026-06-10 | Audit Agent | Session 8: CI-FP-01/02/03/04 fixed (requireFormApiKey on POST intake+bgv+doc-upload+confirmation+recruiter-devices); BGV multi-provider adapter infra (InfinityAiBgvAdapter, DigioBgvAdapter, factory) |
| 9.0.0 | 2026-06-10 | Audit Agent | Session 9: Issue 4 upload ownership (mobile field required + DB match); Issue 17 send-token row-scope (hasScopedAccess on candidate branch/process); Issue 3 validateToken expiry UTC-safe |
| 10.0.0 | 2026-06-10 | Audit Agent | Session 10: stage-logs row-scope added (GET /candidates/:id/stage-logs); all remaining P3 issues closed; 139 tests; frontend + backend typechecks clean |
| 11.0.0 | 2026-06-10 | Audit Agent | Session 11: S11-A web-data + S11-B queue + S11-C daily-report-snapshot actor-scope enforcement; buildScopeWhereClause injected into SQL; admin/hr/ceo bypass; 8 new tests |
| 12.0.0 | 2026-06-10 | Audit Agent | Session 12: S12-A/B my-candidates + submission-history JWT-bound; S12-C recruiter-submission impersonation blocked; S12-D journey scope check; resolveRecruiterForActor helper; 13 new tests |

---

*End of Role Scope Matrix*
