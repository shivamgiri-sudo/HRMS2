# PeopleOS Roster Leave Exclusion Rule Addendum

**Date:** 30-May-2026  
**Status:** Mandatory addendum to `PEOPLEOS_ROSTER_BUILDER_MASTER_BLUEPRINT.md` and `PEOPLEOS_ROSTER_PREFERENCE_OPERATION_PRIORITY_ADDENDUM.md`.

---

## 1. Core Rule

Only **approved leave** should exclude an employee from roster availability.

Unapproved leave must **not** be treated as a confirmed exclusion while preparing roster.

```text
Approved leave = employee unavailable for roster planning
Pending / submitted / unapproved leave = employee still available for roster planning, but shown as a risk/alert
Rejected / cancelled leave = employee available for roster planning
```

---

## 2. Leave Status Treatment in Roster Planning

| Leave status | Roster availability treatment | Roster action |
|---|---|---|
| Approved | Exclude employee from those date(s)/shift(s) | Do not assign unless approved leave is cancelled/revoked. |
| Pending / Submitted | Do not exclude employee | Show warning/risk to WFM and Process Manager. |
| Escalated / Awaiting approval | Do not exclude employee | Show as pending-leave risk only. |
| Rejected | Do not exclude employee | Employee remains available. |
| Cancelled | Do not exclude employee | Employee remains available. |
| Withdrawn | Do not exclude employee | Employee remains available. |
| Unapproved / No approval | Do not exclude employee | Employee remains available. |

---

## 3. Auto-Roster Engine Logic

During roster generation:

```text
1. Load approved leaves only as confirmed unavailability.
2. Remove employees from availability only for approved leave dates.
3. Load pending/submitted leaves separately as planning alerts.
4. Do not reduce available headcount for pending/unapproved leaves.
5. If a pending leave later becomes approved after roster generation, create roster exception/rework requirement.
6. If pending leave remains unapproved, roster assignment remains valid.
```

---

## 4. Interaction with Week-Off Preference

Approved leave has higher priority than week-off preference.

```text
Approved leave
→ confirmed employee unavailability
→ excluded from roster slot

Week-off preference
→ employee request only
→ can be accepted/rejected based on operations requirement

Pending leave
→ not confirmed
→ do not exclude from roster
→ show planning alert only
```

---

## 5. Planning Alerts

Pending/unapproved leave should appear in roster builder as a warning, not an exclusion.

Alert examples:

```text
Employee has pending leave request on 2026-06-05.
Roster assignment can continue because leave is not approved.
If leave gets approved later, roster exception will be generated.
```

Show alert to:

```text
WFM owner
Process Manager
Mapped Team Leader
Assistant Manager where configured
```

---

## 6. Post-Roster Leave Approval Scenario

If leave gets approved after roster is drafted/published:

```text
Leave approved after roster draft/publish
→ roster exception created
→ WFM/PM/TL notified
→ coverage gap recalculated
→ replacement employee suggested
→ post-publish change audit required if roster already published
```

Required notification recipients:

```text
WFM owner
Process Manager
Mapped TL
Affected employee
Replacement employee if assigned
```

---

## 7. Suggested Tables / Extensions

Use or extend existing leave and roster tables. If missing, add these during roster package:

```sql
roster_leave_impact_log
roster_pending_leave_alert
```

`roster_leave_impact_log` should store:

```text
id
roster_generation_run_id
leave_request_id
employee_id
leave_status_at_generation
impact_type
impact_date
impact_shift_id
created_at
```

`impact_type` values:

```text
confirmed_exclusion
pending_alert_only
post_publish_exception
no_impact
```

`roster_pending_leave_alert` should store:

```text
id
roster_generation_run_id
leave_request_id
employee_id
alert_status
alert_message
owner_role
owner_user_id
created_at
resolved_at
```

---

## 8. Acceptance Criteria

Roster planning is not correct unless:

1. Approved leave excludes employee from roster availability.
2. Pending/submitted/unapproved leave does not exclude employee.
3. Pending leave appears as planning alert only.
4. Roster draft can still assign employee with pending leave.
5. If pending leave becomes approved later, roster exception is created.
6. WFM, Process Manager and TL are notified of leave-impact exceptions.
7. Published roster changes caused by later leave approval are audited.
8. RTA/attendance/payroll-readiness consume the final published roster truth.

---

## 9. Codex / Claude Instruction

Use this exact rule while building roster-leave logic:

```text
Only approved leave is a roster exclusion. Pending, submitted, unapproved, rejected, cancelled or withdrawn leave must not remove the employee from roster availability. Pending leave should be shown as a planning alert only. If pending leave is approved after roster draft/publish, create a roster exception, recalculate coverage, notify WFM/Process Manager/TL/affected employee and audit any post-publish change.
```
