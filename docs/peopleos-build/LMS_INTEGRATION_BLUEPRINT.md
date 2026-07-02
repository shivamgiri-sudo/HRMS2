# LMS Integration Blueprint — Existing Deployed Internal LMS

**Decision date:** 2026-05-29  
**Status:** Approved architecture direction; implementation not yet performed in this repository.

## 1. Architecture Decision

The internal LMS is already built and deployed independently. MAS Callnet PeopleOS must **integrate** it and must **not rebuild** LMS operational functionality inside the HRMS codebase.

## 2. Ownership Boundary

| Capability / Data | System of Record | HRMS Action |
|---|---|---|
| Employee master, employment status, branch/process/LOB mappings | PeopleOS HRMS | Send/map eligible employee identities to LMS integration |
| Curriculum, classrooms, modules, content | Existing LMS | Deep-link/admin access only; no duplicate editing |
| Assessments, question banks, MCQ attempts | Existing LMS | Consume summary/results needed for reporting |
| Learning completion and progress | Existing LMS | Sync approved snapshot into HRMS |
| Certification rules and certification decision | Existing LMS | Sync status and readiness into HRMS |
| Operations handover readiness | LMS output plus HRMS workforce context | Display in manager/management dashboards |
| Payroll/incentive dependency, if later approved | HRMS | Read approved LMS certification/status only |
| Client-facing training overview | HRMS Client Portal | Show aggregate approved outputs only |

## 3. Recommended Integration Pattern

Use the existing `integration-hub` architecture as the host for LMS connectivity.

```text
Existing Deployed LMS
      │ secured API preferred / controlled scheduled sync fallback
      ▼
PeopleOS Integration Hub
      ├── connector configuration and secrets reference
      ├── field mapping and identity match
      ├── scheduled run and run history
      ├── validation, exceptions and retries
      ▼
HRMS LMS Snapshot Layer
      ├── learner mapping
      ├── batch/process mapping
      ├── progress snapshots
      ├── certification/handover snapshots
      └── risk/attrition snapshots
      ▼
PeopleOS Surfaces
      ├── Employee My Learning launch + summary
      ├── Manager/Operations readiness dashboard
      ├── Management Command Centre
      └── Client Portal aggregate approved view
```

### Integration Preference Order

1. **Secured LMS API**: preferred where the deployed LMS can expose authenticated read endpoints.
2. **Controlled scheduled export/sync**: suitable if LMS is Apps Script/Google Sheets and API endpoints are not currently available.
3. **Read-only connector**: use only when necessary and with strict access, mapping and audit controls.

No implementation selection should be made until the LMS endpoint/data-access capability is inspected.

## 4. Suggested HRMS Data Model — Design Only

Do not implement before reviewing the existing schema and deciding the integration mode.

| Proposed Table | Purpose |
|---|---|
| `lms_integration_connector` or existing integration config extension | Connector configuration reference and status |
| `lms_employee_mapping` | HRMS employee ID/code to LMS learner ID mapping |
| `lms_batch_mapping` | LMS batch/classroom to HRMS branch/process/LOB mapping |
| `lms_learning_progress_snapshot` | Course/MCQ completion and score snapshots by learner/run date |
| `lms_certification_snapshot` | Certification and handover readiness status |
| `lms_training_risk_snapshot` | At-risk, overdue, failed assessment, attrition indicators |
| `lms_sync_exception` | Unmatched/duplicate/invalid records requiring correction |
| `lms_sync_audit_log` | Run status, record counts, errors, initiator and timestamps |

These may be implemented as new tables or extensions to existing integration-hub patterns after code/schema inspection.

## 5. Required Integration Interfaces

| Surface | Expected Behaviour |
|---|---|
| Employee Portal | Launch the deployed LMS securely and show last synced training summary |
| LMS Coordinator/Admin menu | Open deployed LMS operational portal or integration health only; do not duplicate administration |
| Employee Profile | Show synced progress, certification and last-refresh timestamp |
| Manager/Operations View | Show team readiness, handover eligibility, training risks and pending certification |
| Management Dashboard | Show branch/process/LOB training throughput, attrition and readiness summaries |
| Client Portal | Show approved process-level aggregates only; no learner PII/raw results |
| Integration Admin | View connector state, last run, mismatches, errors and retry controls |

## 6. Required Mapping Fields

| HRMS Field | LMS Field to Match/Store | Note |
|---|---|---|
| Employee ID | LMS learner ID | Prefer stable internal IDs after initial mapping |
| Employee Code | Employee/LMS identifier | Use for operational reconciliation |
| Email/mobile where authorised | LMS identity reference | Mask and restrict access; not client-facing |
| Branch ID | LMS branch text/ID | Match through mapping master |
| Process ID / LOB | LMS course/batch/process values | Required for management/client aggregation |
| Batch ID | LMS classroom/batch ID | Required for trainee cohort tracking |

## 7. Privacy and Security Controls

- LMS tokens/API keys must be held in backend secrets only, never frontend or committed files.
- Only authorised internal roles may see learner-level data.
- Client portal receives process-level aggregated approved data only.
- Every sync run must record counts, failures and timestamps.
- Every manual remapping/retry must be auditable.
- Secure launch/SSO must not bypass role/scope checks in either system.

## 8. Implementation Phases

| Step | Delivery | Acceptance Check |
|---:|---|---|
| 1 | Inspect deployed LMS data/API availability | Confirm integration option and fields without edits |
| 2 | Define integration contract and mappings | Approved source-of-truth and mapping document |
| 3 | Add schema/migration for snapshot/mapping layer | Local/staging migration passes |
| 4 | Add Integration Hub connector and sync service | Synthetic sync and failure/retry tests pass |
| 5 | Add HRMS employee/management summaries | Role-scoped views and freshness timestamp shown |
| 6 | Add secure LMS launch/deep-link/SSO | Access audit and role tests pass |
| 7 | Add approved Client Portal aggregation | Cross-client isolation and PII tests pass |
| 8 | UAT with real authorised sample records | Reconciliation signed off before production |

## 9. Information Needed Before Coding the Integration

Provide or identify during controlled inspection:

- Deployed LMS URL and available pages/roles.
- Integration method available: API, Apps Script web method, scheduled Google Sheet export or read-only database access.
- Authentication method for the integration.
- Stable learner identifier and HRMS employee matching fields.
- Batch, branch, process, LOB and certification field mappings.
- Data refresh expectation: real-time, hourly or daily.
- Which aggregates may be shared with clients.
- Authorised roles able to manage mapping failures and reruns.

Do not put passwords, tokens or production secrets in this document or GitHub.
