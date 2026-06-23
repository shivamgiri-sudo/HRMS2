# HRMS2 DPDP Compliance Onboarding Flow

## Purposes

- `candidate_onboarding`
- `bgv_verification`
- `document_review`
- `payroll_processing`

## Controls

- Purpose-wise consent is tracked in `dpdp_consent_register`.
- Withdrawal requests are tracked in `dpdp_consent_withdrawal`.
- Processing events are logged in `dpdp_processing_activity_log`.
- Document access is logged in `candidate_document_access_log`.

## Gate

The Joining Control Room readiness gate blocks employee code generation if required DPDP consent is not granted or has been withdrawn.
