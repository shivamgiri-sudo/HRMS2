# PeopleOS Reference Project Feature Decisions

**Date:** 30-May-2026  
**Status:** Feature-selection guidance after reviewing uploaded HRMS reference projects.  
**Rule:** Our frontend/backend architecture remains unchanged. Use reference projects only for feature inspiration.

---

## 1. Confirmed Direction

The uploaded projects were reviewed only to identify useful feature gaps or better workflow ideas. PeopleOS remains:

```text
React + TypeScript frontend
Node.js + Express + TypeScript backend
MySQL mas_hrms database
Supabase only transitional Auth/Storage
```

Do not copy their architecture, database design or full modules blindly.

---

## 2. Explicitly Not Required

The following features are **not required** and must not be added to PeopleOS unless the scope is reopened later.

| Feature | Decision | Reason |
|---|---|---|
| QR Attendance | Not required | Not part of current operational requirement. |
| Kiosk Attendance | Not required | Do not build kiosk/device scanning flow now. |
| Task Management / Kanban | Not required | Avoid creating a separate project/task board module; operational action queues should stay inside their respective modules. |

Implementation note:
- Do not create QR/Kiosk attendance tables, pages, routes, APIs or backlog items.
- Do not create generic task board/Kanban tables, pages, routes, APIs or backlog items.
- If action tracking is needed, build it inside the relevant module, for example roster action, document verification action, leave approval, incentive approval, exit clearance, QA coaching action or client governance action.

---

## 3. Employee ID / Employee Code Configuration Decision

Employee ID generation is required, but it must be implemented as a **configuration master**, not as a hardcoded backend-only utility.

Correct placement:

```text
Master Data Foundation
→ Employee ID / Employee Code Configuration Master
→ Used by Slice 01 Candidate-to-Employee Conversion
```

Required UI/page:

```text
Settings / Masters / Employee ID Configuration
```

Required capabilities:
- Configure prefix.
- Configure number length.
- Configure sequence scope.
- Configure reset policy if required.
- Configure branch/process/LOB/cost-centre-specific rules.
- Preview next employee ID before activation.
- Activate/deactivate rule.
- Maintain generation log.
- Prevent duplicate employee IDs.
- Transaction-safe sequence during conversion.

Suggested tables:

```sql
employee_id_rule_master
employee_id_generation_log
```

This belongs to Slice 01 but should be designed as a reusable Master page because HR/Admin must maintain it from UI.

---

## 4. Features Approved to Borrow / Adapt

### 4.1 Step-wise Pre-Joining Onboarding

Approved.

Reference strength:
- Step-wise onboarding from `hrms_backend-main`.

PeopleOS implementation:

```text
Welcome
→ Basic Details
→ Contact Details
→ Personal Details
→ Statutory Details
→ Family Details
→ Present Address
→ Permanent Address
→ Bank Details
→ Documents
→ Review & Submit
```

Add resume upload/photo parsing and candidate validation before final submission.

---

### 4.2 Bulk Upload with Error Correction

Approved for later Integration Hub package.

Required capability:
- Upload CSV/XLSX.
- Header mapping.
- Validation.
- Error rows.
- Inline correction.
- Re-upload failed rows only.
- Final import.
- Audit and lineage.

Do not mix with Slice 01 unless needed for employee ID config import.

---

### 4.3 Access Request Workflow

Approved for Access Control Production Completion.

Required capability:
- User requests access.
- Manager/HR/Admin approval.
- Temporary access expiry.
- Audit trail.

---

### 4.4 Helpdesk Category and SLA Improvement

Approved as improvement to existing helpdesk foundation.

Required capability:
- Category master.
- SLA master.
- Assignment.
- Internal/external comments.
- Reopen.
- Closure reason.

---

### 4.5 Reimbursement / Loans / Advances

Approved for later payroll/benefits package, not immediate.

---

### 4.6 Survey / Pulse / Kudos / Recognition

Approved for later engagement/gamification package, not immediate.

---

### 4.7 Face / Geofence / Biometric Attendance

Keep as future optional attendance verification framework only. Do not prioritize before core PeopleOS identity, onboarding, roster and attendance truth are stable.

Approved future ideas:
- Face enrollment.
- Geofence check.
- Biometric device integration.
- Manual override audit.

Not approved:
- QR/Kiosk attendance.

---

## 5. Corrected Build Priority

Current priority after demo repair:

```text
1. Fix visible Vercel demo and demo login for PR #23
2. Slice 01: Employee ID Configuration Master + Employee ID Generation + Pre-Joining Onboarding Autofill + Resume Parsing
3. DPDP Compliance Foundation
4. Master Data Foundation Expansion
5. Employee Stat Card / Journey Timeline
6. Candidate/New Joiner Document Verification
7. Roster Logic Master and Auto-Roster Engine
8. Offer Letter Dispatch and Consent
9. Communication Engine
10. Incentive Approval and Payroll Integration
11. Bulk Upload / Migration with Error Correction
12. Access Request Workflow
13. Helpdesk SLA/category improvements
14. Attendance verification framework, excluding QR/Kiosk
15. Engagement / Survey / Recognition / Gamification
```

---

## 6. Codex / Claude Safety Instruction

When using reference projects:

```text
Do not copy architecture.
Do not add QR/Kiosk attendance.
Do not add generic Task/Kanban module.
Do not create new Supabase business tables.
Do not mix future modules into Slice 01.
Use reference projects only to improve PeopleOS feature design while preserving React + Node/Express + MySQL architecture.
```
