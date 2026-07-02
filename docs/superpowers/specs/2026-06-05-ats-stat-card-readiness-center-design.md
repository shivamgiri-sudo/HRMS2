# Design: ATS Candidate Stat Card + Readiness Center

**Date:** 2026-06-05
**Repo:** tausifansari-mcn/HRMS (backend-only, Express + TypeScript + MySQL)
**Status:** Approved

---

## Scope

Two features, one implementation pass:

1. **ATS Candidate Stat Card** — per-candidate profile aggregate + scoped pipeline dashboard, both mounted under the existing `/api/ats` router
2. **Readiness Center** — multi-domain employee clearance hub at `/api/readiness`, answering "is this employee ready for live operations today?"

---

## Part 1: ATS Candidate Stat Card

### New file

`backend/src/modules/ats/ats-stat-card.service.ts`

Contains two exported functions: `getCandidateStatCard(candidateId)` and `getPipelineStatCard(userId, filters)`.

No new route file — both routes are wired into the existing `atsRouter` in `ats.routes.ts`.

---

### 1a. Per-Candidate Profile Card

**Route:** `GET /api/ats/candidates/:id/stat-card`
**Auth:** `requireRole("admin", "hr", "recruiter")`

Runs parallel queries, merges into one response:

```ts
{
  candidate: {
    // core columns from ats_candidate
    id, candidate_code, full_name, mobile, email,
    applied_for_process, applied_for_branch,
    sourcing_channel, created_at, updated_at
  },
  current_stage: string,              // latest ats_candidate_stage_log.to_stage
  days_in_pipeline: number,           // DATEDIFF(NOW(), ats_candidate.created_at)
  days_in_stage: number,              // DATEDIFF(NOW(), latest stage_log.stage_date)
  stage_history: [                    // ordered ASC by stage_date
    { from_stage, to_stage, stage_date, remarks, updated_by }
  ],
  interview_slot: {                   // null if none booked
    slot_date, slot_time, branch_id, process_id, max_capacity, registered
  } | null,
  bgv_status: string | null,          // from ats_candidate.bgv_status (migration 017)
  onboarding: {                       // null if not yet converted
    status,          // from ats_onboarding_bridge.status
    employee_id,     // populated once converted to employee
    joining_date
  } | null
}
```

BGV status is on `ats_candidate.bgv_status` (added via migration `017_ats_wfm_completion.sql`). The bridge record is joined separately for onboarding progression status.

---

### 1b. Pipeline Dashboard (scoped)

**Route:** `GET /api/ats/stat-card`
**Auth:** `requireRole("admin", "hr", "recruiter", "manager", "process_manager", "branch_head")`

**Scope:** admin/hr/recruiter → unrestricted (`1=1`); manager/process_manager/branch_head → `buildScopeWhereClause` on `ats_candidate.applied_for_branch` / `applied_for_process`

Query params: `?branchId=&processId=&fromDate=&toDate=`

Response:

```ts
{
  summary: {
    total: number,
    active: number,       // not rejected/withdrawn/converted
    converted: number,    // stage = 'converted' or 'Joined'
    rejected: number
  },
  funnel: [
    { stage: string, count: number, drop_off_pct: number }
    // ordered by canonical stage order, drop_off_pct = (prev_count - count) / prev_count * 100
  ],
  by_source: [
    { channel: string, count: number, conversion_rate: number }
  ],
  by_branch: [
    { branch_id: string, branch_name: string, count: number }
  ],
  by_process: [
    { process_id: string, process_name: string, count: number }
  ],
  weekly_trend: [
    // last 8 ISO weeks
    { week_start: string, applied: number, selected: number, converted: number }
  ],
  time_to_hire_avg: number   // avg days from created_at to converted stage_date
}
```

---

## Part 2: Readiness Center

### New module

`backend/src/modules/readiness/`
- `readiness.routes.ts`
- `readiness.service.ts`

Mounted in `app.ts`: `app.use("/api/readiness", readinessRouter)`

---

### Domain clearance logic

| Domain | Source table | Column(s) used |
|---|---|---|
| LMS | `lms_certification_snapshot` | `status` (`active` = certified), `certification_name`, `synced_at` |
| BGV | `ats_candidate` | `bgv_status` (added via migration 017) |
| Onboarding | `ats_onboarding_bridge` | `status`, `employee_id` |
| Attendance | `payroll_readiness_flag` | `present_days`, `working_days` |
| Payroll | `payroll_readiness_flag` | `status` |

**No new tables required.**

**`readiness_status` computation (server-side):**
- `ready` — LMS has at least one `status = 'active'` cert AND BGV `ats_candidate.bgv_status = 'cleared'` AND onboarding `ats_onboarding_bridge.status = 'completed'` AND attendance ≥ 85% AND payroll flag `status IN ('ready','sent_to_payroll','processed')`
- `not_ready` — any hard block: `bgv_status = 'failed'` OR no active LMS cert OR onboarding bridge missing/not completed
- `partial` — everything else (some domains cleared, none hard-blocked)

---

### Routes

#### `GET /api/readiness`

List all employees with their readiness status.

**Auth:** `requireRole("admin", "hr", "manager", "process_manager", "branch_head")`
**Scope:** admin/hr → all; manager roles → `buildScopeWhereClause` on `e.branch_id` / `e.process_id`

Query params: `?branchId=&processId=&status=ready|partial|not_ready&page=1&limit=20`

Response (paginated):
```ts
{
  success: true,
  data: [
    {
      employee_id: string,
      employee_code: string,
      full_name: string,
      branch_name: string,
      process_name: string,
      readiness_status: "ready" | "partial" | "not_ready",
      domains: {
        lms:        { certified: boolean, certifications: string[], synced_at: string | null },
        bgv:        { status: string | null },   // from ats_candidate.bgv_status
        onboarding: { completed: boolean, bridge_status: string | null },
        attendance: { pct_this_month: number | null, flag: "ok" | "risk" | "blocked" },
        payroll:    { readiness_status: "pending" | "ready" | "sent_to_payroll" | "processed" | null }
      }
    }
  ],
  total: number,
  page: number,
  limit: number
}
```

Attendance flag thresholds: `ok` ≥ 85%, `risk` 70–84%, `blocked` < 70%.

---

#### `GET /api/readiness/:employeeId`

Per-employee detail with richer arrays.

**Auth:** same roles + employee can view own (own-record check via `user_id = userId`)

Response extends the list shape with:
```ts
{
  // same domains object as list view, plus:
  lms_progress: [   // from lms_learning_progress_snapshot, last 10 rows
    { module_name, completion_pct, last_updated }
  ],
  payroll_flags: [  // from payroll_readiness_flag, current period rows
    { period_start, period_end, working_days, present_days, status, readiness_notes }
  ],
  onboarding_detail: {  // ats_onboarding_bridge row joined with ats_candidate.bgv_status
    status, employee_id, joining_date, bridge_date, notes,
    bgv_status  // from ats_candidate.bgv_status
  } | null
}
```

---

## Authorization summary

| Endpoint | Roles | Scope enforcement |
|---|---|---|
| `GET /api/ats/candidates/:id/stat-card` | admin, hr, recruiter | None (flat access) |
| `GET /api/ats/stat-card` | admin, hr, recruiter, manager, process_manager, branch_head | `buildScopeWhereClause` on branch/process |
| `GET /api/readiness` | admin, hr, manager, process_manager, branch_head | `buildScopeWhereClause` on branch/process |
| `GET /api/readiness/:employeeId` | admin, hr, manager, process_manager, branch_head, employee (own only) | `hasScopedAccess` for manager roles; own-record check for employee |

---

## File change list

| Action | File |
|---|---|
| Create | `backend/src/modules/ats/ats-stat-card.service.ts` |
| Edit | `backend/src/modules/ats/ats.routes.ts` — add 2 routes |
| Create | `backend/src/modules/readiness/readiness.service.ts` |
| Create | `backend/src/modules/readiness/readiness.routes.ts` |
| Edit | `backend/src/app.ts` — mount readiness router |

No SQL migrations required.

---

## Constraints and non-goals

- No new database tables.
- Do not rebuild or duplicate LMS curriculum/assessment data — read only from `lms_certification_snapshot` and `lms_learning_progress_snapshot` (existing sync outputs).
- The readiness computation is deterministic and stateless — computed on read, not stored.
- No mock or demo data in production paths.
- BGV data comes from `ats_onboarding_bridge` only — do not create a separate BGV table or service.
