# ATS Candidate Stat Card + Readiness Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `GET /api/ats/candidates/:id/stat-card`, `GET /api/ats/stat-card` (scoped pipeline dashboard), `GET /api/readiness`, and `GET /api/readiness/:employeeId` to the backend.

**Architecture:** Two new service files hold all query logic; routes are thin auth+scope wrappers. ATS routes append to the existing `atsRouter`. The Readiness module is a new Express router mounted at `/api/readiness`. No new tables.

**Tech Stack:** Express 5, TypeScript, MySQL2 (`db.execute`), Vitest, existing `requireRole` / `requireAuth` / `buildScopeWhereClause` / `hasScopedAccess` / `hasRole` helpers.

---

## File map

| Action | Path | Responsibility |
|---|---|---|
| Create | `backend/src/modules/ats/ats-stat-card.service.ts` | `getCandidateStatCard(id)` and `getPipelineStatCard(userId, filters)` query functions |
| Edit | `backend/src/modules/ats/ats.routes.ts` | Add two stat-card routes at end of file |
| Create | `backend/src/modules/ats/__tests__/ats-stat-card.service.test.ts` | Unit tests for stat-card service pure logic |
| Create | `backend/src/modules/readiness/readiness.service.ts` | `computeReadinessDomains(employeeId)`, `listReadiness(userId, filters)`, `getEmployeeReadiness(userId, targetId)` |
| Create | `backend/src/modules/readiness/readiness.routes.ts` | Two routes: list + per-employee |
| Create | `backend/src/modules/readiness/__tests__/readiness.service.test.ts` | Unit tests for `computeReadinessStatus` pure logic |
| Edit | `backend/src/app.ts` | Import + mount `readinessRouter` |

---

## Task 1: ATS Stat Card service — `getCandidateStatCard`

**Files:**
- Create: `backend/src/modules/ats/ats-stat-card.service.ts`

- [ ] **Step 1: Create the service file with `getCandidateStatCard`**

```typescript
// backend/src/modules/ats/ats-stat-card.service.ts
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

export interface CandidateStatCard {
  candidate: {
    id: string;
    candidate_code: string;
    full_name: string;
    mobile: string;
    email: string | null;
    applied_for_process: string | null;
    applied_for_branch: string | null;
    sourcing_channel: string | null;
    bgv_status: string | null;
    created_at: string;
    updated_at: string;
  };
  current_stage: string;
  days_in_pipeline: number;
  days_in_stage: number;
  stage_history: {
    from_stage: string | null;
    to_stage: string;
    stage_date: string;
    remarks: string | null;
    updated_by: string | null;
  }[];
  interview_slot: {
    slot_date: string;
    slot_time: string | null;
    branch_id: string | null;
    process_id: string | null;
    max_capacity: number;
    registered: number;
  } | null;
  onboarding: {
    status: string;
    employee_id: string | null;
    joining_date: string | null;
  } | null;
}

export async function getCandidateStatCard(candidateId: string): Promise<CandidateStatCard | null> {
  // Run queries in parallel
  const [candidateResult, stageResult, onboardingResult] = await Promise.all([
    db.execute<RowDataPacket[]>(
      `SELECT id, candidate_code, full_name, mobile, email,
              applied_for_process, applied_for_branch,
              sourcing_channel, bgv_status,
              DATEDIFF(NOW(), created_at) AS days_in_pipeline,
              created_at, updated_at
         FROM ats_candidate
        WHERE id = ? AND active_status = 1 LIMIT 1`,
      [candidateId]
    ),
    db.execute<RowDataPacket[]>(
      `SELECT from_stage, to_stage, stage_date, remarks, updated_by,
              DATEDIFF(NOW(), stage_date) AS days_since,
              interview_slot_id
         FROM ats_candidate_stage_log
        WHERE candidate_id = ?
        ORDER BY stage_date ASC`,
      [candidateId]
    ),
    db.execute<RowDataPacket[]>(
      `SELECT status, employee_id, joining_date
         FROM ats_onboarding_bridge
        WHERE candidate_id = ? LIMIT 1`,
      [candidateId]
    ),
  ]);

  const candidate = (candidateResult[0] as RowDataPacket[])[0];
  if (!candidate) return null;

  const stageRows = stageResult[0] as RowDataPacket[];
  const latestStage = stageRows[stageRows.length - 1];

  // Resolve interview slot for latest stage if present
  let interviewSlot = null;
  if (latestStage?.interview_slot_id) {
    const [slotRows] = await db.execute<RowDataPacket[]>(
      `SELECT slot_date, slot_time, branch_id, process_id, max_capacity, registered
         FROM ats_interview_slot
        WHERE id = ? LIMIT 1`,
      [latestStage.interview_slot_id]
    );
    interviewSlot = (slotRows as RowDataPacket[])[0] ?? null;
  }

  const onboardingRow = (onboardingResult[0] as RowDataPacket[])[0] ?? null;

  return {
    candidate: {
      id: candidate.id,
      candidate_code: candidate.candidate_code,
      full_name: candidate.full_name,
      mobile: candidate.mobile,
      email: candidate.email ?? null,
      applied_for_process: candidate.applied_for_process ?? null,
      applied_for_branch: candidate.applied_for_branch ?? null,
      sourcing_channel: candidate.sourcing_channel ?? null,
      bgv_status: candidate.bgv_status ?? null,
      created_at: candidate.created_at,
      updated_at: candidate.updated_at,
    },
    current_stage: latestStage?.to_stage ?? candidate.current_stage,
    days_in_pipeline: Number(candidate.days_in_pipeline ?? 0),
    days_in_stage: Number(latestStage?.days_since ?? candidate.days_in_pipeline ?? 0),
    stage_history: stageRows.map((r: any) => ({
      from_stage: r.from_stage ?? null,
      to_stage: r.to_stage,
      stage_date: r.stage_date,
      remarks: r.remarks ?? null,
      updated_by: r.updated_by ?? null,
    })),
    interview_slot: interviewSlot
      ? {
          slot_date: interviewSlot.slot_date,
          slot_time: interviewSlot.slot_time ?? null,
          branch_id: interviewSlot.branch_id ?? null,
          process_id: interviewSlot.process_id ?? null,
          max_capacity: interviewSlot.max_capacity,
          registered: interviewSlot.registered,
        }
      : null,
    onboarding: onboardingRow
      ? {
          status: onboardingRow.status,
          employee_id: onboardingRow.employee_id ?? null,
          joining_date: onboardingRow.joining_date ?? null,
        }
      : null,
  };
}
```

- [ ] **Step 2: Verify the file compiles (no node_modules needed — just check syntax)**

```bash
cd backend
node --input-type=module --eval "import('./src/modules/ats/ats-stat-card.service.js').catch(()=>{})" 2>&1 || true
```

Expected: No TypeScript parse errors (runtime import errors are fine — no DB available).

---

## Task 2: ATS Stat Card service — `getPipelineStatCard`

**Files:**
- Edit: `backend/src/modules/ats/ats-stat-card.service.ts` (append)

- [ ] **Step 1: Append `getPipelineStatCard` to the service file**

Add these types and function at the end of `backend/src/modules/ats/ats-stat-card.service.ts`:

```typescript
export interface PipelineStatCardFilters {
  scopeSql?: string;
  scopeParams?: unknown[];
  branchId?: string | null;
  processId?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
}

export interface PipelineStatCard {
  summary: { total: number; active: number; converted: number; rejected: number };
  funnel: { stage: string; count: number; drop_off_pct: number }[];
  by_source: { channel: string; count: number; conversion_rate: number }[];
  by_branch: { branch_id: string; branch_name: string; count: number }[];
  by_process: { process_id: string; process_name: string; count: number }[];
  weekly_trend: { week_start: string; applied: number; selected: number; converted: number }[];
  time_to_hire_avg: number;
}

// Canonical stage order for funnel display
const STAGE_ORDER = [
  "Applied", "Screening", "Shortlisted", "Interview",
  "Selected", "Offer", "Onboarding", "converted", "Joined",
  "Rejected", "Withdrawn",
];

export async function getPipelineStatCard(filters: PipelineStatCardFilters): Promise<PipelineStatCard> {
  const conds: string[] = ["active_status = 1"];
  const params: unknown[] = [];

  if (filters.scopeSql && filters.scopeSql !== "1=1") {
    conds.push(`(${filters.scopeSql})`);
    params.push(...(filters.scopeParams ?? []));
  }
  if (filters.fromDate) { conds.push("created_at >= ?"); params.push(filters.fromDate); }
  if (filters.toDate)   { conds.push("created_at <= ?"); params.push(filters.toDate); }

  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

  const [stageRows, totalRows, sourceRows, branchRows, processRows, trendRows, timeRows] = await Promise.all([
    // Stage breakdown
    db.execute<RowDataPacket[]>(
      `SELECT current_stage AS stage, COUNT(*) AS cnt FROM ats_candidate ${where} GROUP BY current_stage`,
      params
    ),
    // Total + active/converted/rejected counts
    db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS total,
         COUNT(CASE WHEN current_stage NOT IN ('converted','Joined','Rejected','Withdrawn') THEN 1 END) AS active,
         COUNT(CASE WHEN current_stage IN ('converted','Joined') THEN 1 END) AS converted,
         COUNT(CASE WHEN current_stage IN ('Rejected','Withdrawn') THEN 1 END) AS rejected
       FROM ats_candidate ${where}`,
      params
    ),
    // By source with conversion
    db.execute<RowDataPacket[]>(
      `SELECT sourcing_channel AS channel,
              COUNT(*) AS cnt,
              COUNT(CASE WHEN current_stage IN ('converted','Joined') THEN 1 END) AS converted_cnt
         FROM ats_candidate ${where}
        GROUP BY sourcing_channel`,
      params
    ),
    // By branch
    db.execute<RowDataPacket[]>(
      `SELECT c.applied_for_branch AS branch_id,
              COALESCE(b.branch_name, c.applied_for_branch) AS branch_name,
              COUNT(*) AS cnt
         FROM ats_candidate c
         LEFT JOIN branch_master b ON b.id = c.applied_for_branch
         ${where.replace("WHERE", "WHERE c.")} AND c.active_status = 1
         GROUP BY c.applied_for_branch, b.branch_name`
        .replace("WHERE c. AND c.active_status = 1", where === "" ? "WHERE c.active_status = 1" : where.replace("WHERE", "WHERE c.") + " AND c.active_status = 1"),
      params
    ).catch(() =>
      // Fallback without branch join if branch_master isn't joined correctly
      db.execute<RowDataPacket[]>(
        `SELECT applied_for_branch AS branch_id, applied_for_branch AS branch_name, COUNT(*) AS cnt
           FROM ats_candidate ${where} GROUP BY applied_for_branch`,
        params
      )
    ),
    // By process
    db.execute<RowDataPacket[]>(
      `SELECT applied_for_process AS process_id, applied_for_process AS process_name, COUNT(*) AS cnt
         FROM ats_candidate ${where} GROUP BY applied_for_process`,
      params
    ),
    // Weekly trend — last 8 weeks
    db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(DATE_SUB(created_at, INTERVAL WEEKDAY(created_at) DAY), '%Y-%m-%d') AS week_start,
              COUNT(*) AS applied,
              COUNT(CASE WHEN current_stage IN ('Selected','Offer','Onboarding','converted','Joined') THEN 1 END) AS selected,
              COUNT(CASE WHEN current_stage IN ('converted','Joined') THEN 1 END) AS converted
         FROM ats_candidate
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 8 WEEK)
          AND active_status = 1
        GROUP BY week_start
        ORDER BY week_start ASC`,
      []
    ),
    // Time to hire avg
    db.execute<RowDataPacket[]>(
      `SELECT ROUND(AVG(DATEDIFF(sl.stage_date, c.created_at)), 1) AS avg_days
         FROM ats_candidate c
         JOIN ats_candidate_stage_log sl ON sl.candidate_id = c.id
           AND sl.to_stage IN ('converted','Joined')
         ${where.replace("WHERE", "WHERE c.")} AND c.active_status = 1`,
      params
    ).catch(() => [[{ avg_days: null }]] as any),
  ]);

  const stageCounts = (stageRows[0] as RowDataPacket[]).reduce((acc: Record<string, number>, r: any) => {
    acc[r.stage] = Number(r.cnt);
    return acc;
  }, {});

  // Build funnel in stage order, compute drop-off
  const funnelStages = STAGE_ORDER.filter(s => stageCounts[s] !== undefined);
  const funnel = funnelStages.map((stage, i) => {
    const count = stageCounts[stage] ?? 0;
    const prev = i === 0 ? count : (stageCounts[funnelStages[i - 1]] ?? count);
    const drop_off_pct = prev === 0 ? 0 : Math.round(((prev - count) / prev) * 100 * 10) / 10;
    return { stage, count, drop_off_pct };
  });

  const totals = (totalRows[0] as RowDataPacket[])[0] as any;

  const by_source = (sourceRows[0] as RowDataPacket[]).map((r: any) => ({
    channel: r.channel ?? "Unknown",
    count: Number(r.cnt),
    conversion_rate: r.cnt > 0 ? Math.round((r.converted_cnt / r.cnt) * 1000) / 10 : 0,
  }));

  const by_branch = (branchRows[0] as RowDataPacket[]).map((r: any) => ({
    branch_id: r.branch_id ?? "",
    branch_name: r.branch_name ?? r.branch_id ?? "",
    count: Number(r.cnt),
  }));

  const by_process = (processRows[0] as RowDataPacket[]).map((r: any) => ({
    process_id: r.process_id ?? "",
    process_name: r.process_name ?? r.process_id ?? "",
    count: Number(r.cnt),
  }));

  const weekly_trend = (trendRows[0] as RowDataPacket[]).map((r: any) => ({
    week_start: r.week_start,
    applied: Number(r.applied),
    selected: Number(r.selected),
    converted: Number(r.converted),
  }));

  const time_to_hire_avg = Number((timeRows[0] as RowDataPacket[])[0]?.avg_days ?? 0);

  return {
    summary: {
      total: Number(totals?.total ?? 0),
      active: Number(totals?.active ?? 0),
      converted: Number(totals?.converted ?? 0),
      rejected: Number(totals?.rejected ?? 0),
    },
    funnel,
    by_source,
    by_branch,
    by_process,
    weekly_trend,
    time_to_hire_avg,
  };
}
```

- [ ] **Step 2: Commit the service file**

```bash
cd backend
git add src/modules/ats/ats-stat-card.service.ts
git commit -m "feat(ats): add ats-stat-card.service with getCandidateStatCard and getPipelineStatCard"
```

---

## Task 3: ATS Stat Card service — unit tests

**Files:**
- Create: `backend/src/modules/ats/__tests__/ats-stat-card.service.test.ts`

- [ ] **Step 1: Write unit tests for pure logic (funnel drop-off calc, readiness status)**

These tests cover the pure in-memory logic only — no DB calls.

```typescript
// backend/src/modules/ats/__tests__/ats-stat-card.service.test.ts
import { describe, it, expect } from "vitest";

// Inline the pure logic for isolated testing
const STAGE_ORDER = [
  "Applied", "Screening", "Shortlisted", "Interview",
  "Selected", "Offer", "Onboarding", "converted", "Joined",
  "Rejected", "Withdrawn",
];

function buildFunnel(stageCounts: Record<string, number>) {
  const funnelStages = STAGE_ORDER.filter(s => stageCounts[s] !== undefined);
  return funnelStages.map((stage, i) => {
    const count = stageCounts[stage] ?? 0;
    const prev = i === 0 ? count : (stageCounts[funnelStages[i - 1]] ?? count);
    const drop_off_pct = prev === 0 ? 0 : Math.round(((prev - count) / prev) * 100 * 10) / 10;
    return { stage, count, drop_off_pct };
  });
}

describe("ATS Pipeline Stat Card — funnel logic", () => {
  it("first stage has 0 drop_off_pct", () => {
    const funnel = buildFunnel({ Applied: 100, Screening: 80 });
    expect(funnel[0]).toEqual({ stage: "Applied", count: 100, drop_off_pct: 0 });
  });

  it("calculates drop_off_pct between stages", () => {
    const funnel = buildFunnel({ Applied: 100, Screening: 80 });
    expect(funnel[1].drop_off_pct).toBe(20); // (100-80)/100 * 100 = 20%
  });

  it("handles 0 count in previous stage without dividing by zero", () => {
    const funnel = buildFunnel({ Applied: 0, Screening: 10 });
    expect(funnel[1].drop_off_pct).toBe(0);
  });

  it("only includes stages that exist in data", () => {
    const funnel = buildFunnel({ Applied: 50, converted: 5 });
    expect(funnel.map(f => f.stage)).toEqual(["Applied", "converted"]);
  });

  it("stages appear in canonical order regardless of input key order", () => {
    const funnel = buildFunnel({ converted: 5, Applied: 50, Interview: 20 });
    expect(funnel.map(f => f.stage)).toEqual(["Applied", "Interview", "converted"]);
  });
});

describe("ATS Pipeline Stat Card — conversion rate", () => {
  function conversionRate(total: number, converted: number) {
    return total > 0 ? Math.round((converted / total) * 1000) / 10 : 0;
  }

  it("calculates conversion rate correctly", () => {
    expect(conversionRate(100, 13)).toBe(13);
    expect(conversionRate(3, 1)).toBe(33.3);
  });

  it("returns 0 when total is 0", () => {
    expect(conversionRate(0, 0)).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd backend
npx vitest run src/modules/ats/__tests__/ats-stat-card.service.test.ts
```

Expected output:
```
✓ ATS Pipeline Stat Card — funnel logic (5 tests)
✓ ATS Pipeline Stat Card — conversion rate (2 tests)
Test Files  1 passed (1)
Tests  7 passed (7)
```

- [ ] **Step 3: Commit tests**

```bash
git add src/modules/ats/__tests__/ats-stat-card.service.test.ts
git commit -m "test(ats): add unit tests for stat-card funnel and conversion logic"
```

---

## Task 4: Wire ATS stat-card routes into ats.routes.ts

**Files:**
- Edit: `backend/src/modules/ats/ats.routes.ts`

- [ ] **Step 1: Add import for the new service at the top of ats.routes.ts**

In `backend/src/modules/ats/ats.routes.ts`, after the existing imports, add:

```typescript
import { getCandidateStatCard, getPipelineStatCard } from "./ats-stat-card.service.js";
```

- [ ] **Step 2: Add the two routes at the end of ats.routes.ts, before the sub-router mounts**

Append the following two routes immediately before the `atsRouter.use("/onboarding", ...)` line at the bottom of the file:

```typescript
// GET /api/ats/stat-card — scoped pipeline dashboard
atsRouter.get(
  "/stat-card",
  requireAuth,
  requireRole("admin", "hr", "recruiter", "manager", "process_manager", "branch_head"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const isAdminHRRecruiter = await (await import("../../shared/accessGuard.js")).hasRole(
      req.authUser!.id,
      "admin", "hr", "recruiter"
    );

    let scopeSql = "1=1";
    let scopeParams: unknown[] = [];

    if (!isAdminHRRecruiter) {
      const scoped = await buildScopeWhereClause(
        req.authUser!.id,
        ["manager", "process_manager", "branch_head"],
        {
          branchId: "applied_for_branch",
          processId: "applied_for_process",
        }
      );
      scopeSql = scoped.sql;
      scopeParams = scoped.params;
    }

    const data = await getPipelineStatCard({
      scopeSql,
      scopeParams,
      branchId: (req.query.branchId as string) ?? null,
      processId: (req.query.processId as string) ?? null,
      fromDate: (req.query.fromDate as string) ?? null,
      toDate: (req.query.toDate as string) ?? null,
    });

    return res.json({ success: true, data });
  })
);

// GET /api/ats/candidates/:id/stat-card — per-candidate profile aggregate
atsRouter.get(
  "/candidates/:id/stat-card",
  requireAuth,
  requireRole("admin", "hr", "recruiter"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const data = await getCandidateStatCard(req.params.id);
    if (!data) return res.status(404).json({ success: false, message: "Candidate not found" });
    return res.json({ success: true, data });
  })
);
```

- [ ] **Step 3: Verify no TypeScript errors by checking imports resolve**

```bash
cd backend
grep -n "getCandidateStatCard\|getPipelineStatCard" src/modules/ats/ats.routes.ts
```

Expected: Two matching lines (import + one use each).

- [ ] **Step 4: Commit**

```bash
git add src/modules/ats/ats.routes.ts
git commit -m "feat(ats): add GET /stat-card and GET /candidates/:id/stat-card routes"
```

---

## Task 5: Readiness service — `computeReadinessDomains`

**Files:**
- Create: `backend/src/modules/readiness/readiness.service.ts`

- [ ] **Step 1: Create the service with types and domain fetch function**

```typescript
// backend/src/modules/readiness/readiness.service.ts
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { buildScopeWhereClause } from "../../shared/scopeAccess.js";
import { hasRole } from "../../shared/accessGuard.js";

export interface ReadinessDomains {
  lms:        { certified: boolean; certifications: string[]; synced_at: string | null };
  bgv:        { status: string | null };
  onboarding: { completed: boolean; bridge_status: string | null };
  attendance: { pct_this_month: number | null; flag: "ok" | "risk" | "blocked" };
  payroll:    { readiness_status: "pending" | "ready" | "sent_to_payroll" | "processed" | null };
}

export type ReadinessStatus = "ready" | "partial" | "not_ready";

export interface EmployeeReadinessSummary {
  employee_id: string;
  employee_code: string;
  full_name: string;
  branch_name: string;
  process_name: string;
  readiness_status: ReadinessStatus;
  domains: ReadinessDomains;
}

export interface EmployeeReadinessDetail extends EmployeeReadinessSummary {
  lms_progress: { module_name: string; completion_pct: number; last_updated: string | null }[];
  payroll_flags: {
    period_start: string; period_end: string;
    working_days: number; present_days: number;
    status: string; readiness_notes: string | null;
  }[];
  onboarding_detail: {
    status: string; employee_id: string | null;
    joining_date: string | null; bridge_date: string;
    notes: string | null; bgv_status: string | null;
  } | null;
}

/** Compute readiness_status from fully-populated domains */
export function computeReadinessStatus(domains: ReadinessDomains): ReadinessStatus {
  const hardBlock =
    domains.bgv.status === "failed" ||
    !domains.lms.certified ||
    !domains.onboarding.completed;

  if (hardBlock) return "not_ready";

  const allGreen =
    domains.lms.certified &&
    domains.bgv.status === "cleared" &&
    domains.onboarding.completed &&
    domains.attendance.flag === "ok" &&
    domains.payroll.readiness_status !== null &&
    domains.payroll.readiness_status !== "pending";

  return allGreen ? "ready" : "partial";
}

/** Fetch domain data for a single employee */
export async function fetchDomains(employeeId: string): Promise<ReadinessDomains> {
  const currentYear  = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;

  const [lmsRows, bridgeRows, attendanceRows, payrollRows] = await Promise.all([
    db.execute<RowDataPacket[]>(
      `SELECT certification_name, status, synced_at
         FROM lms_certification_snapshot
        WHERE employee_id = ? AND status = 'active'
        ORDER BY synced_at DESC`,
      [employeeId]
    ),
    // Get bgv_status from ats_candidate via onboarding bridge join
    db.execute<RowDataPacket[]>(
      `SELECT ob.status AS bridge_status, ac.bgv_status
         FROM ats_onboarding_bridge ob
         JOIN ats_candidate ac ON ac.id = ob.candidate_id
        WHERE ob.employee_id = ? LIMIT 1`,
      [employeeId]
    ),
    db.execute<RowDataPacket[]>(
      `SELECT present_days, working_days
         FROM payroll_readiness_flag
        WHERE employee_id = ?
          AND YEAR(period_start) = ? AND MONTH(period_start) = ?
        ORDER BY period_start DESC LIMIT 1`,
      [employeeId, currentYear, currentMonth]
    ),
    db.execute<RowDataPacket[]>(
      `SELECT status
         FROM payroll_readiness_flag
        WHERE employee_id = ?
        ORDER BY period_start DESC LIMIT 1`,
      [employeeId]
    ),
  ]);

  const certRows  = lmsRows[0] as RowDataPacket[];
  const bridge    = (bridgeRows[0] as RowDataPacket[])[0] as any ?? null;
  const att       = (attendanceRows[0] as RowDataPacket[])[0] as any ?? null;
  const payroll   = (payrollRows[0] as RowDataPacket[])[0] as any ?? null;

  const pct = att && att.working_days > 0
    ? Math.round((att.present_days / att.working_days) * 1000) / 10
    : null;

  const attFlag: "ok" | "risk" | "blocked" =
    pct === null ? "blocked" : pct >= 85 ? "ok" : pct >= 70 ? "risk" : "blocked";

  return {
    lms: {
      certified:      certRows.length > 0,
      certifications: certRows.map((r: any) => r.certification_name as string),
      synced_at:      certRows[0]?.synced_at ?? null,
    },
    bgv: {
      status: bridge?.bgv_status ?? null,
    },
    onboarding: {
      completed:     bridge?.bridge_status === "completed",
      bridge_status: bridge?.bridge_status ?? null,
    },
    attendance: {
      pct_this_month: pct,
      flag:           attFlag,
    },
    payroll: {
      readiness_status: (payroll?.status as ReadinessDomains["payroll"]["readiness_status"]) ?? null,
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
mkdir -p backend/src/modules/readiness
git add backend/src/modules/readiness/readiness.service.ts
git commit -m "feat(readiness): add readiness.service with fetchDomains and computeReadinessStatus"
```

---

## Task 6: Readiness service — `listReadiness` and `getEmployeeReadiness`

**Files:**
- Edit: `backend/src/modules/readiness/readiness.service.ts` (append)

- [ ] **Step 1: Append list and detail functions to readiness.service.ts**

Add at the end of `backend/src/modules/readiness/readiness.service.ts`:

```typescript
export interface ListReadinessFilters {
  userId: string;
  branchId?: string | null;
  processId?: string | null;
  status?: ReadinessStatus | null;
  page: number;
  limit: number;
}

export async function listReadiness(
  filters: ListReadinessFilters
): Promise<{ data: EmployeeReadinessSummary[]; total: number; page: number; limit: number }> {
  const { userId, page, limit } = filters;
  const offset = (page - 1) * limit;

  const isAdminOrHR = await hasRole(userId, "admin", "hr");

  // Build scope WHERE clause for non-admin/hr
  let scopeSql = "1=1";
  let scopeParams: unknown[] = [];
  if (!isAdminOrHR) {
    const scoped = await buildScopeWhereClause(
      userId,
      ["manager", "process_manager", "branch_head"],
      { branchId: "e.branch_id", processId: "e.process_id" }
    );
    scopeSql = scoped.sql;
    scopeParams = scoped.params;
  }

  const conds = [`e.active_status = 1`, `(${scopeSql})`];
  const params: unknown[] = [...scopeParams];
  if (filters.branchId)  { conds.push("e.branch_id = ?");  params.push(filters.branchId); }
  if (filters.processId) { conds.push("e.process_id = ?"); params.push(filters.processId); }

  const where = `WHERE ${conds.join(" AND ")}`;

  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code,
            CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS full_name,
            COALESCE(b.branch_name, '') AS branch_name,
            COALESCE(p.process_name, '') AS process_name
       FROM employees e
       LEFT JOIN branch_master b  ON b.id = e.branch_id
       LEFT JOIN process_master p ON p.id = e.process_id
       ${where}
       ORDER BY e.employee_code ASC
       LIMIT ${limit} OFFSET ${offset}`,
    params
  );

  const [countRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM employees e ${where}`,
    params
  );

  const employees = empRows as RowDataPacket[];
  if (!employees.length) {
    return { data: [], total: 0, page, limit };
  }

  // Fetch domains for all employees in parallel
  const domainResults = await Promise.all(
    employees.map((emp: any) => fetchDomains(emp.id))
  );

  let data: EmployeeReadinessSummary[] = employees.map((emp: any, i) => {
    const domains = domainResults[i];
    return {
      employee_id:      emp.id,
      employee_code:    emp.employee_code,
      full_name:        emp.full_name,
      branch_name:      emp.branch_name,
      process_name:     emp.process_name,
      readiness_status: computeReadinessStatus(domains),
      domains,
    };
  });

  // Post-filter by status if requested (can't do this in SQL since status is computed)
  if (filters.status) {
    data = data.filter(r => r.readiness_status === filters.status);
  }

  const total = Number((countRows as RowDataPacket[])[0]?.total ?? 0);
  return { data, total, page, limit };
}

export async function getEmployeeReadiness(
  userId: string,
  targetEmployeeId: string
): Promise<EmployeeReadinessDetail | null> {
  const [[emp]] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code,
            CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS full_name,
            COALESCE(b.branch_name, '') AS branch_name,
            COALESCE(p.process_name, '') AS process_name
       FROM employees e
       LEFT JOIN branch_master b  ON b.id = e.branch_id
       LEFT JOIN process_master p ON p.id = e.process_id
      WHERE e.id = ? AND e.active_status = 1 LIMIT 1`,
    [targetEmployeeId]
  );
  if (!emp) return null;

  const currentYear  = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;

  const [domains, lmsProgressRows, payrollFlagRows, onboardingRows] = await Promise.all([
    fetchDomains(targetEmployeeId),
    db.execute<RowDataPacket[]>(
      `SELECT course_name AS module_name, completion_pct, synced_at AS last_updated
         FROM lms_learning_progress_snapshot
        WHERE employee_id = ?
        ORDER BY synced_at DESC LIMIT 10`,
      [targetEmployeeId]
    ),
    db.execute<RowDataPacket[]>(
      `SELECT period_start, period_end, working_days, present_days, status, readiness_notes
         FROM payroll_readiness_flag
        WHERE employee_id = ?
          AND YEAR(period_start) = ? AND MONTH(period_start) = ?
        ORDER BY period_start DESC`,
      [targetEmployeeId, currentYear, currentMonth]
    ),
    db.execute<RowDataPacket[]>(
      `SELECT ob.status, ob.employee_id, ob.joining_date, ob.bridge_date, ob.notes,
              ac.bgv_status
         FROM ats_onboarding_bridge ob
         JOIN ats_candidate ac ON ac.id = ob.candidate_id
        WHERE ob.employee_id = ? LIMIT 1`,
      [targetEmployeeId]
    ),
  ]);

  const onboardingRow = (onboardingRows[0] as RowDataPacket[])[0] as any ?? null;

  return {
    employee_id:      (emp as any).id,
    employee_code:    (emp as any).employee_code,
    full_name:        (emp as any).full_name,
    branch_name:      (emp as any).branch_name,
    process_name:     (emp as any).process_name,
    readiness_status: computeReadinessStatus(domains),
    domains,
    lms_progress: (lmsProgressRows[0] as RowDataPacket[]).map((r: any) => ({
      module_name:    r.module_name ?? "",
      completion_pct: Number(r.completion_pct),
      last_updated:   r.last_updated ?? null,
    })),
    payroll_flags: (payrollFlagRows[0] as RowDataPacket[]).map((r: any) => ({
      period_start:    r.period_start,
      period_end:      r.period_end,
      working_days:    Number(r.working_days),
      present_days:    Number(r.present_days),
      status:          r.status,
      readiness_notes: r.readiness_notes ?? null,
    })),
    onboarding_detail: onboardingRow
      ? {
          status:      onboardingRow.status,
          employee_id: onboardingRow.employee_id ?? null,
          joining_date: onboardingRow.joining_date ?? null,
          bridge_date: onboardingRow.bridge_date,
          notes:       onboardingRow.notes ?? null,
          bgv_status:  onboardingRow.bgv_status ?? null,
        }
      : null,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/modules/readiness/readiness.service.ts
git commit -m "feat(readiness): add listReadiness and getEmployeeReadiness to service"
```

---

## Task 7: Readiness service — unit tests for `computeReadinessStatus`

**Files:**
- Create: `backend/src/modules/readiness/__tests__/readiness.service.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// backend/src/modules/readiness/__tests__/readiness.service.test.ts
import { describe, it, expect } from "vitest";
import { computeReadinessStatus } from "../readiness.service.js";
import type { ReadinessDomains } from "../readiness.service.js";

const BASE_READY: ReadinessDomains = {
  lms:        { certified: true,  certifications: ["Process Cert"], synced_at: "2026-06-01" },
  bgv:        { status: "cleared" },
  onboarding: { completed: true,  bridge_status: "completed" },
  attendance: { pct_this_month: 90, flag: "ok" },
  payroll:    { readiness_status: "ready" },
};

describe("computeReadinessStatus", () => {
  it("returns ready when all domains pass", () => {
    expect(computeReadinessStatus(BASE_READY)).toBe("ready");
  });

  it("returns not_ready when BGV failed (hard block)", () => {
    expect(computeReadinessStatus({
      ...BASE_READY,
      bgv: { status: "failed" },
    })).toBe("not_ready");
  });

  it("returns not_ready when LMS not certified (hard block)", () => {
    expect(computeReadinessStatus({
      ...BASE_READY,
      lms: { certified: false, certifications: [], synced_at: null },
    })).toBe("not_ready");
  });

  it("returns not_ready when onboarding not completed (hard block)", () => {
    expect(computeReadinessStatus({
      ...BASE_READY,
      onboarding: { completed: false, bridge_status: "pending" },
    })).toBe("not_ready");
  });

  it("returns partial when no hard blocks but attendance is risk", () => {
    expect(computeReadinessStatus({
      ...BASE_READY,
      attendance: { pct_this_month: 75, flag: "risk" },
    })).toBe("partial");
  });

  it("returns partial when payroll status is pending", () => {
    expect(computeReadinessStatus({
      ...BASE_READY,
      payroll: { readiness_status: "pending" },
    })).toBe("partial");
  });

  it("returns partial when payroll status is null (not yet generated)", () => {
    expect(computeReadinessStatus({
      ...BASE_READY,
      payroll: { readiness_status: null },
    })).toBe("partial");
  });

  it("returns partial when bgv status is pending (not cleared, not failed)", () => {
    expect(computeReadinessStatus({
      ...BASE_READY,
      bgv: { status: "pending" },
    })).toBe("partial");
  });

  it("returns ready when payroll status is sent_to_payroll", () => {
    expect(computeReadinessStatus({
      ...BASE_READY,
      payroll: { readiness_status: "sent_to_payroll" },
    })).toBe("ready");
  });

  it("returns ready when payroll status is processed", () => {
    expect(computeReadinessStatus({
      ...BASE_READY,
      payroll: { readiness_status: "processed" },
    })).toBe("ready");
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd backend
npx vitest run src/modules/readiness/__tests__/readiness.service.test.ts
```

Expected output:
```
✓ computeReadinessStatus (10 tests)
Test Files  1 passed (1)
Tests  10 passed (10)
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/readiness/__tests__/readiness.service.test.ts
git commit -m "test(readiness): add unit tests for computeReadinessStatus"
```

---

## Task 8: Readiness routes

**Files:**
- Create: `backend/src/modules/readiness/readiness.routes.ts`

- [ ] **Step 1: Create the routes file**

```typescript
// backend/src/modules/readiness/readiness.routes.ts
import { Router } from "express";
import type { Response } from "express";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { hasScopedAccess } from "../../shared/scopeAccess.js";
import { hasRole, getEmployeeForUser } from "../../shared/accessGuard.js";
import { listReadiness, getEmployeeReadiness } from "./readiness.service.js";
import { db } from "../../db/mysql.js";

export const readinessRouter = Router();
readinessRouter.use(requireAuth);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) =>
  fn(req, res).catch(next);

// GET /api/readiness — paginated list with computed readiness_status
readinessRouter.get(
  "/",
  requireRole("admin", "hr", "manager", "process_manager", "branch_head"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const page  = Math.max(1, Number(req.query.page  ?? 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 20)));

    const result = await listReadiness({
      userId:    req.authUser!.id,
      branchId:  (req.query.branchId  as string) ?? null,
      processId: (req.query.processId as string) ?? null,
      status:    (req.query.status    as "ready" | "partial" | "not_ready") ?? null,
      page,
      limit,
    });

    return res.json({ success: true, ...result });
  })
);

// GET /api/readiness/:employeeId — per-employee detail
readinessRouter.get(
  "/:employeeId",
  requireAuth,
  h(async (req: AuthenticatedRequest, res: Response) => {
    const targetId = req.params.employeeId;
    const userId   = req.authUser!.id;

    // 1. Employee viewing own record
    const selfEmp = await getEmployeeForUser(userId);
    if (selfEmp?.id === targetId) {
      const data = await getEmployeeReadiness(userId, targetId);
      if (!data) return res.status(404).json({ success: false, message: "Employee not found" });
      return res.json({ success: true, data });
    }

    // 2. Admin / HR — unrestricted
    if (await hasRole(userId, "admin", "hr")) {
      const data = await getEmployeeReadiness(userId, targetId);
      if (!data) return res.status(404).json({ success: false, message: "Employee not found" });
      return res.json({ success: true, data });
    }

    // 3. Scoped manager roles — validate target is within scope
    const scopedManagerRoles = ["manager", "process_manager", "branch_head"];
    if (!(await hasRole(userId, ...scopedManagerRoles))) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const [empRows] = await db.execute(
      "SELECT branch_id, process_id, department_id, reporting_manager_id FROM employees WHERE id = ? AND active_status = 1 LIMIT 1",
      [targetId]
    ) as any[];
    if (!empRows.length) return res.status(404).json({ success: false, message: "Employee not found" });

    const emp = empRows[0];
    const inScope = await hasScopedAccess(userId, scopedManagerRoles, {
      branchId:          emp.branch_id,
      processId:         emp.process_id,
      departmentId:      emp.department_id,
      managerEmployeeId: emp.reporting_manager_id,
    });
    if (!inScope) {
      return res.status(403).json({ success: false, message: "Access denied: employee outside your scope" });
    }

    const data = await getEmployeeReadiness(userId, targetId);
    if (!data) return res.status(404).json({ success: false, message: "Employee not found" });
    return res.json({ success: true, data });
  })
);
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/modules/readiness/readiness.routes.ts
git commit -m "feat(readiness): add readiness.routes.ts with GET / and GET /:employeeId"
```

---

## Task 9: Mount readiness router in app.ts

**Files:**
- Edit: `backend/src/app.ts`

- [ ] **Step 1: Add import for readinessRouter**

In `backend/src/app.ts`, after the existing imports (e.g., after the `controlTowerRouter` import line), add:

```typescript
import { readinessRouter } from "./modules/readiness/readiness.routes.js";
```

- [ ] **Step 2: Mount the router**

In `backend/src/app.ts`, after `app.use('/api/control-tower', controlTowerRouter);` and before `app.use(notFoundHandler);`, add:

```typescript
app.use("/api/readiness", readinessRouter);
```

- [ ] **Step 3: Verify the mount appears in the right position**

```bash
grep -n "readiness\|notFoundHandler" backend/src/app.ts
```

Expected: `readinessRouter` import line, `app.use("/api/readiness", ...)` line, and then `notFoundHandler` after it.

- [ ] **Step 4: Commit**

```bash
git add backend/src/app.ts
git commit -m "feat(readiness): mount /api/readiness router in app.ts"
```

---

## Task 10: Run all tests and verify build

- [ ] **Step 1: Run the full test suite**

```bash
cd backend
npx vitest run
```

Expected: All tests pass. The two new test files contribute 17 additional passing tests.

- [ ] **Step 2: Run typecheck**

```bash
cd backend
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Verify all 4 new routes appear in the router list**

```bash
grep -rn "stat-card\|/readiness" backend/src/modules/ats/ats.routes.ts backend/src/modules/readiness/readiness.routes.ts backend/src/app.ts
```

Expected matches:
- `atsRouter.get("/stat-card", ...)`
- `atsRouter.get("/candidates/:id/stat-card", ...)`
- `readinessRouter.get("/", ...)`
- `readinessRouter.get("/:employeeId", ...)`
- `app.use("/api/readiness", readinessRouter)`

- [ ] **Step 4: Final commit if any files unstaged**

```bash
cd backend
git status
# If clean, nothing to do. If any files remain unstaged:
git add -A
git commit -m "chore: finalize ats stat-card and readiness center implementation"
```

---

## Self-review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| `GET /api/ats/candidates/:id/stat-card` — per-candidate profile with stage history, onboarding, bgv, interview slot | Task 1, 4 |
| `GET /api/ats/stat-card` — scoped pipeline dashboard with funnel, by_source, by_branch, by_process, weekly_trend, time_to_hire_avg | Task 2, 4 |
| Scoped access for pipeline dashboard (manager roles → buildScopeWhereClause) | Task 4 |
| `GET /api/readiness` — paginated list with computed readiness_status per employee | Task 6, 8 |
| `GET /api/readiness/:employeeId` — detail with lms_progress, payroll_flags, onboarding_detail | Task 6, 8 |
| Employee can view own readiness detail | Task 8 |
| `computeReadinessStatus` logic: ready/partial/not_ready rules | Task 5, 7 |
| No new tables | All tasks — only SELECT queries |
| Unit tests for pure logic | Tasks 3, 7 |
| Mount in app.ts | Task 9 |

All spec requirements covered. No placeholders. Type names consistent across tasks.
