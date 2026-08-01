# ATS SLA Configuration UI and TAT Rules

**Date:** 2026-08-01  
**Status:** Approved  
**Scope:** Make ATS queue SLA configurable, add Escalation Matrix UI, seed ATS recruitment TAT rules

---

## 1. Problem Statement

The HRMS has two SLA systems with gaps:

1. **ATS Queue SLA** (`sla-breach-worker.ts`) has a hardcoded 30-minute threshold — HR cannot change it without a code deploy
2. **Escalation Matrix** has DB schema and backend API but no frontend UI — admins cannot configure who gets notified at what escalation level
3. **ATS-specific TAT rules** are missing — recruitment lifecycle stages (interview delay, offer delay, document submission) aren't tracked by the TAT engine

---

## 2. Solution Overview

**Approach A (selected):** Minimal config table extension + UI enhancement

- Add `ATS_QUEUE_WAIT` row to existing `tat_matrix_master` — HR edits threshold via existing TAT Matrix UI
- Add "Escalation Rules" tab to `NativeTATMatrix.tsx` — CRUD for `escalation_matrix_master`
- SQL migration seeds ATS recruitment task types — existing TAT engine picks them up automatically

---

## 3. Data Model

### 3.1 ATS Queue SLA in TAT Matrix

New row in `tat_matrix_master`:

| Column | Value |
|--------|-------|
| task_type | `ATS_QUEUE_WAIT` |
| task_description | Walk-in candidate queue wait time before SLA breach alert |
| default_tat_hours | `0.5` (30 minutes) |
| is_active | `1` |

### 3.2 ATS Recruitment TAT Rules

| task_type | task_description | default_tat_hours |
|-----------|------------------|-------------------|
| `ATS_INTERVIEW_RESULT` | Interview feedback submission after interview | 4 |
| `ATS_OFFER_LETTER` | Offer letter generation after selection | 24 |
| `ATS_CANDIDATE_DOCS` | Document submission after offer acceptance | 48 |
| `ATS_BGV_RESULT` | BGV result update after initiation | 72 |
| `ATS_JOINING_CONFIRMATION` | Joining confirmation after DOJ | 4 |
| `ATS_ONBOARDING_COMPLETE` | Full onboarding checklist completion | 48 |

### 3.3 Escalation Matrix (existing schema)

No schema changes. Table `escalation_matrix_master` already has:
- `id` CHAR(36) PK
- `task_type` VARCHAR(100) — links to TAT rule
- `escalation_level` INT — 1, 2, 3...
- `trigger_after_hours` INT — when to fire after SLA breach
- `notify_role` VARCHAR(50) — role to notify
- `notify_user_id` CHAR(36) — specific user override
- `escalation_action` VARCHAR(50) — `notify` / `reassign` / `block`
- `is_active` TINYINT(1)

### 3.4 Default Escalation Rules for ATS_QUEUE_WAIT

| escalation_level | trigger_after_hours | notify_role | escalation_action |
|------------------|---------------------|-------------|-------------------|
| 1 | 0 | recruiter | notify |
| 2 | 1 | hr | notify |
| 3 | 2 | branch_head | notify |

---

## 4. Backend Changes

### 4.1 Modify `sla-breach-worker.ts`

Replace hardcoded constant with DB lookup:

```typescript
// BEFORE
const SLA_THRESHOLD_MINUTES = 30;

// AFTER
async function getSlaThresholdMinutes(): Promise<number> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT default_tat_hours FROM tat_matrix_master 
     WHERE task_type = 'ATS_QUEUE_WAIT' AND is_active = 1 LIMIT 1`
  );
  const hours = (rows[0] as any)?.default_tat_hours ?? 0.5;
  return Math.round(hours * 60);
}
```

Call `getSlaThresholdMinutes()` at start of each `processSLABreaches()` cycle. Changes take effect within 5 minutes without restart.

### 4.2 Extend `tat.routes.ts`

Add two routes for escalation rule management:

**PUT /tat/escalation-matrix/:id**
- Updates `trigger_after_hours`, `notify_role`, `notify_user_id`, `escalation_action`, `is_active`
- Requires `admin` or `hr` role

**DELETE /tat/escalation-matrix/:id**
- Soft delete: sets `is_active = 0`
- Requires `admin` or `hr` role

---

## 5. Frontend Changes

### 5.1 Extend `NativeTATMatrix.tsx`

Add shadcn `Tabs` component with two tabs:

**Tab 1: "TAT Rules"**
- Existing content (table of task types and TAT hours)
- Existing add/edit dialogs

**Tab 2: "Escalation Rules"**
- Table columns: Task Type | Level | Trigger After | Notify Role | Action | Status | Actions
- "Add Escalation" button
- Edit/Delete actions per row
- Optional filter dropdown by task type

### 5.2 Escalation Rule Dialog

Fields:
- **Task Type** — Select dropdown, populated from active TAT rules
- **Escalation Level** — Number input (1, 2, 3...)
- **Trigger After Hours** — Number input (hours after SLA breach when this level fires)
- **Notify Role** — Select: `recruiter`, `hr`, `branch_head`, `process_manager`, `super_admin`
- **Notify User** — Optional employee combobox (overrides role if set)
- **Action** — Select: `notify` (default), `reassign`, `block`

---

## 6. SQL Migration

File: `backend/sql/1039_ats_sla_tat_rules_seed.sql`

```sql
-- Migration 1039: ATS SLA and TAT rules seed
-- Safe to re-run: INSERT IGNORE skips duplicates on unique key

-- 1. ATS Queue wait SLA (30 min default)
INSERT IGNORE INTO tat_matrix_master (id, task_type, task_description, default_tat_hours, is_active)
VALUES (UUID(), 'ATS_QUEUE_WAIT', 'Walk-in queue wait time before SLA alert', 0.5, 1);

-- 2. ATS Recruitment lifecycle TAT rules
INSERT IGNORE INTO tat_matrix_master (id, task_type, task_description, default_tat_hours, is_active)
VALUES 
  (UUID(), 'ATS_INTERVIEW_RESULT', 'Interview feedback submission', 4, 1),
  (UUID(), 'ATS_OFFER_LETTER', 'Offer letter generation after selection', 24, 1),
  (UUID(), 'ATS_CANDIDATE_DOCS', 'Document submission after offer acceptance', 48, 1),
  (UUID(), 'ATS_BGV_RESULT', 'BGV result update after initiation', 72, 1),
  (UUID(), 'ATS_JOINING_CONFIRMATION', 'Joining confirmation after DOJ', 4, 1),
  (UUID(), 'ATS_ONBOARDING_COMPLETE', 'Full onboarding checklist completion', 48, 1);

-- 3. Default escalation rules for ATS_QUEUE_WAIT
INSERT IGNORE INTO escalation_matrix_master (id, task_type, escalation_level, trigger_after_hours, notify_role, escalation_action, is_active)
VALUES
  (UUID(), 'ATS_QUEUE_WAIT', 1, 0, 'recruiter', 'notify', 1),
  (UUID(), 'ATS_QUEUE_WAIT', 2, 1, 'hr', 'notify', 1),
  (UUID(), 'ATS_QUEUE_WAIT', 3, 2, 'branch_head', 'notify', 1);
```

---

## 7. Files to Change

| File | Change Type | Description |
|------|-------------|-------------|
| `backend/sql/1039_ats_sla_tat_rules_seed.sql` | New | Seeds TAT rules + escalation defaults |
| `backend/src/workers/sla-breach-worker.ts` | Modify | Read SLA threshold from DB instead of constant |
| `backend/src/modules/governance/tat.routes.ts` | Modify | Add PUT/DELETE routes for escalation rules |
| `src/pages/NativeTATMatrix.tsx` | Modify | Add Tabs, Escalation Rules tab with table + dialogs |

---

## 8. Testing Plan

### 8.1 Automated
- `npx tsc --noEmit` — 0 TypeScript errors
- `npm run build` — frontend build succeeds
- Existing TAT tests continue to pass

### 8.2 Manual Verification
1. Apply migration on local/staging MySQL
2. Verify `tat_matrix_master` has 7 new ATS rows
3. Verify `escalation_matrix_master` has 3 new `ATS_QUEUE_WAIT` rows
4. Open TAT Matrix page — confirm two tabs appear
5. Edit `ATS_QUEUE_WAIT` TAT hours to 0.25 (15 min)
6. Verify `sla-breach-worker.ts` picks up the new threshold (check logs)
7. Add/edit/delete escalation rules via the new UI
8. Verify escalation rules appear in the table with correct data

---

## 9. Rollback

- Migration uses `INSERT IGNORE` — re-running is safe
- Worker falls back to 0.5 hours if `ATS_QUEUE_WAIT` row missing
- New UI tab doesn't break existing TAT Rules tab
- No destructive changes to existing data

---

## 10. Open Questions

None — design is complete.
