# HRMS1 / HRMS2 Runtime Route Parity Report

Audit date: 2026-06-26

## Runtime Availability

PM2 had no managed apps running.

Local port checks:

| Endpoint | Listening |
| --- | --- |
| `localhost:5055` | false |
| `localhost:8085` | false |

## Requested Frontend Routes

The requested route smoke checks were not executed because neither HRMS1 nor HRMS2 was running locally.

Routes pending runtime verification:

- `/`
- `/login`
- `/work-inbox`
- `/payroll/uploads`
- `/payroll/readiness`
- `/payroll/inactive-noc`
- `/payroll/salary-export`
- `/finance/budget-plans`
- `/finance/branch-advance`
- `/finance/grn`
- `/finance/grn-approvals`
- `/finance/vendor-payment-tracking`
- `/finance/budget-dashboard`
- `/letters/appointment-esign`
- `/exit/resignation`

## Requested Backend API Routes

The requested backend API smoke checks were not executed because no backend was listening locally.

API routes pending runtime verification:

- `GET /api/health`
- `GET /api/auth/me`
- `GET /api/payroll/readiness`
- `GET /api/finance/grn`
- `GET /api/finance/vendor-payments`

## Conclusion

Runtime route parity is unable to be verified from the current local state.
