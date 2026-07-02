# WFM Auto-Roster Engine — Final Technical Specification
**Version:** 1.0  
**Date:** 2026-06-20  
**Status:** Implementation Complete (Static Validated)

---

## Overview

The WFM Auto-Roster Engine is a demand-driven workforce planning and roster governance system that:
1. Calculates required headcount from forecast demand using 8 workload-specific formulas
2. Generates weekly rosters respecting capacity, preferences, fairness, and business rules
3. Enforces employee acknowledgement and manager review workflows
4. Publishes final approved rosters to RTA (Real-Time Adherence) for live tracking
5. Maintains complete audit trail for compliance and analytics

---

## Process Workload Types (8 Types)

### 1. Inbound Voice
**Formula:** Erlang-lite  
**Key Parameters:**
- `forecast_calls` — Expected inbound call volume
- `aht_seconds` — Average Handle Time in seconds
- `shrinkage_pct` — Shrinkage percentage (breaks, training, etc.)
- `service_level_target_pct` — Service level target (e.g., 80%)
- `answer_time_seconds` — Target answer time (e.g., 20s)

**Calculation:**
```
workload_hours = (forecast_calls × aht_seconds) / 3600
base_hc = workload_hours × 1.15  // 15% Erlang overhead for variability
productive_hc = Math.ceil(base_hc)
planned_hc = Math.ceil(productive_hc / (1 - shrinkage_pct/100))
```

### 2. Outbound Voice
**Formula:** Campaign-based  
**Key Parameters:**
- `target_attempts` or `target_contacts` or `target_sales`
- `connect_rate_pct` — Contact success rate
- `conversion_rate_pct` — Sales conversion rate
- `dials_per_agent_hour` — Agent productivity

**Calculation:**
```
If target_attempts:
  productive_hc = Math.ceil(target_attempts / dials_per_agent_hour)
If target_contacts:
  required_attempts = target_contacts / (connect_rate_pct / 100)
  productive_hc = Math.ceil(required_attempts / dials_per_agent_hour)
If target_sales:
  required_contacts = target_sales / (conversion_rate_pct / 100)
  required_attempts = required_contacts / (connect_rate_pct / 100)
  productive_hc = Math.ceil(required_attempts / dials_per_agent_hour)
planned_hc = Math.ceil(productive_hc / (1 - shrinkage_pct/100))
```

### 3. Chat
**Formula:** Concurrency-based  
**Key Parameters:**
- `chat_volume` — Expected chat sessions
- `avg_chat_duration_seconds` — Average chat duration
- `chat_concurrency` — Concurrent chats per agent (e.g., 3)
- `shrinkage_pct`

**Calculation:**
```
total_handle_minutes = (chat_volume × avg_chat_duration_seconds) / 60
available_minutes_per_agent = 60 × chat_concurrency  // per hour
productive_hc = Math.ceil(total_handle_minutes / available_minutes_per_agent)
planned_hc = Math.ceil(productive_hc / (1 - shrinkage_pct/100))
```

### 4. Email
**Formula:** Backlog + SLA-based  
**Key Parameters:**
- `new_email_volume` — New emails expected
- `backlog_volume` — Existing backlog to clear
- `sla_due_volume` — Emails at risk of SLA breach
- `emails_per_agent_hour` — Agent productivity
- `shrinkage_pct`

**Calculation:**
```
total_emails = new_email_volume + backlog_volume + sla_due_volume
productive_hc = Math.ceil(total_emails / emails_per_agent_hour)
planned_hc = Math.ceil(productive_hc / (1 - shrinkage_pct/100))
```

### 5. Backoffice
**Formula:** Cases per hour  
**Key Parameters:**
- `case_volume` — Cases to process
- `cases_per_agent_hour` — Agent productivity
- `quality_recheck_pct` — QA recheck percentage (adds workload)
- `shrinkage_pct`

**Calculation:**
```
effective_cases = case_volume × (1 + quality_recheck_pct / 100)
productive_hc = Math.ceil(effective_cases / cases_per_agent_hour)
planned_hc = Math.ceil(productive_hc / (1 - shrinkage_pct/100))
```

### 6. Data Verification
**Formula:** Same as Backoffice (cases per hour + QA surcharge)

### 7. Audit / Quality
**Formula:** Sample-based  
**Key Parameters:**
- `production_volume` — Total production volume to audit
- `audit_sample_pct` — Audit sample percentage (e.g., 5%)
- `audits_per_qa_hour` — QA agent productivity
- `shrinkage_pct`

**Calculation:**
```
audits_required = Math.ceil(production_volume × (audit_sample_pct / 100))
productive_hc = Math.ceil(audits_required / audits_per_qa_hour)
planned_hc = Math.ceil(productive_hc / (1 - shrinkage_pct/100))
```

### 8. Blended
**Formula:** Sum of sub-streams  
**Key Parameters:**
- `workload_config` JSON with sub-stream allocations
- All parameters from relevant sub-types

**Calculation:**
```
Parse workload_config JSON → get sub-stream splits
Calculate HC for each sub-stream using its formula
Sum all sub-stream planned_hc
```

---

## HC Calculation Flow

### Step 1: Define Planning Rule
**Table:** `wfm_process_planning_rule`  
**Action:** HR/WFM creates rule with workload_type + all formula parameters  
**API:** `POST /api/wfm/planning-rules`

**Example:**
```json
{
  "process_id": "uuid-123",
  "workload_type": "inbound_voice",
  "effective_from": "2026-06-23",
  "aht_seconds": 300,
  "shrinkage_pct": 20,
  "service_level_target_pct": 80,
  "answer_time_seconds": 20
}
```

### Step 2: Enter Forecast Demand
**Table:** `wfm_slot_requirement`  
**Action:** Planner enters forecast volume per slot  
**API:** `POST /api/wfm/slot-requirements`

**Example:**
```json
{
  "process_id": "uuid-123",
  "requirement_date": "2026-06-25",
  "slot_start": "09:00",
  "slot_end": "17:00",
  "workload_type": "inbound_voice",
  "forecast_calls": 500,
  "source_type": "manual"
}
```

### Step 3: Calculate HC
**Service:** `hcCalculation.service.ts`  
**Action:** Engine reads planning rule + slot forecast, applies formula  
**API:** `POST /api/wfm/slot-requirements/calculate`

**Input:**
```json
{ "slotId": "uuid-456" }
```

**Output:**
```json
{
  "success": true,
  "data": {
    "required_productive_hc": 6,
    "required_planned_hc": 7,
    "calculation_method": "erlang_lite",
    "calculation_notes": {
      "forecast_calls": 500,
      "aht_seconds": 300,
      "workload_hours": 41.67,
      "base_hc": 5.56,
      "shrinkage_pct": 20,
      "shrinkage_applied": 1.11
    }
  }
}
```

**DB Update:**
```sql
UPDATE wfm_slot_requirement
   SET required_productive_hc = 6,
       required_planned_hc = 7,
       calculation_method = 'erlang_lite',
       calculation_notes = '{"workload_hours":41.67,...}',
       planning_rule_id = 'uuid-rule-789'
 WHERE id = 'uuid-456';
```

---

## Week-Off Decision Flow

### Step 1: Define Day Rules
**Table:** `process_weekoff_day_rule`  
**Action:** WFM sets per-day min HC floor + max week-off ceiling  
**API:** `POST /api/wfm/weekoff/day-rules`

**Example:**
```json
{
  "process_id": "uuid-123",
  "week_start_date": "2026-06-23",
  "min_hc_monday": 5,
  "min_hc_tuesday": 5,
  "min_hc_wednesday": 5,
  "min_hc_thursday": 5,
  "min_hc_friday": 5,
  "min_hc_saturday": 3,
  "min_hc_sunday": 3,
  "max_weekoff_monday": 3,
  "fcfs_enabled": 1,
  "preference_priority_enabled": 1,
  "manager_override_allowed": 1
}
```

### Step 2: Employee Submits Preference
**Table:** `week_off_preference`  
**Action:** Employee submits preferred week-off day  
**API:** `POST /api/wfm/my-weekoff` (employee self-service)

**Example:**
```json
{
  "employee_id": "EMP-001",
  "week_start_date": "2026-06-23",
  "preferred_day_1": 1,  // Monday
  "preferred_day_2": 2,  // Tuesday (alternate)
  "reason": "Personal appointment"
}
```

### Step 3: Auto-Roster Engine Decision
**Service:** `weekoff-allocation.service.ts`  
**Logic:**
1. Collect all preferences for week
2. For each day (FCFS or priority order):
   - Check `current_allocated < max_weekoff_monday`
   - Check `rostered_hc - 1 >= min_hc_monday`
   - If both pass: GRANT, else DENY or WAITLIST
3. Write `weekoff_allocation_log` + `wfm_roster_assignment`

**Decision Types:**
- `preference_accepted` — Primary choice granted
- `alternate_assigned` — Secondary choice granted
- `no_preference_auto_assigned` — Auto-assigned to employee with no preference
- `weekoff_denied` — Demand conflict (min HC floor would be violated)

### Step 4: Employee Acknowledgement
**Table:** `wfm_roster_assignment`  
**Action:** Employee reviews and acknowledges/rejects  
**API:**
- `GET /api/wfm/my-weekoff` — View assigned roster
- `POST /api/wfm/my-weekoff/:id/acknowledge` — Accept
- `POST /api/wfm/my-weekoff/:id/reject` — Dispute (requires reason)

**State Transition:**
```
generated → pending_employee_ack → acknowledged (if accepted)
                                  → rejected_by_employee (if rejected)
```

---

## Manager Review Flow

### Step 1: Manager Queue
**API:** `GET /api/wfm/manager/weekoff-review`  
**Scope:** Manager sees ONLY employees where:
- `employee.reporting_manager_id = manager's employee_id`
- OR `process_id` exists in `user_process_scope` for manager

**Filters:** Only shows assignments with `final_roster_status IN ('rejected_by_employee', 'pending_manager_action')`

### Step 2: Manager Actions (4 Options)

#### Action 1: Realign
**API:** `POST /api/wfm/manager/weekoff-review/:id/realign`  
**Body:**
```json
{
  "new_roster_date": "2026-06-26",  // optional: change date
  "new_shift_template_id": "uuid",  // optional: change shift
  "reason": "Adjusted to Monday per employee request"
}
```
**Result:** `final_roster_status = 'realigned_by_manager'`

#### Action 2: Force Approve
**API:** `POST /api/wfm/manager/weekoff-review/:id/force-approve`  
**Body:**
```json
{
  "reason": "Business need — override employee objection"
}
```
**Result:** `final_roster_status = 'force_approved_by_manager'`

#### Action 3: Escalate to HR/WFM
**API:** `POST /api/wfm/manager/weekoff-review/:id/escalate`  
**Body:**
```json
{
  "reason": "Unable to resolve — escalating to HR for review"
}
```
**Result:** `final_roster_status = 'escalated_to_hr'`

#### Action 4: Reject Employee Request
**API:** `POST /api/wfm/manager/weekoff-review/:id/reject-request`  
**Body:**
```json
{
  "reason": "Original assignment retained — no coverage available"
}
```
**Result:** `final_roster_status = 'force_approved_by_manager'`, `manager_action_status = 'rejected_request'`  
**Audit:** `decision_type = 'manager_rejected_request'`

**Scope Check (All 4 Actions):**
```sql
-- Before UPDATE, verify manager owns employee
SELECT 1 FROM wfm_roster_assignment wra
  JOIN employees e ON e.id = wra.employee_id
  JOIN process_master pm ON pm.process_name = wra.process_name
 WHERE wra.id = ?
   AND (e.reporting_manager_id = <manager_employee_id>
    OR EXISTS (
      SELECT 1 FROM user_process_scope ups
       WHERE ups.user_id = <manager_user_id>
         AND ups.process_id = pm.id
    ))
LIMIT 1;

-- If no rows → 403 "Not authorized to act on this employee"
```

---

## RTA Final Roster Flow

### Step 1: Publish Final Roster
**API:** `POST /api/wfm/roster/publish-final`  
**Body:**
```json
{
  "processId": "uuid-123",
  "weekStartDate": "2026-06-23"
}
```

**Action:**
```sql
UPDATE wfm_roster_assignment
   SET final_roster_status = 'published_to_rta',
       published_to_rta_at = NOW()
 WHERE cycle_id = <cycle_uuid>
   AND final_roster_status IN ('acknowledged', 'approved_final',
       'force_approved_by_manager', 'realigned_by_manager')
```

### Step 2: RTA Reads Final State
**API:** `GET /api/rta/final-roster-state?date=2026-06-25&processId=uuid-123`  
**Filter:** ONLY final operational statuses

**WHERE Clause:**
```sql
WHERE wra.roster_date = ?
  AND wra.final_roster_status IN (
    'approved_final',
    'force_approved_by_manager',
    'realigned_by_manager',
    'published_to_rta'
  )
```

**Excluded (Draft/Pending Statuses):**
```
'generated'                -- Engine output, not reviewed
'pending_employee_ack'     -- Awaiting employee response
'acknowledged'             -- Ack'd but not published
'rejected_by_employee'     -- Disputed, unresolved
'pending_manager_action'   -- Awaiting manager decision
'escalated_to_hr'          -- Open escalation
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "employee_id": "EMP-001",
      "employee_code": "E001",
      "employee_name": "John Doe",
      "roster_date": "2026-06-25",
      "is_week_off": 0,
      "shift_name": "General Shift",
      "start_time": "09:00:00",
      "end_time": "18:00:00",
      "final_roster_status": "published_to_rta",
      "rta_exception_label": "Scheduled"
    },
    {
      "employee_id": "EMP-002",
      "employee_code": "E002",
      "employee_name": "Jane Smith",
      "roster_date": "2026-06-25",
      "is_week_off": 1,
      "final_roster_status": "approved_final",
      "rta_exception_label": "Week Off"
    }
  ]
}
```

---

## Audit Trail Model

### Table: roster_decision_audit

**Purpose:** Complete audit trail for all roster decisions

**Key Columns:**
- `decision_type` — ENUM with 16 values (see migration 229 + 236)
- `rule_applied` — Which business rule triggered the decision
- `override_by` — auth_user.id who made the decision
- `override_reason` — Mandatory reason text
- `override_at` — Timestamp
- `acted_by_role` — Role of actor (manager, hr, wfm, admin, system)
- `old_value_json` — State before action
- `new_value_json` — State after action

**decision_type Values:**
```
shift_assigned
weekoff_assigned
weekoff_denied
weekoff_waitlisted
shift_frozen
holiday_applied
preference_accepted
alternate_assigned
no_preference_auto_assigned
manual_override
manager_realigned
force_approved
hr_override
bulk_upload
escalated_to_hr
manager_rejected_request
```

**Example Rows:**

**Auto-Roster Engine Decision:**
```sql
INSERT INTO roster_decision_audit
  (decision_type, rule_applied, override_by, acted_by_role)
VALUES
  ('preference_accepted', 'fcfs_rule', 'system', 'system');
```

**Manager Force-Approve:**
```sql
INSERT INTO roster_decision_audit
  (decision_type, rule_applied, override_by, override_reason, acted_by_role)
VALUES
  ('force_approved', 'manager_force_approve', 'user-123',
   'Business need — coverage shortage', 'manager');
```

**Manager Reject Request:**
```sql
INSERT INTO roster_decision_audit
  (decision_type, rule_applied, override_by, override_reason, acted_by_role)
VALUES
  ('manager_rejected_request', 'manager_reject_employee_request', 'user-123',
   'Original assignment retained — no coverage available', 'manager');
```

---

## Role Access Matrix

| Endpoint | Admin | HR | WFM | Manager | Branch Head | Employee | Operations |
|---|---|---|---|---|---|---|---|
| GET /planning-rules | ✅ | ✅ | ✅ | ✅ | — | — | — |
| POST /planning-rules | ✅ | — | ✅ | — | — | — | — |
| POST /planning-rules/calculate | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| GET /slot-requirements | ✅ | ✅ | ✅ | ✅ | — | — | — |
| POST /slot-requirements | ✅ | — | ✅ | — | — | — | — |
| POST /slot-requirements/calculate | ✅ | — | ✅ | — | — | — | — |
| GET /weekoff/day-rules | ✅ | ✅ | ✅ | ✅ | — | — | — |
| POST /weekoff/day-rules | ✅ | — | ✅ | — | — | — | — |
| GET /weekoff/day-rules/capacity-grid | ✅ | ✅ | ✅ | ✅ | — | — | — |
| GET /my-weekoff | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (own) | — |
| POST /my-weekoff/:id/acknowledge | — | — | — | — | — | ✅ (own) | — |
| POST /my-weekoff/:id/reject | — | — | — | — | — | ✅ (own) | — |
| GET /manager/weekoff-review | ✅ | ✅ | ✅ | ✅ (scoped) | ✅ (scoped) | — | — |
| POST /manager/.../realign | ✅ | ✅ | ✅ | ✅ (scoped) | ✅ (scoped) | — | — |
| POST /manager/.../force-approve | ✅ | ✅ | ✅ | ✅ (scoped) | ✅ (scoped) | — | — |
| POST /manager/.../escalate | ✅ | ✅ | ✅ | ✅ (scoped) | ✅ (scoped) | — | — |
| POST /manager/.../reject-request | ✅ | ✅ | ✅ | ✅ (scoped) | ✅ (scoped) | — | — |
| POST /roster/publish-final | ✅ | ✅ | ✅ | — | — | — | — |
| GET /rta/final-roster-state | ✅ | ✅ | ✅ | ✅ | — | — | ✅ |

**Legend:**
- ✅ = Full access
- ✅ (own) = Employee can only see/act on their own records
- ✅ (scoped) = Manager can only see/act on their team (reporting_manager_id OR user_process_scope)
- — = No access

---

## Migration List (227-236)

| # | File | Purpose | Risk |
|---|---|---|---|
| 227 | week_off_preference_schema_fix.sql | Add 10 missing columns | LOW (additive) |
| 228 | wfm_roster_assignment_lifecycle.sql | Add 13 lifecycle columns | LOW (additive) |
| 229 | roster_decision_audit_extension.sql | Extend decision_type ENUM + 9 columns | MEDIUM (ENUM) |
| 230 | attendance_reconciliation_rta_linkage.sql | Add 3 RTA linkage columns | LOW (additive) |
| 231 | process_master_workload_type.sql | Add workload_type ENUM + JSON | LOW (additive) |
| 232 | wfm_process_planning_rule.sql | CREATE TABLE | LOW (new table) |
| 233 | wfm_slot_requirement.sql | CREATE TABLE | LOW (new table) |
| 234 | process_weekoff_day_rule.sql | CREATE TABLE + 8 seeds | LOW (new table) |
| 235 | soft_delete_wfm_planning_tables.sql | Add soft delete columns | LOW (additive) |
| 236 | add_rejected_request_decision_type.sql | Add 1 ENUM value | LOW (ENUM extend) |

**Total:** 10 migrations  
**All migrations:** Rollback SQL included  
**MySQL version required:** 8.0.16+ (for `ADD COLUMN IF NOT EXISTS` syntax)

---

## API Summary (26 New Endpoints)

### Planning Rules (5)
```
GET    /api/wfm/planning-rules
POST   /api/wfm/planning-rules
POST   /api/wfm/planning-rules/calculate
PATCH  /api/wfm/planning-rules/:id
DELETE /api/wfm/planning-rules/:id
```

### Slot Requirements (6)
```
GET    /api/wfm/slot-requirements
POST   /api/wfm/slot-requirements
POST   /api/wfm/slot-requirements/calculate
POST   /api/wfm/slot-requirements/calculate-bulk
PATCH  /api/wfm/slot-requirements/:id
DELETE /api/wfm/slot-requirements/:id
```

### Week-Off Day Rules (5)
```
GET    /api/wfm/weekoff/day-rules
POST   /api/wfm/weekoff/day-rules
PATCH  /api/wfm/weekoff/day-rules/:id
DELETE /api/wfm/weekoff/day-rules/:id
GET    /api/wfm/weekoff/day-rules/capacity-grid
```

### Manager Review (5)
```
GET    /api/wfm/manager/weekoff-review
POST   /api/wfm/manager/weekoff-review/:id/realign
POST   /api/wfm/manager/weekoff-review/:id/force-approve
POST   /api/wfm/manager/weekoff-review/:id/escalate
POST   /api/wfm/manager/weekoff-review/:id/reject-request
```

### Employee Self-Service (3)
```
GET    /api/wfm/my-weekoff
POST   /api/wfm/my-weekoff/:id/acknowledge
POST   /api/wfm/my-weekoff/:id/reject
```

### Final Roster + RTA (2)
```
POST   /api/wfm/roster/publish-final
GET    /api/rta/final-roster-state
```

---

**Specification End**
