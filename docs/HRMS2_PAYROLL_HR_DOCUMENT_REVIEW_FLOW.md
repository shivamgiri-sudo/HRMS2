# HRMS2 Payroll HR Document Review Flow

## Flow

1. Payroll HR opens candidate in Joining Control Room.
2. Uploaded Documents lists normalized records from `candidate_onboarding_document` and `ats_candidate_documents`.
3. Secure viewer streams the document without exposing raw path.
4. Payroll HR verifies, rejects, or requests re-upload.
5. Each action updates the source document table and writes an access log.
6. Readiness gate uses document verification state before employee code generation.

## Document Statuses

- `pending`
- `verified`
- `rejected`
- `deleted` for candidate-withdrawn documents in onboarding source.
