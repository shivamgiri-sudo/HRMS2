# MAS Callnet PeopleOS — Notification & Report Catalogue

**Status:** Draft for sign-off (Phase 0). No engine code is written until this is approved.
**Author:** generated 2026-07-31 from a full audit of `backend/sql` (506 migrations), 28 workers,
and every email send site, plus a read-only reality check against production `mas_hrms`.

This document defines **every** email/alert/notification/report the platform should send: what
triggers it, who is in To, who is in CC, what the body contains, which analytics appear in the
body, and what is attached.

---

## 1. How to read this document

Each row is one `event_code`. The columns mean:

| Column | Meaning |
|---|---|
| **Trigger** | The exact table + status transition, or the schedule. Not a description — the actual condition the worker/service tests. |
| **To** | Selector(s). Resolved at send time by `resolveRecipients()`. |
| **CC** | Selector(s). Governed by the CC discipline in §5. |
| **Analytics** | The figures in the body's analytics strip. **Every figure must be computable from existing tables** — if it is not, it is not listed. |
| **Attach** | Server-generated attachment, or `—` for a deep link instead. |
| **Sens.** | `int` internal · `conf` confidential · `fin` financial-PII. Drives the deny-list and the official-email requirement. |
| **Live?** | Whether this event can actually be delivered with today's data (§2). |

Every event ships `enabled=0, dispatch_mode='shadow'`. Nothing sends as a side effect of deploying.

---

## 2. Deliverability reality — read this before approving any recipient rule

Measured read-only against production on 2026-07-31. **These numbers constrain the catalogue.**

### 2.1 Can the To actually be reached?

| | Active employees | Have official email | Have any email | Have **no** email |
|---|---|---|---|---|
| Total | **1,152** | **996** (86.5%) | 1,127 | **25** |

Financial events are forced to `official_email` + the domain allowlist
(`report-email-resolver.ts:14` — `teammas.in`, `teammas.co.in`, `mascallnet.com`). So:

> **156 active employees (13.5%) cannot receive a payslip, F&F, or increment email today.**

Concentrated, not scattered:

| Branch | Active | No official email | No email at all |
|---|---|---|---|
| `DELHI` | 51 | **48** (94%) | 0 |
| `AHMH-JD` | 271 | 46 | **16** |
| `NOIDA` | 406 | 33 | 6 |
| `HQ` | 12 | **12** (100%) | 0 |
| *(no branch)* | 10 | 10 | 0 |
| `NOIDA-2` | 362 | 5 | 3 |
| `CORP` | 13 | 1 | 0 |

### 2.2 Can the CC actually be reached?

| Selector | Backing data | Coverage today | Verdict |
|---|---|---|---|
| `reporting_manager` | `employees.reporting_manager_id` | **917 / 1,152 reachable** (79.6%); 165 have no RM, 62 have an inactive RM | ✅ usable, needs fallback |
| `branch_head` | `branch_head_assignments` | **3 rows**, seeded `'Trapezoid'` / `'Okaya'` — not real branches | ❌ unusable |
| `branch_head` (fallback) | `user_assignment_scope` role+branch | **4 users, branch-scoped**, across 45 branches | ⚠️ ~4 branches only |
| `wfm_spoc` | `branch_wfm_spoc_config` | **0 rows** | ❌ **resolves to nobody** |
| `wfm` (fallback) | role+scope | 5 branch-scoped + 2 all | ⚠️ partial |
| `branch_hr` | role+scope | 12 branch-scoped + 4 all | ✅ usable |
| `process_manager` | role+scope | 16 process-scoped + 5 all | ✅ usable |
| `payroll_hr` | role+scope | 5 users (1 scoped `all`) | ✅ small but real |
| `finance` | role+scope | 2 users, `all` | ✅ |
| `payroll_head` / `ceo` | `user_roles` | 1 / 5 | ✅ |

### 2.3 What this means for the catalogue

Three rules follow, and they are applied throughout §6:

1. **No event may name `wfm_spoc` as its only CC.** Every roster event uses
   `wfm_spoc → role_scope(wfm, branch) → branch_hr` as an ordered fallback chain.
2. **`branch_head` is never a sole recipient.** It is always paired with `branch_hr`.
3. **Undeliverable is a reported outcome, not silence.** `resolveRecipients()` returns every drop
   with a reason, the gateway persists them, and a weekly
   `notification-undeliverable-recipients` report goes to HR. An employee who cannot be emailed is
   an HR data task, not an invisible failure.

**Recommended data remediation before go-live** (§9) — none of it blocks the build, all of it
blocks *flipping events live*.

---

## 3. Standard email body anatomy

One layout, learned once. Sections may be omitted; they are never reordered.

```
┌──────────────────────────────────────────────┐
│ [MAS logo]                    ‹CATEGORY PILL›│  brand bar
├──────────────────────────────────────────────┤
│ Your February payslip is ready.              │  headline — one sentence, active voice
│                                              │
│ Employee   Shivam Giri · MAS62938            │  fact block — the 3-6 fields that ARE
│ Period     Feb 2026                          │  the event. Codes/amounts monospace.
│ Net pay    ₹48,250                           │
│                                              │
│ ┌────────┬────────┬────────┬───────────────┐ │  analytics strip — 2-4 figures.
│ │ LOP    │ YTD    │ vs Jan │ Payment date  │ │  ONLY what the backend truly computes.
│ │ 0 days │ ₹5.2L  │ +₹1,100│ 28 Feb        │ │
│ └────────┴────────┴────────┴───────────────┘ │
│                                              │
│         [ View payslip in HRMS ]             │  ONE action. Deadline shown if any.
│                                              │
│ You are receiving this as the employee.      │  why you got this — MANDATORY on CC'd mail
├──────────────────────────────────────────────┤
│ Confidential · retained 7 days · preferences │  footer
└──────────────────────────────────────────────┘
```

**Copy rules.** Active voice. A subject line states the outcome, not the system
(`Your leave is approved`, not `Leave workflow notification`). Errors say what happened and what to
do. No emoji in `fin`/`conf` events. Never put a salary figure in a subject line — subjects appear
on lock screens.

**The "why you got this" line is mandatory on every CC'd copy.** It is the cheapest defence against
the "why is HR reading my leave mail?" complaint, and it makes a mis-addressed CC obvious to the
recipient rather than invisible.

---

## 4. Analytics-in-body rules

The analytics strip is what makes an email worth opening rather than an interruption. It is also
where a notification system most easily starts lying.

1. **Every figure must be computed from a real table at send time.** If a figure needs a table that
   does not exist, the figure is cut — not estimated, not defaulted to zero. This is CLAUDE.md rule
   10 applied to email.
2. **Maximum four figures.** More is a report, and a report is an attachment.
3. **Deltas need a stated baseline** — "+₹1,100 vs Jan", never a bare "+₹1,100".
4. **No figure in a `fin` email may describe anyone other than the recipient.** A manager's copy of
   a salary event carries team-level aggregates or nothing.
5. **Countdowns are absolute plus relative** — "by Sun 09 Feb (in 2 days)" — because email is read
   late.

---

## 5. CC discipline

All three of these rules exist because the codebase already violates them:

| Rule | Existing violation |
|---|---|
| CC is for people **accountable for the outcome**, never FYI | — |
| A `fin` event may **never** CC anyone but the subject | — |
| More than 5 CC addresses becomes BCC | `job-requisition.service.ts:1266` merges CC into **To**, so every recipient sees every address |
| A computed CC must actually be passed to the mailer | `break-management.service.ts:855` computes `ccList`, persists it to `break_alert_logs.email_cc:911`, and never passes it to `send():863` — recipients are *recorded as notified* and receive nothing |

The resolver enforces rules 1-3 mechanically: `sensitivity: 'fin'` with a non-empty CC is a
`RecipientResolutionError`, not a warning.

---

## 6. The catalogue

### 6.1 Roster / WFM — 10 events

Templates already authored in `sql/224_wfm_notification_templates.sql` (currently in the legacy
`notification_template` store; harvest into `communication_template`).

| event_code | Trigger | To | CC | Analytics | Attach | Sens. | Live? |
|---|---|---|---|---|---|---|---|
| `roster_published` | `weekly_roster_cycle.status → published` | each rostered employee | wfm-chain | shifts · week-offs · nights · ack deadline | — | int | ✅ |
| `roster_ack_reminder` | ack pending, 48h before cycle start | employee | — | hours to deadline · % team acked | — | int | ✅ |
| `roster_ack_overdue` | ack pending, 24h before start | employee | L1 reporting manager | hours overdue · team ack % | — | int | ⚠️ RM gap |
| `shift_changed` | `roster_change_log` insert post-publication | employee | reporting manager | old→new shift · notice given (h) | — | int | ⚠️ |
| `weekoff_approved` | `employee_roster_preference.status → approved` | employee | — | week-offs granted vs requested YTD | — | int | ✅ |
| `weekoff_denied` | → `rejected` | employee | reporting manager | reason · next window | — | int | ⚠️ |
| `weekoff_waitlisted` | → waitlist | employee | — | queue position | — | int | ✅ |
| `roster_dispute_raised` | `acknowledgement_status → disputed` | wfm-chain | reporting manager | open disputes in branch · age | — | int | ⚠️ |
| `roster_dispute_resolved` | dispute closed | employee | wfm-chain | resolution · turnaround (h) | — | int | ✅ |
| `roster_cycle_unacked_digest` | daily 18:00, cycle open | wfm-chain | branch_head + branch_hr | unacked count · % · worst process | XLSX | int | ⚠️ |

`wfm-chain` = `wfm_spoc → role_scope(wfm, branch) → branch_hr`. Today the first link is empty (§2.2).

### 6.2 Leave — 8 events

| event_code | Trigger | To | CC | Analytics | Attach | Sens. | Live? |
|---|---|---|---|---|---|---|---|
| `leave_submitted` | `leave_request` insert | reporting manager | — | applicant balance · team on leave that day | — | int | ⚠️ RM gap |
| `leave_decision` | status → `approved`\|`rejected` | applicant | reporting manager | balance after, by type · taken YTD | — | int | ⚠️ |
| `leave_pending_branch_head` | → `pending_branch_head` (3rd EL, `leave.service.ts:117`) | branch_head + branch_hr | reporting manager | EL occurrences YTD · policy rule hit | — | int | ⚠️ |
| `leave_cancelled` | → `cancelled` | applicant | reporting manager | balance restored | — | int | ⚠️ |
| `leave_lapsed` | `sql/408` lapse on payroll close | employee | — | days lapsed · balance carried | — | int | ✅ |
| `leave_credit_posted` | `leave_el_credit_log` insert | employee | — | credited · new balance · accrual rate | — | int | ✅ |
| `leave_approval_overdue` | pending > 48h (workflow SLA, `sql/015:179`) | reporting manager | branch_hr | hours pending · queue depth | — | int | ⚠️ |
| `leave_balance_digest` | monthly, 1st 09:00 | employee | — | balance by type · expiring soon | — | int | ✅ |

### 6.3 Attendance — 8 events

| event_code | Trigger | To | CC | Analytics | Attach | Sens. | Live? |
|---|---|---|---|---|---|---|---|
| `attendance_absent` | `attendance_daily_record.attendance_status='absent'`, unregularized 24h | employee | reporting manager | unmarked days MTD · attendance % MTD · LOP to date | — | int | ⚠️ |
| `attendance_late` | `late_mark=1` | employee | — | late marks MTD · avg late minutes | — | int | ✅ |
| `attendance_missing_punch` | `unreconciled` after engine run | employee | — | open items · regularization deadline | — | int | ✅ |
| `regularization_submitted` | `attendance_regularization` insert | reporting manager | — | pending count · oldest age | — | int | ⚠️ |
| `regularization_decision` | → `approved`\|`rejected` | employee | reporting manager, wfm-chain | days corrected · attendance % after | — | int | ⚠️ |
| `regularization_stage2_pending` | → `manager_approved` | wfm-chain | — | queue depth · oldest age | — | int | ⚠️ |
| `attendance_dispute_escalated` | `escalated_to` set (`sql/237:59`) | escalation target role | branch_hr | days disputed · escalation level | — | int | ✅ |
| `attendance_manager_digest` | daily 10:00 | reporting manager | — | team present/absent/late · unregularized · attendance % | XLSX | int | ⚠️ |

### 6.4 Payroll — 12 events

Strictest group. `official_email` only, no CC on anything employee-specific, deny-list enforced.

| event_code | Trigger | To | CC | Analytics | Attach | Sens. | Live? |
|---|---|---|---|---|---|---|---|
| `payslip_ready` | `salary_prep_run.status → disbursed` | employee **official only** | **none, ever** | net · LOP days · YTD gross · vs prior month | *(link — see §8)* | fin | ⚠️ 156 unreachable |
| `salary_credited` | `payroll_disbursement.status → completed` | employee official | none | amount · value date · mode | — | fin | ⚠️ |
| `payroll_run_calculated` | → `calculated` | payroll_hr | payroll_head | headcount · gross · variance vs prior run | XLSX register | fin | ✅ |
| `payroll_run_under_review` | → `under_review` | finance | payroll_head | total payable · exceptions count | XLSX | fin | ✅ |
| `payroll_run_approved` | → `approved` | finance | payroll_head, **ceo if > ₹50L** (`sql/403:15`) | total · headcount · vs prior month | XLSX | fin | ✅ |
| `payroll_run_locked` | → `locked` | payroll_hr | finance | locked headcount · disbursal date | — | fin | ✅ |
| `payroll_window_closing` | 48h before window close | payroll_hr, branch_hr | — | pending inputs · branches not ready | XLSX | conf | ✅ |
| `salary_increment_letter` | `letter_status → released` | employee official | reporting manager — **no amount in the CC copy** | effective date · revision # (no figures in CC) | letter PDF | fin | ⚠️ |
| `salary_advance_recovery` | recovery scheduled | employee official | none | outstanding · instalments left · monthly cut | — | fin | ⚠️ |
| `full_final_ready` | `full_final_calculation.status → approved` | employee official + personal | payroll_hr | net settlement · components · payment date | F&F PDF | fin | ⚠️ |
| `tax_declaration_reminder` | window open, not submitted | employee official | none | days left · regime on file · est. impact | — | fin | ⚠️ |
| `statutory_filing_due` | PF/ESIC/TDS due date − 3d | payroll_head | finance | amount · challan status · due date | XLSX | fin | ✅ |

**`full_final_ready` is the one financial event that may also go to the personal address** — the
employee has left and the official mailbox is usually disabled. It is a deliberate, documented
exception and must be reflected in the deny-list allowance.

### 6.5 SLA / escalation — 8 events

Driven by the repaired `task_tat_instance` + newly seeded `escalation_matrix_master`.

| event_code | Trigger | To | CC | Analytics | Sens. | Live? |
|---|---|---|---|---|---|---|
| `task_due_soon` | `due_at` − 25% of TAT | owner | — | hours left · TAT | int | ✅ |
| `task_sla_breach_l1` | `due_at` passed | owner | — | hours overdue | int | ✅ |
| `task_sla_breach_l2` | L1 + `trigger_after_hours` | owner's manager | owner | hours overdue · owner queue depth | int | ⚠️ |
| `task_sla_breach_l3` | L2 + `trigger_after_hours` | branch_head + branch_hr | manager, owner | hours overdue · branch open vs 30-day avg | int | ⚠️ |
| `provisioning_overdue` | `it_provisioning_request.sla_due_at` passed | assigned role holders | branch_hr | overdue count · oldest · joiner start date | int | ✅ |
| `joining_doc_overdue` | `employee_joining_document_checklist.due_at` passed | employee | assigned HR | docs outstanding · days to joining | int | ✅ |
| `approval_queue_aging` | daily; any approval pending > SLA | approver | approver's manager | pending by age bucket · oldest | int | ⚠️ |
| `sla_breach_weekly_digest` | Mon 09:00 | branch_head + branch_hr | process_manager | breaches by type · trend vs prior week | int | ⚠️ |

`provisioning_overdue` is the strongest first candidate to flip live: `sla_due_at` is already
populated and already queried (`it-provisioning.service.ts:727`), and the assignee role is on the
row — it needs no new data.

### 6.6 Scheduled reports — 8 subscriptions

**Hard constraint:** `report-worker-executor.ts` implements only six report codes. Everything else
returns `{ STATUS: 'PENDING_DEDICATED_BUILDER' }`, which the XLSX builder writes and the mailer
sends. **Phase 1 subscriptions are restricted to the six that work.**

| Subscription | Report code | Schedule | To | CC | Sens. |
|---|---|---|---|---|---|
| Daily attendance | `attendance-daily` | daily 09:00 | branch_hr | branch_head | conf |
| Daily attendance (ops) | `attendance-daily` | daily 09:00 | process_manager | — | conf |
| Weekly headcount | `headcount` | Mon 08:00 | hr (all) | ceo | conf |
| Weekly leave balance | `leave-balance` | Mon 08:00 | branch_hr | — | conf |
| Monthly payroll register | `payroll-register` | after run lock | finance | payroll_head | **fin** |
| Monthly employee master | `employee-master` | 1st 07:00 | hr (all) | — | conf |
| Birthdays | `birthday-list` | Mon 07:00 | branch_hr | — | int |
| Undeliverable recipients | *(new builder)* | Fri 16:00 | hr (all) | — | conf |

The last one is new and small, and it is the feedback loop that fixes §2: it lists every employee
whose notifications were dropped that week and why.

The other **83 catalog codes are visibly disabled in the UI with the reason shown** — per CLAUDE.md
rule 9, a shiny picker must not imply a working report.

### 6.7 Phase-2 catalogue (specified now, built later)

Employee lifecycle (`probation_ending`, `confirmation_issued`, `transfer_approved`,
`promotion_approved`, `profile_change_approved`), exit (`resignation_submitted`,
`resignation_decision`, `clearance_pending`, `exit_interview_due`, `lwd_approaching`), assets
(`asset_assigned`, `asset_return_due` — **blocked: `asset_assignment` has no
`expected_return_date` column**), documents (`document_expiring`, `document_verified`,
`missing_document_nudge`), performance (`review_ready`, `goal_reminder`, `pip_started`,
`pip_checkpoint_due`), LMS (`training_assigned`, `certification_due`).

Same column discipline applies; specified in the next revision of this file.

---

## 7. Escalation ladders

Seeded into `escalation_matrix_master`, which today has **zero rows** — a correct worker deployed
now would find no rules and send nothing.

| Task type | TAT | L1 (+0h) | L2 | L3 |
|---|---|---|---|---|
| `EMAIL_CREATION` | 4h | owner | +4h manager | +8h branch_hr |
| `DOMAIN_CREATION` | 4h | owner | +4h manager | +8h branch_hr |
| `BGV_INITIATION` | 8h | owner | +8h manager | +24h hr |
| `ASSET_ALLOCATION` | 24h | owner | +12h manager | +24h branch_head+branch_hr |
| `APPOINTMENT_LETTER` | 24h | owner | +12h hr | +24h branch_head+branch_hr |
| `BIOMETRIC_ENROLL` | 48h | owner | +24h manager | — |
| `PAYROLL_HR_VALIDATION` | 48h | owner | +12h payroll_head | +24h finance |
| `ID_CARD` | 72h | owner | +24h branch_hr | — |

TAT values are the existing `tat_matrix_master` seeds. Escalation *levels* are new.
`escalation_matrix_master.notify_role` is unconstrained `VARCHAR(50)` and the report catalog uses
role keys (`hr_head`, `operations`, `quality`) that are **not** in the 28-key
`WORKFORCE_ROLE_CATALOG` — every `notify_role` must be normalised through the alias map before it
hits `user_roles.role_key`, or it silently matches nobody.

---

## 8. Attachment policy

| Attach | Do not attach |
|---|---|
| Scheduled report XLSX (`buildSecureXlsxBuffer`) | Anything containing another person's PII |
| F&F statement PDF | Payslips *(phase 1 — see below)* |
| Offer letter PDF (already generated at `offer-letter.service.ts`, currently **not attached**) | Bulk employee lists to non-HR |
| Increment letter PDF | Anything > 20 MB (`report-email-delivery.worker.ts:11`) |

**`payslip_ready` ships as a deep link, not an attachment, in phase 1.** The payslip generator is
browser-only jsPDF (`src/lib/masCallnetPayslipGeneratorV2.ts`) with no server-side equivalent.
Porting it to pdfkit is real work, and a link is the better answer anyway: it keeps salary data
out of mail spools and behind authentication. Revisit only if the business requires the attachment.

---

## 9. Data remediation required before flipping events live

None of this blocks the build. All of it blocks go-live for the affected events.

| # | Gap | Impact | Owner |
|---|---|---|---|
| 1 | **156 active employees have no official email**; DELHI 48/51, HQ 12/12 | Cannot receive payslip / F&F / increment | HR |
| 2 | **25 employees have no email at all** (16 in AHMH-JD) | Cannot receive anything | HR |
| 3 | **`branch_wfm_spoc_config` is empty** | Every roster CC falls through to the fallback chain | WFM |
| 4 | **`branch_head_assignments` holds 3 fake rows** (`'Trapezoid'`, `'Okaya'`); only 4 users carry a branch-scoped `branch_head` role across 45 branches | Branch-head CC resolves for ~4 branches | HR / Access admin |
| 5 | **165 employees have no reporting manager**, 62 have an inactive one | ~20% of manager CCs drop | HR |
| 6 | `escalation_matrix_master` empty | Escalation sends nothing until seeded (`1025`) | this build |
| 7 | 83 of 89 report codes return a placeholder | Subscriptions limited to 6 | future phase |

Items 1-5 are visible weekly through the `undeliverable-recipients` report (§6.6) once it exists,
which is the point of building it first.

---

## 10. Sign-off

Approving this document means approving **who receives what**. Specifically:

- the To/CC on all 48 phase-1 events above (10 roster · 8 leave · 8 attendance · 12 payroll · 8 SLA · 2 report-delivery);
- that `payslip_ready` carries **no CC and no attachment**;
- that `payroll_run_approved` CCs the CEO above ₹50,00,000;
- that `full_final_ready` is the sole financial event permitted to reach a personal address;
- that events whose recipients cannot resolve today (§2.2) still ship, in shadow, and are flipped
  live only after the §9 remediation.

Engine implementation begins on approval.
