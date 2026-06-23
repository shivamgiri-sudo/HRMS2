# HRMS2 Smoke Test Guide

## Offline Static Smoke

Run from the repository root:

```bash
npm run phase2:smoke:static
```

This checks code presence only. It does not connect to MySQL, run migrations, call providers, restart PM2, or deploy.

## Build Checks

Run from the repository root:

```bash
npm run build
cd backend && npm run build
```

## Staging DB Smoke

Only after staging approval and migration backup:

1. Run pending migrations in the backend environment.
2. Confirm `salary_exception_proposal` exists.
3. Confirm `appointment_letter_request` exists.
4. Create or reuse one BGV-ready candidate.
5. Open `/ats/bgv` and validate queue/status/manual feedback/name-match override.
6. Open `/ats/payroll-hr` and validate salary slab selection, proposal, and submit-offer.
7. Open `/ats/offer-approvals` and validate approve and correction-request behavior.
8. Convert a candidate to employee and confirm provisioning tasks appear in each queue route.
9. Exercise appointment-letter send, aadhaar-signed, company-signed, and complete API actions.
10. Confirm `/two-factor` send and verify behavior with a non-production account.

## Final Acceptance State

Current code-only acceptance is `BUILD-STABLE + STATIC-SMOKE-PASSED + NEEDS LIVE DB SMOKE`.

