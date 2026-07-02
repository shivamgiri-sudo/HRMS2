# PeopleOS Roster Preference Operation-Priority Addendum

**Date:** 30-May-2026  
**Status:** Mandatory addendum to `PEOPLEOS_ROSTER_BUILDER_MASTER_BLUEPRINT.md`.

---

## 1. Core Correction

Week-off preference is an employee request/input. It is **not guaranteed**.

The roster engine must always prioritise operational requirement first:

```text
Client/process coverage
→ Mandate HC
→ Buffer and shrinkage coverage
→ Skill/certification requirement
→ Approved leave already sanctioned
→ Support staff ratio
→ Safety/labour rule
→ Shift eligibility
→ Fairness/history
→ Employee week-off preference
```

If the roster cannot meet operational requirement while accepting all week-off preferences, the system must reject or partially accept some preferences and still prepare the roster to meet operations requirement.

---

## 2. Required Smart Roster Behaviour

During roster generation, the system must:

1. Load the process-specific Roster Builder Master rule.
2. Load active employee list for branch/process/LOB/cost centre.
3. Load approved leaves.
4. Load shift eligibility.
5. Load skill/certification requirements.
6. Load staffing mandate, buffer %, shrinkage and support ratios.
7. Load submitted week-off preferences.
8. Build required coverage grid.
9. Test whether preferences can be accepted safely.
10. Accept preferences that do not break coverage.
11. Reject or partially accept preferences that break operation requirement.
12. Store reason for every rejection/override.
13. Generate roster draft that fulfils operations requirement as much as available manpower allows.
14. Flag shortage if manpower is not enough even after rejecting preferences.

---

## 3. Preference Decision Status

The system must support these decision statuses:

```text
Accepted
Partially Accepted
Rejected due to Coverage Requirement
Rejected due to Skill Requirement
Rejected due to Staffing Mandate
Rejected due to Support Ratio
Rejected due to Process Rule
Rejected due to Approved Leave Conflict
Rejected due to Rotation Balance
Manual Override Required
```

---

## 4. Required Notifications

When preference is rejected, partially accepted, or changed during roster build, the system must notify:

```text
Affected Agent / Analyst
Mapped Team Leader
Mapped Assistant Manager where applicable
Process Manager
WFM owner
```

Notification channels:

```text
Portal notification
Email where configured
WhatsApp where configured
```

Minimum notification content:

```text
Roster week
Requested week-off
Final assigned week-off / shift
Decision status
Reason for rejection/change
Process / LOB / cost centre
Action required, if any
Owner/contact for clarification
```

---

## 5. Required Tables / Extensions

Add or extend these in the roster package:

```sql
weekoff_preference_decision_log
roster_notification_event
```

`weekoff_preference_decision_log` should store:

```text
id
preference_request_id
roster_generation_run_id
employee_id
requested_weekoff_json
final_decision_status
final_assigned_weekoff_json
rejection_reason_code
rejection_reason_text
decided_by_system_flag
manual_override_by
manual_override_reason
created_at
```

`roster_notification_event` should store:

```text
id
roster_generation_run_id
employee_id
recipient_role
recipient_user_id
event_type
event_payload_json
portal_notified_flag
email_dispatch_id
whatsapp_dispatch_id
created_at
```

These should connect later with:

```sql
notification_event_master
communication_template_master
communication_dispatch_log
communication_retry_log
```

---

## 6. UI Requirements

### Employee Portal

Employee must see:

```text
Requested week-off
Decision status
Final assigned week-off/shift
Reason if rejected or changed
Roster acknowledgement action
```

### Team Leader Portal

TL must see:

```text
Team preference summary
Agents whose preferences were rejected
Reason for rejection
Final roster impact
Coverage/action items
```

### Process Manager Portal

Process Manager must see:

```text
Preference acceptance vs rejection summary
Coverage fulfilment
Shortage after preference rejection
Exception list
Approval action
```

### WFM Portal

WFM must see:

```text
Roster generation run summary
Preference decision table
Coverage grid
Exception queue
Manual override option with audit
Notification dispatch status
```

---

## 7. Acceptance Criteria Addendum

Roster Builder Master is not complete unless:

1. Week-off preference is clearly labelled as not guaranteed.
2. System accepts preferences only where operations coverage remains safe.
3. System rejects/partially accepts preferences where required to meet staffing need.
4. Every rejection has a reason code and reason text.
5. Employee sees the rejection/change reason in portal.
6. TL and Process Manager see impacted employees and coverage reason.
7. Portal notification is created.
8. Email/WhatsApp dispatch is triggered where communication rules are configured.
9. Roster draft still tries to meet operation requirement first.
10. If manpower is still insufficient, shortage is flagged after preferences are rejected.

---

## 8. Codex / Claude Instruction

Use this exact rule while building roster:

```text
Week-off preference is not guaranteed. Auto-roster must satisfy operations requirement first. If accepted preferences break staffing mandate, buffer, skill/certification, coverage or support ratio, reject/partially accept preferences with reason. Notify affected Agent, TL, Process Manager and WFM through portal and configured email/WhatsApp. Then prepare roster based on available employees and flag shortage if requirement still cannot be fulfilled.
```
