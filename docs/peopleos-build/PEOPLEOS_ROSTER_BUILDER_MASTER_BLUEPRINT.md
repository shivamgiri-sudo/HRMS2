# PeopleOS Roster Builder Master Blueprint

**Date:** 30-May-2026  
**Status:** Mandatory product scope for WFM, Process Manager and Employee Self-Service implementation.  
**Architecture rule:** React + TypeScript frontend, Node/Express backend, MySQL `mas_hrms`.  
**Execution rule:** Do not execute SQL from this document without explicit approval.

---

## 1. Core Requirement

PeopleOS must include a **Roster Builder Master** where every process can configure its own roster-building logic. Roster generation must not be hardcoded because every BPO process can have different operational rules.

The system should be able to automatically prepare a weekly roster draft based on configured process rules and operational inputs, then allow WFM and Process Manager review before publishing.

---

## 2. Required End-to-End Flow

```text
Process / LOB / Cost Centre configured
→ Roster Builder Master configured for that process
→ Employee shift eligibility and skill/certification mapping available
→ Week-off preference window opened
→ Employees submit week-off preferences
→ Approved leaves are pulled
→ Staffing mandate, buffer %, shrinkage and support ratios are pulled
→ Auto-roster generation run starts
→ System creates weekly draft roster
→ System flags shortages, conflicts and rule violations
→ WFM reviews
→ Process Manager reviews
→ Exceptions/actions are resolved
→ Roster is published
→ Employee acknowledges roster
→ Post-publish changes are strictly audited
→ RTA, attendance, shrinkage and payroll-readiness consume published roster truth
```

---

## 3. Process-Specific Roster Builder Logic

Each process must have its own rule configuration.

Examples of process differences:

| Scenario | Process-specific rule required |
|---|---|
| 24x7 process | Minimum coverage by interval, night rotation, weekly rest constraints. |
| Fixed shift process | Same shift for all or most employees. |
| Rotational process | Rotation sequence by week/month/team. |
| Split LOB process | Different LOB may have different staffing and shift logic. |
| Sales process | Peak-hour staffing, incentive-related attendance rules. |
| Backend process | SLA/TAT-based coverage and certified-skill requirement. |
| Voice process | Language, queue, call volume and shrinkage-based coverage. |
| Client-mandated process | Client-specific holiday, staffing and reporting rules. |

Roster logic must be scoped by:

```text
Client
Branch
Process
LOB
Cost Centre
Role Group
Designation
Skill / Certification
Employment Type
```

---

## 4. Roster Builder Master Page

Required page:

```text
WFM / Masters / Roster Builder Master
```

Alternative route suggestion:

```text
/wfm/masters/roster-builder
```

### 4.1 Header configuration

Fields:

```text
Roster Logic Name
Client
Branch
Process
LOB
Cost Centre
Operation Model
Effective From
Effective To
Active Status
Created By
Approved By
```

Operation Model options:

```text
24x7
Fixed Shift
Rotational Shift
Split Shift
Weekend Coverage
Holiday Coverage
Client Calendar Based
Volume Based
Custom
```

### 4.2 Rule sections

The master page should contain rule sections/tabs:

```text
1. Shift Coverage Rules
2. Week-Off Preference Rules
3. Approved Leave Handling Rules
4. Employee Eligibility Rules
5. Skill / Certification Rules
6. Staffing Mandate and Buffer Rules
7. Support Staff Ratio Rules
8. Rotation Rules
9. Night Shift and Safety Rules
10. Holiday / Weekend Rules
11. Conflict Priority Rules
12. Approval and Publish Rules
13. Post-Publish Change Rules
```

---

## 5. Week-Off Preference — Mandatory

Week-off preference must be a first-class input to roster generation.

### 5.1 Employee journey

```text
Employee Portal
→ Roster
→ Week-Off Preference
→ Select roster week
→ Select preferred week-off day(s)
→ Add reason if required
→ Submit before cutoff
→ Track status
```

Status values:

```text
Draft
Submitted
Approved
Rejected
Used in Roster
Not Used due to Coverage
Expired
Cancelled
```

### 5.2 WFM / Process Manager journey

```text
WFM / Process Manager
→ View week-off preference summary
→ See coverage impact
→ Approve / reject / override as allowed
→ Auto-roster consumes preferences based on process rule
```

### 5.3 Rules

- Preference is not a guarantee.
- Process rule decides how much weight preference gets.
- Coverage, approved leave, skill/certification, staffing mandate and client rules can override preference.
- Override requires reason and audit.

---

## 6. Auto-Roster Inputs

Auto-roster generation must consume:

```text
Active employee list
Branch / Process / LOB / Cost Centre mapping
Employee role/designation
Employee shift eligibility
Employee skill/certification
Approved leaves
Week-off preferences
Mandate HC
Buffer percentage
Shrinkage percentage
Required support ratios
Client holiday calendar
Company holiday calendar
Existing post-publish changes
Employee restrictions if applicable
```

---

## 7. Auto-Roster Conflict Priority

When all preferences cannot be honoured, system should follow configured priority.

Example priority order:

```text
1. Mandatory client coverage
2. Minimum staffing mandate
3. Skill/certification requirement
4. Approved leave
5. Labour/safety rule
6. Support staff ratio
7. Week-off fairness/history
8. Employee week-off preference
9. Rotation balance
```

This priority must be configurable in Roster Builder Master.

---

## 8. Support Staff Ratio Rules

Roster must include support staff logic where configured:

```text
Team Leader ratio
Assistant Manager ratio
QA ratio
RTM / WFM ratio
SME ratio
Trainer ratio
Manager ratio
```

Example:

```text
1 TL required per 20 agents
1 QA required per 50 agents
1 RTM required per process/shift
1 AM required per 5 TLs
```

These ratios may be process/LOB/cost-centre specific.

---

## 9. Required Tables

Suggested MySQL tables:

```sql
roster_builder_master
roster_builder_rule
roster_builder_rule_condition
roster_builder_rule_action
roster_builder_priority_rule
weekoff_preference_rule_master
weekoff_preference_request
weekoff_preference_approval_log
employee_shift_eligibility
employee_skill_certification_map
roster_generation_run
roster_generation_draft_line
roster_generation_exception
roster_coverage_gap
roster_publish_approval
roster_post_publish_change_request
roster_post_publish_change_log
support_staff_ratio_rule
```

Do not create these in Supabase.

---

## 10. Table Purpose

| Table | Purpose |
|---|---|
| `roster_builder_master` | Header config for process-specific roster logic. |
| `roster_builder_rule` | Rule definition by rule type and priority. |
| `roster_builder_rule_condition` | Rule condition JSON, for example day, shift, role, skill, headcount. |
| `roster_builder_rule_action` | Rule action JSON, for example assign shift, block shift, require approval. |
| `roster_builder_priority_rule` | Conflict priority and tie-breaker rules. |
| `weekoff_preference_rule_master` | Process-specific week-off preference window/cutoff/weightage. |
| `weekoff_preference_request` | Employee submitted week-off preferences. |
| `weekoff_preference_approval_log` | WFM/manager approval/rejection/override audit. |
| `employee_shift_eligibility` | Which employee can work which shift type. |
| `employee_skill_certification_map` | Skill/certification required for roster assignment. |
| `roster_generation_run` | Auto-roster run header and summary. |
| `roster_generation_draft_line` | Draft assignment before publish. |
| `roster_generation_exception` | Conflicts, shortages and rule failures. |
| `roster_coverage_gap` | Required vs available HC gaps by interval/shift. |
| `roster_publish_approval` | WFM/Process Manager approval trail. |
| `roster_post_publish_change_request` | Request to change published roster. |
| `roster_post_publish_change_log` | Final audit trail for published roster changes. |
| `support_staff_ratio_rule` | TL/AM/QA/RTM/SME support coverage ratio rules. |

---

## 11. Auto-Roster Algorithm Outline

```text
Input: roster_builder_master_id + week_start

1. Load process/LOB/cost-centre roster rules.
2. Load active employees mapped to scope.
3. Load employee shift eligibility and certifications.
4. Load approved leave for roster week.
5. Load week-off preferences for roster week.
6. Load staffing mandate and buffer requirement.
7. Load support staff ratio rules.
8. Build required coverage grid by date + shift + interval + role group.
9. Remove unavailable employees due to approved leave or restrictions.
10. Score employees for each slot:
    - eligibility
    - certification
    - fairness
    - previous week-off history
    - preference match
    - rotation balance
11. Assign roster draft lines.
12. Generate exceptions where coverage cannot be met.
13. Generate support staff gaps.
14. Save generation run summary.
15. WFM reviews exceptions.
16. Process Manager reviews and approves.
17. Publish final roster.
18. Employee acknowledges.
```

---

## 12. Governance Rules

- WFM and Process Manager can own draft-to-publish weekly roster planning inside mapped process.
- Team Leaders and Assistant Managers can monitor and raise/close scoped actions.
- TL/AM cannot freely edit published roster truth.
- Post-publish changes require reason, role permission, and audit.
- Employee can submit week-off preference but cannot force roster outcome.
- Client Portal must see only aggregate roster readiness, never individual employee roster unless explicitly approved later.

---

## 13. UI Pages Required

### Employee Portal

```text
My Roster
Week-Off Preference
Roster Acknowledgement
Roster Change Notifications
```

### WFM Portal

```text
Roster Builder Master
Week-Off Preference Review
Auto-Roster Draft Generator
Roster Exceptions
Coverage Gap Dashboard
Publish Roster
Post-Publish Change Audit
```

### Process Manager Portal

```text
Roster Governance Dashboard
Draft Review
Coverage Gap Review
Week-Off Preference Impact
Publish Approval
TL/AM Accountability Actions
```

### TL / AM Portal

```text
Team Roster View
Coverage Action Queue
Late / No-Show Follow-up
Roster Exception Follow-up
```

---

## 14. Acceptance Criteria

Roster Builder Master is complete only when:

1. Process-specific roster rule can be configured from UI.
2. Week-off preference window can be configured.
3. Employee can submit week-off preference.
4. Approved leave is considered in generation.
5. Shift eligibility is considered.
6. Staffing mandate and buffer are considered.
7. Support staff ratios are considered.
8. Auto-roster draft can be generated.
9. Exceptions and shortages are visible.
10. WFM and Process Manager can review.
11. Roster can be published.
12. Employee can acknowledge roster.
13. Post-publish changes are audited.
14. RTA/attendance/payroll-readiness consume published roster truth.
15. All tests pass.
16. No SQL is executed without explicit approval.

---

## 15. Codex / Claude Instruction

When building roster package, use this exact scope:

```text
Build Process-Specific Roster Builder Master, Week-Off Preference, Auto-Roster Draft Generation and Roster Governance. Do not hardcode roster rules. Every process can have different rules. Include approved leave, employee shift eligibility, week-off preference, staffing mandate, buffer %, shrinkage and support staff ratios. Do not add QR/Kiosk attendance. Do not add generic Task/Kanban module.
```
