# Old HRS vs HRMS2 Payroll HR Flow Comparison

## Preserved Flow

Old HRS joining flow is preserved in HRMS2 as:

1. Candidate completes onboarding link.
2. HR reviews candidate form and uploaded documents.
3. BGV/eKYC/name match is completed.
4. Payroll HR validates DOJ, salary effective date, role, branch, process, slab, package, proposal salary, reporting manager, and payroll month.
5. BM / Branch Head performs the JCLR approval. Payroll HR does not self-approve JCLR.
6. Payroll HR completes JCLR Entry after BM / Branch Head JCLR Approval is approved.
7. EPF/statutory declaration is verified.
8. DPDP consent is checked for onboarding, BGV, document review, and payroll processing.
9. Readiness gate blocks employee code until salary, BGV, name-match, DPDP, BM / Branch Head JCLR Approval, Payroll HR JCLR Entry, statutory, and readiness checks are complete.
10. Employee code uses the existing approved-offer conversion path.

## Correct Approval Mapping

Normal joining flow:

1. Candidate onboarding submitted.
2. Payroll HR validates joining details.
3. BM / Branch Head JCLR Approval.
4. Payroll HR completes JCLR Entry.
5. EPF/statutory completion.
6. Final readiness checklist.
7. Employee code auto-generation.

Salary exception flow:

1. Payroll HR creates salary proposal.
2. BM / Branch Head salary approval.
3. Operations Head approval.
4. Payroll Head approval.
5. Finance Head approval.
6. Salary Register Lock.
7. BM / Branch Head JCLR Approval if still pending.
8. Payroll HR JCLR Entry.
9. EPF/statutory completion.
10. Employee Code Gate.

## HRMS2 Implementation

- Primary page: `/ats/joining-control-room`
- Backend: `/api/ats/joining-control-room/*`
- Payroll source table: existing `ats_payroll_hr_validation`
- Salary exception source table: existing `salary_exception_proposal`
- Candidate documents: existing `candidate_onboarding_document` and `ats_candidate_documents`
- Added HRMS2 control tables: `jclr_detail`, `statutory_declaration`, `salary_register`, `dpdp_consent_register`, and audit tables.
- JCLR approval source: existing `ats_branch_head_approval`, labeled as BM / Branch Head JCLR Approval.
- JCLR entry source: `jclr_detail`, owned by Payroll HR after approval.

## Non-Duplication Decision

HRMS2 does not create a second salary proposal or candidate document master. Existing salary/document tables remain the source of truth and are extended only where required.

## Final Rule

Payroll HR prepares joining records and completes JCLR Entry. BM / Branch Head owns JCLR Approval. Operations Head, Payroll Head, or Super Admin may override only when configured.
