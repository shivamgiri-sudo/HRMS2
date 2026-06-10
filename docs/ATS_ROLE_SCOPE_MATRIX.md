# ATS Role ↔ Scope Matrix

> Version: 1.0.0  
> Date: 2026-06-10  
> Commit: `5488cef4805fd5fc41b3b77e9a802ab11b37ed26`

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

| Endpoint | Role Check | Branch Scope | Process Scope | Row-Level | Status |
|----------|------------|--------------|---------------|-----------|--------|
| `GET /api/ats/candidates` | ✅ | 🟡 (via `buildScopeWhereClause`) | 🟡 (via `buildScopeWhereClause`) | — | **Partial** |
| `GET /api/ats/candidates/:id` | ✅ | ❌ | ❌ | ❌ | **Missing** |
| `PUT /api/ats/candidates/:id` | ✅ | ❌ | ❌ | ❌ | **Missing** |
| `POST /api/ats/candidates/:id/move-stage` | ✅ | ❌ | ❌ | ❌ | **Missing** |
| `GET /api/ats/walkin-queue` | ✅ | ❌ | ❌ | ❌ | **Missing** |
| `GET /api/ats/waiting-queue` | ✅ | ❌ | ❌ | ❌ | **Missing** |
| `POST /api/ats/convert/:id` | ✅ | ❌ | ❌ | ❌ | **Missing** |
| `POST /api/ats/onboarding-bridge` | ✅ | ❌ | ❌ | ❌ | **Missing** |
| `PATCH /api/ats/onboarding-bridge/:id` | ✅ | ❌ | ❌ | ❌ | **Missing** |
| `GET /api/ats/onboarding/requests` | ✅ | ❌ | ❌ | ❌ | **Missing** |
| `GET /api/ats/onboarding/pending-approval` | ✅ | ❌ | ❌ | ❌ | **Missing** |
| `POST /api/ats/onboarding/offers/:id/approve` | ✅ | ❌ | ❌ | ❌ | **Missing** |
| `POST /api/ats/onboarding/offers/:id/reject` | ✅ | ❌ | ❌ | ❌ | **Missing** |
| `GET /api/ats/stats` | ✅ | ❌ | ❌ | N/A | **Missing** (aggregates) |
| `GET /api/ats/sourcing-channels` | ✅ | N/A | N/A | N/A | N/A |

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

| Priority | Endpoint | Rationale |
|----------|----------|-----------|
| P0 | `GET /api/ats/candidates/:id` | Direct PII exposure risk |
| P0 | `POST /api/ats/convert/:id` | Creates employee — must verify actor authority |
| P1 | `PUT /api/ats/candidates/:id` | Mutation without scope check |
| P1 | `POST /api/ats/candidates/:id/move-stage` | State mutation without scope check |
| P1 | `GET /api/ats/walkin-queue` | Queue may expose cross-branch candidates |
| P1 | `GET /api/ats/waiting-queue` | Queue may expose cross-branch candidates |
| P2 | `GET /api/ats/onboarding/requests` | HR views all branches |
| P2 | `GET /api/ats/onboarding/pending-approval` | Branch head views all branches |
| P2 | Offer approve/reject | Must verify branch_head matches candidate branch |

---

*End of Role Scope Matrix*
