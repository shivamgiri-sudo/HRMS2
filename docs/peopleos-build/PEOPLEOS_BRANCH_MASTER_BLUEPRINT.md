# PeopleOS Branch Master Blueprint

**Date:** 30-May-2026  
**Status:** Mandatory Master Data Foundation blueprint.  
**Architecture:** React + TypeScript frontend, Node/Express backend, MySQL `mas_hrms`.  
**Rule:** This is a planning blueprint. Do not execute SQL from this document without explicit approval.

---

## 1. Purpose

Branch Master is a core PeopleOS master. Every operational workflow must understand which branch an employee, candidate, process, roster, payroll, asset, compliance rule and client-delivery metric belongs to.

Branch Master must not be just a dropdown. It is a full configuration page that controls branch-level identity, location, HR operations, attendance, payroll grouping, roster rules, client/process mapping and reporting scope.

---

## 2. Branch Hierarchy

```text
Company
→ Branch
→ Client
→ Process
→ LOB
→ Cost Centre
→ Employee / Candidate / Support Role
```

Branch should support multiple clients, multiple processes, multiple LOBs and multiple cost centres.

---

## 3. Required Page

Suggested route:

```text
/settings/masters/branches
```

Suggested page name:

```text
Settings / Masters / Branch Master
```

Required access:

```text
Super Admin
HR Admin
Authorised Admin role
Read-only access for CEO/Leadership where needed
```

---

## 4. Branch Master Fields

### 4.1 Basic branch identity

```text
Branch ID
Branch Code
Branch Name
Branch Type
Branch Status
Company Entity
Region
State
City
Address Line 1
Address Line 2
Pincode
Country
Effective From
Effective To
```

Branch Type examples:

```text
Head Office
Delivery Centre
Training Centre
Recruitment Centre
Remote Hub
Client Site
Warehouse / Asset Hub
```

Branch Status values:

```text
Draft
Active
Inactive
Closed
Temporarily Suspended
```

### 4.2 Contact and owner details

```text
Branch Head
HR Owner
WFM Owner
Admin Owner
IT Owner
Payroll Owner
Compliance Owner
Primary Email
Primary Phone
Emergency Contact
```

### 4.3 Location and attendance configuration

```text
Latitude
Longitude
Geofence Radius if future geofence is enabled
Office Working Days
Default Holiday Calendar
Default Shift Group
Time Zone
Attendance Policy Scope
Leave Policy Scope
Roster Logic Scope
```

Note: QR/Kiosk attendance is not required. Do not add QR/Kiosk flows.

### 4.4 Payroll and statutory configuration

```text
Payroll State
Professional Tax Applicability
ESIC Branch Code if applicable
PF Establishment Code if applicable
Bank/Disbursement Group
Payroll Processing Group
Cost Centre Accounting Group
```

### 4.5 Document and compliance configuration

```text
Default Document Checklist
Branch Compliance Rule
DPDP Notice Scope
Data Retention Scope
Document Verification Owner
```

### 4.6 Client/process configuration

Branch must connect to:

```text
Client Master
Process Master
LOB Master
Cost Centre Master
Roster Builder Master
KPI/Target Master
Quality Parameter Master
Client Portal Publish Rules
```

---

## 5. Required Tables

Suggested MySQL tables:

```sql
branch_master
branch_contact_owner
branch_location_config
branch_policy_config
branch_statutory_config
branch_client_process_map
branch_audit_log
```

If some of these already exist, extend additively instead of duplicating.

---

## 6. Table Purpose

| Table | Purpose |
|---|---|
| `branch_master` | Core branch identity and status. |
| `branch_contact_owner` | Branch owner/contact mapping. |
| `branch_location_config` | Address, geo, timezone and location settings. |
| `branch_policy_config` | Attendance, leave, holiday, roster and document policy mapping. |
| `branch_statutory_config` | State/statutory/payroll configuration. |
| `branch_client_process_map` | Which clients/processes/LOBs/cost centres are active in branch. |
| `branch_audit_log` | Change log for branch master updates. |

---

## 7. Mapping Logic

### 7.1 Candidate mapping

```text
Candidate preferred branch
→ Candidate actual visited branch
→ Selected branch after interview/offer
→ Pre-joining branch
→ Employee branch after conversion
```

### 7.2 Employee mapping

```text
Employee
→ Branch
→ Client
→ Process
→ LOB
→ Cost Centre
→ Manager/TL/AM
```

### 7.3 Roster mapping

```text
Branch
→ Process/LOB/Cost Centre
→ Roster Builder Master
→ Shift rules
→ Employee roster
```

### 7.4 Payroll mapping

```text
Employee Branch
→ Payroll State
→ Statutory rules
→ Salary processing group
→ Cost centre accounting
```

### 7.5 Client portal mapping

```text
Branch + Client + Process + LOB + Cost Centre
→ Published aggregate metrics only
→ Client Portal visibility
```

---

## 8. Branch Master Scenarios

| Scenario | What system should do next |
|---|---|
| New branch created | Keep as Draft until required owners, policies and mappings are configured. |
| Branch activated | Allow branch in candidate, employee, roster, payroll and reports. |
| Branch inactive | Stop new assignments but preserve historical data. |
| Branch closed | Block new hiring/roster/payroll assignment; keep reporting history. |
| Branch owner changed | Update owner mapping, audit change and notify relevant admins. |
| Branch address changed | Audit change; update future letters, attendance and statutory references if applicable. |
| Branch mapped to new process | Require process/LOB/cost-centre, roster and KPI configuration before operational use. |
| Branch policy missing | Block dependent workflow where policy is mandatory. |
| Branch statutory config missing | Mark payroll readiness risk. |
| Branch appears in client portal | Show only approved aggregate metrics. |

---

## 9. Branch Master Validations

Required validations:

```text
Branch Code must be unique
Branch Name required
State and city required
Status required
Effective From required
At least one owner required before activation
Policy mapping required before operational use
Statutory mapping required before payroll use
Process/LOB/cost centre mapping required before roster/payroll/reporting use
Closed branch cannot receive new employees/candidates
Inactive branch cannot be used for new assignments unless override is approved
```

---

## 10. Branch Master UI Requirements

### 10.1 List view

```text
Branch Code
Branch Name
City
State
Status
Branch Head
HR Owner
Active Clients
Active Processes
Active Employees
Payroll Readiness
Roster Readiness
Compliance Readiness
Actions
```

### 10.2 Detail view tabs

```text
Overview
Owners & Contacts
Location
Policy Configuration
Statutory / Payroll
Client & Process Mapping
LOB & Cost Centre Mapping
Readiness Checks
Audit History
```

### 10.3 Readiness indicators

```text
Master readiness
Owner readiness
Policy readiness
Roster readiness
Payroll readiness
Compliance readiness
Client portal readiness
```

---

## 11. Notifications

Trigger notifications for:

```text
Branch activated
Branch deactivated
Branch closed
Branch owner changed
New process mapped to branch
Branch readiness incomplete
Payroll statutory configuration missing
Roster configuration missing
Compliance/document configuration missing
```

Recipients:

```text
Super Admin
HR Admin
Branch Head
WFM Owner
Payroll Owner
Compliance Owner
Process Manager where mapped
```

---

## 12. DPDP / Security Controls

Branch Master must follow:

```text
Role-based access
Change audit
Sensitive owner contact masking where required
No client confidential data exposure to unauthorised roles
Client Portal aggregate-only rule
No deletion of historical branch records if used in employees/payroll/audit
```

---

## 13. Acceptance Criteria

Branch Master is complete only when:

1. Branch can be created, edited, activated, deactivated and closed based on permission.
2. Branch code uniqueness is enforced.
3. Owner/contact mapping exists.
4. Branch can be mapped to clients, processes, LOBs and cost centres.
5. Policy/statutory/readiness checks are visible.
6. Inactive/closed branch cannot be used for new operational assignment without approved override.
7. Branch is available to ATS, Employee Master, Roster, Attendance, Payroll, Reports and Client Portal based on status and mapping.
8. All changes are audited.
9. Backend enforces access and scope.
10. UI is visible and tested.

---

## 14. Codex / Claude Instruction

Use this exact scope when building Branch Master:

```text
Build Branch Master as a full configuration page, not just a dropdown. It must include branch identity, address, owners, location, policy mapping, statutory/payroll config, client/process/LOB/cost-centre mapping, readiness checks, audit history and role-scoped access. Branch should feed ATS, employee master, roster, attendance, payroll, reports and client portal aggregate views. Do not add QR/Kiosk attendance. Do not create new Supabase business tables.
```
