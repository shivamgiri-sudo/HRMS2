# HRMS2 Lifecycle Alignment

## Scope

This phase aligns the ATS-to-employee lifecycle without running live migrations or database smoke tests. The implementation is additive and keeps existing page behavior intact while exposing the lifecycle surfaces HR, Branch Head, WFM, IT, Admin, and 2FA flows need.

## Lifecycle Flow

1. Candidate completes onboarding and BGV readiness.
2. HR/BGV validates checks from `/ats/bgv` and `/ats/bgv-report`.
3. Payroll HR validates salary slab and salary proposal from `/ats/payroll-hr`.
4. Branch Head approves or sends the offer back for payroll correction from `/ats/offer-approvals`.
5. Employee creation creates lifecycle provisioning tasks.
6. WFM, IT, Admin, and HR appointment-letter queues complete their assigned tasks.
7. Appointment letter request can be sent, signed, company-signed, and completed through onboarding provisioning APIs.
8. Users complete 2FA from `/two-factor` during protected-auth flows.

## Reused Pages

- `/ats/bgv` uses `NativeBGVVerificationCenter`.
- `/ats/bgv-report` uses `NativeBGVReport`.
- `/ats/payroll-hr` uses `NativePayrollHRValidation`.
- `/ats/offer-approvals` uses `NativeBranchHeadApproval`.
- `/two-factor` uses `TwoFactor`.

## Added Queue Routes

The provisioning tracker is reused with path-based queue presets:

- `/provisioning/wfm-alignment`
- `/provisioning/it`
- `/provisioning/admin`
- `/provisioning/appointment-letter`

## Backend Alignment

- BGV route aliases support queue, status, trigger, retry, manual feedback, and name-match override.
- Payroll HR route aliases support pending candidates, salary slabs, slab validation, salary proposal, and submit-offer.
- Branch Head approval updates salary proposal state and sends rejected cases back to payroll correction.
- Onboarding provisioning exposes task queue APIs and appointment-letter status APIs.
- Employee creation seeds appointment-letter request rows and lifecycle provisioning tasks.

## Migration Policy

Migrations are registered but not run in this phase. They are safe additive DDL only and do not drop or modify existing product tables destructively.

