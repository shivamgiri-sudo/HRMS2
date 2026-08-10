# HRMS2 Phase 2 Implementation Report

## Build Areas Completed

- BGV workflow API aliases and name-match override path.
- Payroll HR salary slab and salary exception proposal path.
- Branch Head approval and payroll correction loop.
- WFM, IT, Admin, and HR provisioning queue route aliases.
- Appointment letter e-sign MVP table and status APIs.
- 2FA frontend route coverage and static smoke coverage.
- Root static smoke command: `npm run phase2:smoke:static`.

## APIs Added or Aligned

BGV:

- `GET /api/ats/bgv/candidates`
- `GET /api/ats/bgv/status/:candidateId`
- `POST /api/ats/bgv/trigger/:candidateId`
- `POST /api/ats/bgv/retry/:candidateId/:checkType`
- `PATCH /api/ats/bgv/manual-feedback/:candidateId/:checkType`
- `PATCH /api/ats/bgv/name-match/:candidateId/override`

Payroll HR:

- `GET /api/ats/payroll-hr/validated-candidates`
- `GET /api/ats/payroll-hr/salary-slabs`
- `POST /api/ats/payroll-hr/validate-slab`
- `POST /api/ats/payroll-hr/salary-proposal`
- `POST /api/ats/payroll-hr/submit-offer`

Provisioning:

- `GET /api/onboarding-provisioning/tasks`
- `GET /api/onboarding-provisioning/tasks/my`
- `PATCH /api/onboarding-provisioning/tasks/:id`
- `POST /api/onboarding-provisioning/tasks/:id/complete`
- `POST /api/onboarding-provisioning/tasks/:id/waive`
- `POST /api/onboarding-provisioning/tasks/:id/block`

Appointment Letter:

- `GET /api/onboarding-provisioning/appointment-letters`
- `POST /api/onboarding-provisioning/appointment-letters/:id/send`
- `POST /api/onboarding-provisioning/appointment-letters/:id/aadhaar-signed`
- `POST /api/onboarding-provisioning/appointment-letters/:id/company-signed`
- `POST /api/onboarding-provisioning/appointment-letters/:id/complete`

## Migrations Added

- `backend/sql/265_ats_lifecycle_alignment.sql`
- `backend/sql/266_hrms2_security_lifecycle_stabilization.sql`
- `backend/sql/267_lifecycle_completion_surfaces.sql`

## Static Status

Static smoke validates routes, endpoints, migration registration, task codes, BGV name-match support, payroll salary proposal schema, appointment-letter schema, and 2FA route wiring. Live DB validation remains intentionally pending.

## Remaining Live Checks

- Run migrations against a staging database.
- Confirm task queue records for real employee creation.
- Validate BGV provider and manual override behavior with seeded candidates.
- Validate salary proposal approval and rejection loops with real branch-head users.
- Validate appointment letter PDF/e-sign provider integration.

