# PeopleOS Mandatory Employee Entity and Employee Page Rule

**Date:** 30-May-2026  
**Status:** Mandatory product and development rule.  
**Applies to:** All roles, pages, workflows, reports, audits, dashboards and portals.

---

## 1. Core Rule

Every person inside PeopleOS who works for, supports, manages, audits, trains, recruits, delivers, governs or administers operations must be represented as an **Employee entity**.

This includes:

```text
Agent / Analyst
Team Leader
Assistant Manager
Process Manager
Branch Head
QA
Trainer
WFM / RTM
SME
HR
Recruiter
Payroll / Finance
Admin / IT / Asset user
Compliance / Auditor
CEO / Leadership user
Support staff
Any other internal business user
```

A system user account may exist for login/access, but the person behind that user must map to an employee record wherever they are part of the organisation workforce.

---

## 2. Mandatory Employee Page

PeopleOS must have an Employee Page / Employee Stat Card as a mandatory central page.

Suggested route:

```text
/employees/:employeeId
```

Suggested page name:

```text
Employee Profile / Employee Stat Card
```

This page must tell the full truth about that employee, including current designation and historical designation changes.

---

## 3. Employee Page Must Reflect

Minimum required sections:

```text
Employee Identity
Current Employment Status
Current Designation
Designation History
Role / System Access Mapping
Branch / Client / Process / LOB / Cost Centre Mapping
Reporting Manager / TL / AM / PM Mapping
Department / Grade / Band
Joining and Tenure
Recruitment Source / ATS Link
Pre-Joining and Onboarding Status
Document Verification Status
Offer Acknowledgement Status
BGV Status
LMS / Training / Certification
Roster Eligibility and Current Roster
Week-Off Preference History
Leave and Attendance Summary
Payroll Readiness / Salary Structure Access by permitted role
Incentive Summary by permitted role
Performance / KPI / Quality / Coaching / PIP
Assets Issued / Returned
Helpdesk / HR Cases by permitted role
Consent and DPDP Requests by permitted role
Exit / F&F / Relieving / Rehire Eligibility
Employee Journey Timeline
```

---

## 4. Designation and Role Relationship

Designation and system role are not the same thing.

```text
Designation = business/job title, for example Analyst, TL, AM, QA, Trainer, Manager.
System Role = application access role, for example employee, tl, process_manager, hr_admin, payroll, super_admin.
```

Employee Page must show both:

```text
Current Designation
Current System Role(s)
```

If designation changes:

```text
Create employee_assignment_history
Create employee_journey_event
Update employee_stat_snapshot
Recalculate scope/approval rules if needed
```

If system role changes:

```text
Update user_roles / access mapping
Audit role change
Update Employee Page access section
```

---

## 5. Mandatory Mapping Logic

Every user who has portal access should map like this:

```text
auth user / login account
→ internal user record
→ employee_id
→ employee profile/stat card
→ role/scope mapping
→ branch/process/LOB/cost-centre data access
```

Do not build standalone users disconnected from employee identity unless the user is an external client user. External client users must remain in Client Portal user mapping and must not be treated as internal employee unless actually employed by MAS Callnet.

---

## 6. Employee Page Visibility Rules

| Viewer role | Visibility |
|---|---|
| Employee | Own profile, own journey, own roster/leave/payslip/docs as allowed. |
| TL | Mapped team employees, limited sensitive fields. |
| AM | Scoped teams/process employees, limited sensitive fields. |
| Process Manager | Mapped process/LOB/cost-centre employees, no unnecessary payroll/doc sensitive data. |
| HR Admin | Full employee lifecycle, documents and HR fields as permitted. |
| Payroll | Payroll-related employee fields only. |
| QA/T&Q | Quality/performance-related employee view only. |
| Trainer | Training/LMS/certification-related employee view only. |
| WFM | Roster/attendance/workforce-related employee view only. |
| Compliance/Auditor | Privacy/audit/compliance fields as permitted. |
| CEO/Leadership | Aggregate plus controlled drilldown; sensitive masking as configured. |
| Client User | No internal employee profile page unless explicitly approved; default aggregate only. |

---

## 7. Employee Page Must Be Linked From

Employee page/profile/stat card should be accessible from:

```text
Employee Directory
Team pages
Roster pages
Attendance pages
Leave pages
Payroll readiness pages
Performance pages
Quality/coaching pages
Training/LMS pages
Asset pages
Helpdesk pages
Exit/F&F pages
Management dashboards where drilldown is allowed
```

When any page shows an employee name/code, it should be able to link to the employee page if viewer role has permission.

---

## 8. Data Protection Rules

Employee Page contains personal and sensitive information. Therefore:

```text
Mask sensitive fields by role.
Audit sensitive reads and downloads.
Do not show payroll to non-payroll roles unless approved.
Do not show full documents to unauthorised roles.
Do not show disciplinary/PIP details to unauthorised roles.
Do not expose employee profile to Client Portal by default.
Use DPDP purpose and access controls.
```

---

## 9. Required Tables / Extensions

Use or extend these tables:

```sql
employees
employee_assignment_history
employee_cost_centre_history
employee_journey_event
employee_stat_snapshot
user_roles
user_assignment_scope
sensitive_action_log
privacy_audit_log
```

If designation history or role history is missing, add additive tables/columns only. Do not destroy existing employee records.

---

## 10. Acceptance Criteria

This rule is satisfied only when:

1. Every internal system user can be mapped to an employee record.
2. Employee Page is mandatory and accessible by authorised roles.
3. Employee Page shows designation and designation history.
4. Employee Page shows system role/access mapping separately from designation.
5. Branch/process/LOB/cost-centre assignment is visible according to access permission.
6. Employee Journey Timeline updates when designation, process, role, roster, payroll, training, performance or exit events happen.
7. Sensitive fields are masked by role.
8. Backend enforces role/scope access.
9. Client Portal does not expose employee profile by default.
10. Existing UI layout/design is preserved.

---

## 11. Codex / Claude Instruction

Use this exact rule during development:

```text
Every internal person is an Employee entity. Employee Page / Employee Stat Card is mandatory and must show that employee’s identity, current designation, designation history, system role, branch/process/LOB/cost-centre mapping, manager hierarchy and full lifecycle journey. Designation is business title; system role is application access. Do not create internal users disconnected from employee records. Preserve current UI/layout and enforce backend role/scope/data masking.
```
