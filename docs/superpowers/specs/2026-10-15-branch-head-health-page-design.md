# Branch Head Health Page — Design

Status: draft for review, 2026-10-15. No code written. Next step after approval: `writing-plans`.

## 1. Intent

A role-based dashboard that opens for **branch heads** and shows how their branch is doing today and
over time: people, attendance, hiring, finance, operations and quality, with a ranked "needs your
attention" list. It extends the existing emailed *Branch Health Report* into a live, drillable page.

Success: a branch head opens one page and, without asking MIS, can answer "what is wrong in my
branch today, who owns it, and where do I click to fix it". The numbers must match the emailed report
and the existing Process Operations / Process Performance pages for the same branch and date.

Non-goals (v1): editing data, revenue split per process, invoice raising, anything for DialDesk or
I-Spark, a new scoring model sold as truth (the score is explainable and configurable).

## 2. Who sees what (scope)

- **Role**: `branch_head`. Grants live in `user_roles` (plain) and `user_assignment_scope`
  (`scope_type = 'branch'`, one row per branch). A person can hold several branches and a branch can
  have several heads. `branch_head_assignments` is not used (3 seed rows only).
- **Scope resolver**: reuse `resolveDashboardScope` (`backend/src/shared/dashboardScope.ts`). When a
  head has the role but no scope row (seen: MAS60358), fall back to the employee's home branch, the
  same fallback the recipient resolver uses. Never use `employees.branch_id` alone.
- **Company rule (owner, 2026-09-24)**: MAS Call Net only. Every branch and process query goes through
  `ownCompanyBranchSql` and `notDialDeskProcessSql` (`backend/src/shared/ownCompanyCostCentre.ts`),
  and additionally requires `branch_master.active_status = 1 AND close_date IS NULL`. Today that is
  four branches: NOIDA, NOIDA-2, AHMEDABAD-JALDARSHAN, HEAD OFFICE. The filter is applied once in the
  branch resolver and passed down, so no section can leak a non-MAS branch.
- **Org-wide users** (CEO, COO, super_admin) get a branch picker with the same filter.
- **Co-heads** see identical data. No per-person filtering; the header lists the heads.
- **Switcher**: shown only when the user has 2+ branches ("All my branches" roll-up plus single
  branch). Nobody has more than one branch today; the model supports it.

## 3. Data model the page relies on

```
Branch (MAS, active)
 ├─ Cost centres (active)   billing / finance unit, mandated seats, stream, IB/OB/BO type
 │     └─ employees.cost_centre_id  → headcount, attendance, attrition
 └─ Processes (process_master)  ops unit: Process Operations metrics, TPZ dashboards, Callmaster
       └─ employees.process_id
```

- Cost centre and process are joined only through the employee and
  `cost_centre_master.process_id` (1 : 1 primary, filled by the nightly resolver, read by P&L, GRN and
  budget; **not changed by this work**).
- `finance_cost_centre_mapping_history` is the effective-dated history of that same single mapping.
- `cost_centre_process_link` (migration 2214, live) lists **extra** processes a cost centre also bills
  (Bella-Vita on 647, Reginald on 972, Housing Owner and Premium on 592, VST on 968). It is read by
  this page for the "active" rule and for labelling, never for money.
- A **process is active on this page** when it has an active MAS cost centre (by `process_id` or by
  `cost_centre_process_link`) **or** active headcount. Processes with neither go to a collapsed
  "Not mapped to a cost centre" group with a data-quality flag. They are never silently hidden.
- `BSS_*` process_master rows mirror cost centres (billing identity, usually 0 headcount, they carry
  the inbound/outbound type and mandated seats). They are shown grouped under their cost centre, not as
  separate processes.

### Billing boundary (explicit)

The page is **read-only and never drives invoicing**. Invoices are one cost centre plus free-text
particulars; bill-to, GSTIN, PO and provision are per cost centre. Revenue shown on the page is the
existing process P&L attribution (whole cost centre to its primary process). A line-level "revenue
attributed by process" view for shared cost centres is a later phase and needs finance sign-off on the
line patterns.

## 4. Architecture

### 4.1 Backend (new module `backend/src/modules/branch-head-health/`)

| Piece | Purpose |
|---|---|
| `scope.ts` | resolve the caller's MAS branches (section 2). One function, used by every route |
| `branch-head-health.routes.ts` | `GET /api/branch-head-health/overview?branchIds=&date=`, `/section/:key`, `/trend?metric=&days=` |
| `sections/*.ts` | one file per section (people, attendance, hiring, finance, ops, quality, compliance) |
| `score.ts` | health score from pillars; weights read from config, not code |
| `snapshot.worker.ts` | writes the daily snapshot for trends |

- **Reuse, do not duplicate**: people / attendance / hiring / finance sections call
  `fetchAllBranchHealthData` and `classifySignals` from `branch-health-report`
  (`query.ts`, `metrics.ts`). Thresholds stay in one place, so the page and the email cannot disagree.
- **Ops / quality**: `process-operations.service.ts` (`listProcesses`, metrics by `process_id` from
  `process_metric_actual`) restricted to the branch's active processes.
- **Callmaster**: `allowedClientIds` (`call-master.scope.ts`) plus the existing `getKPIs`,
  `getQualityTrend`, `getTopAgents`, `getFatalAgentSummary`, `getCXParameters`. Branch is resolved
  client → inbound project → process → `process_master.branch_id`; no new Callmaster SQL.
- **Process Performance V2 (TPZ)**: only link out to the existing company dashboard; its data lives in
  `db_masmis` and is not re-queried here.
- **Caching**: 60-120 s per (branch, date, section) in memory. The existing report query is heavy and a
  full-page request must never block on the slowest section.
- **Partial failure**: each section returns `{status: ok|empty|error, data, asOf}`. One failing section
  renders an inline error, the rest of the page still loads.

### 4.2 Storage (one new side table, no ALTER on hot tables)

`branch_health_snapshot(branch_id, snap_date, score, pillars_json, metrics_json)`, written once a day
by the existing scheduler. Gives trend sparklines and "vs yesterday" without recomputing history.
Registered in `runPendingMigrations.ts`. Migration number is the next free one at implementation time
(2215+; check parallel sessions first).

### 4.3 Frontend

- Add `branch_head` as a `RoleDashboardVariant` (`src/pages/dashboards/roleDashboardAccess.ts`) and in
  `backend/src/shared/dashboardAccessRegistry.ts`. Today `branch_head` has no variant of its own: it is only an allowed role on several (manager, wfm, quality, operations, employee ...).
- New `src/pages/dashboards/reference/branchhead/BranchHeadReferenceLayout.tsx`, built from the
  existing `kit/` (PulseTile, Panel, SignalList, ActionCenter, Sparkline).
- Resolution priority (decision needed, section 9): after `super_admin` and `ceo`, before `hr`, `wfm`
  and `manager`, with a visible switch to the other dashboards the user is allowed.

## 5. Page layout

1. **Hero**: branch, date, status (Healthy / Watch / Critical), health score with pillar breakdown,
   heads, "changed since yesterday".
2. **Needs your attention**: ranked critical and warning points from `classifySignals`, each with an
   owner and a deep link (GRNs pending > 3 days, absent N consecutive days, exits not closed,
   regularization backlog, over-mandate cost centres).
3. **KPI tiles** (sparkline + delta): shrinkage %, late arrivals, headcount vs mandated seats, MTD
   attrition %, budget utilisation %, open seats, offer to join %, running P&L, SLA breach %, pending
   approvals.
4. **People**: headcount by process / cost centre vs mandated seats, joiners and leavers (day, MTD),
   upcoming exits, attrition by tenure, absconder watch.
5. **Attendance and WFM**: shrinkage by slot and process, late comers by manager, roster compliance,
   regularization and leave aging, 7 / 30 day trend.
6. **Hiring and ATS**: open seats, funnel, offer to join, token SLA, requisition ageing.
7. **Finance**: budget vs consumed vs reserved by head, GRN pipeline by stage, unbudgeted GRNs, P&L and
   GRN tie-out. Uses the hidden-branch scope so IDC / Pikquick cost centres never appear.
8. **Operations and quality**: per active process, a **coverage badge** (Full / Baseline only / Not
   wired) so empty tiles are explained, not blank. Call quality, QA, fatals, AHT, SL / AL, CX
   parameters, top and bottom agents (names per redaction rules, section 9).
9. **Team leaderboard**: managers and TLs by shrinkage, late, attrition.
10. **Data health** (head and HO only): processes with no cost centre, cost centres with no process,
    over-mandate seats, stale metrics (> N days).

### Coverage tiers (observed on the 2026-10-15 data copy)

| Tier | Meaning | Examples |
|---|---|---|
| Full | dialler, funnel, risk, conduct, QA metrics | Bella-Vita, Neemans, Guardian |
| Inbound + quality | AHT, SL, AL, QA, VOC | Clovia, Dalmia, Exicom, Viega, DU Digital, IDAM |
| Outbound sale | funnel, risk, conduct, no QA | BTM |
| Baseline only | shrinkage, joiners, exits, late marks | most of AHMEDABAD-JALDARSHAN |
| Not wired | no metrics at all | SBI Credit Cards, all `BSS_*`, Head Office shared services |

## 6. Health score

Weighted 0-100 with a visible breakdown. Starting weights (configurable, to be tuned on real branches):
attendance and shrinkage 25, attrition and headcount vs mandate 20, budget and P&L 20, hiring and
conversion 15, compliance and backlog 10, quality and SLA 10. A pillar with no data is excluded and the
remaining weights are renormalised; the page says so. Status bands reuse the report's
`overallStatus` thresholds so the chip never contradicts the email.

## 7. UX requirements

Dense data-dashboard style, not decorative. Status never by colour alone (icon + label), text
contrast at least 4.5 : 1, 44 px touch targets, skeleton loaders that reserve space, reduced-motion
respected, a table alternative for every chart, responsive at 375 / 768 / 1024 / 1440, no horizontal
scroll. Every tile drills to the existing detail page or a side-panel table.

## 8. Testing and rollout

- Unit: score and thresholds; scope resolver (multi-branch head, role without scope row, org-wide).
- Contract: for the same branch and date the page's report-derived numbers equal
  `fetchAllBranchHealthData`; the page never returns a branch where `ownCompanyBranchSql` is false.
- Real data: run against the live-copy DB locally before deploy, then audit on the live site with a real
  branch-head login (mock-only checks have hidden real bugs before).
- Ship behind a feature flag, visible first to 2-3 pilot heads. No ALTER on hot tables; migration
  registered and verified on prod after deploy.

## 9. Open decisions

1. **Variant priority** for a person who is branch head and also hr / wfm / manager (section 4.3).
2. **Agent names** in quality and fatal lists: show names, or process-level aggregates only.
3. **Heads with the role but no scope row** (MAS60358): confirm home-branch fallback.
4. **IDAM / Bella-Vita billing**: are the "BVO Chat" lines on cost centre 647 invoiced to the same
   legal entity as IDAM? If not, Bella-Vita needs its own cost centre (billing owner decision).
5. **GNC** has no cost centre or invoice evidence; stays "unmapped" until the db_bill trace via the ops
   workflow (no db_bill credentials on the dev box).
6. **Data hygiene** awaiting row-level approval, none applied: cost centres 1031 / 1032 (branch vs
   code), 1048 / 1054 (no process), 984 (code mismatch), 978 (DialDesk process on a MAS cost centre),
   `BO/` seats value `'o'`, and 622 history rows with NULL process (38 active MAS).
7. **Score weights** and the trend window (7 / 30 days).

## 10. Known risks

- The page can only be as good as the wiring: Ahmedabad shows baseline metrics only until its call
  data is wired. That is surfaced, not hidden.
- Metric freshness in the inspected copy was 2026-09-09 to 09-11; the page shows `asOf` per section.
- The existing report query is heavy; caching and per-section loading are required, not optional.
- CI "Migration replay" is failing at migration 272 on every commit (pre-existing), so new migrations
  are not replay-tested in CI and must be verified on prod after deploy.
