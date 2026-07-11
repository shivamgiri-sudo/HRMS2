# HRMS2 Payroll HR Joining Control Room PRD

## Scope

The Joining Control Room is the HR/Payroll operational screen for selected candidates after candidate-side onboarding. It combines candidate summary, onboarding form, documents, BGV, Payroll HR details, salary proposal, JCLR, statutory declaration, approvals, readiness, employee code, provisioning, appointment letter, and DPDP.

## Page

- Route: `/ats/joining-control-room`
- Page code: `ATS_JOINING_CONTROL_ROOM`
- Navigation: People & Hiring > Onboarding > Joining Control

## Queue Columns

Candidate name/code, mobile/email, branch, process, onboarding status, document status, BGV/name-match status, Payroll HR status, salary proposal status, JCLR status, statutory status, DPDP status, employee code, blockers, aging, and next action.

## Mandatory Tabs

Candidate Summary, Candidate Onboarding Form, Uploaded Documents, BGV/eKYC/Name Match, Payroll HR Details, Salary Slab & Proposal Salary, JCLR Details, EPF/Statutory Declaration, Approval Tracker, Final Readiness Checklist, Employee Code, Provisioning, Appointment Letter, DPDP Consent & Withdrawal.

## APIs

- `GET /api/ats/joining-control-room/queue`
- `GET /api/ats/joining-control-room/candidates/:candidateId`
- `PUT /api/ats/joining-control-room/candidates/:candidateId/payroll`
- `PUT /api/ats/joining-control-room/candidates/:candidateId/jclr`
- `PUT /api/ats/joining-control-room/candidates/:candidateId/statutory`
- `POST /api/ats/joining-control-room/candidates/:candidateId/readiness`
- `POST /api/ats/joining-control-room/candidates/:candidateId/employee-code`
