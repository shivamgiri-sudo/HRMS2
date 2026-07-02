# HRMS1 / HRMS2 PM2 Parity Report

Audit date: 2026-06-26

## PM2 Runtime

`pm2 list` showed no managed applications running on this machine.

Result: PM2 runtime parity could not be verified locally because there are no active HRMS1 or HRMS2 PM2 processes to compare.

## Ecosystem Config

Both local repositories contain `ecosystem.config.cjs`.

Observed config shape:

| Field | HRMS1 local config | HRMS2 local config | Parity |
| --- | --- | --- | --- |
| Backend app name | `hrms-backend` | `hrms-backend` | match |
| Backend cwd | `C:\Users\shivamg\Upgraded HRMS\backend` | `C:\Users\shivamg\Upgraded HRMS\backend` | match, but HRMS1 points to HRMS2 path |
| Backend script | `node` | `node` | match |
| Backend args | `dist/src/server.js` | `dist/src/server.js` | match |
| Frontend app name | `hrms-frontend` | `hrms-frontend` | match |
| Frontend cwd | `C:\Users\shivamg\Upgraded HRMS` | `C:\Users\shivamg\Upgraded HRMS` | match, but HRMS1 points to HRMS2 path |
| Frontend args | `node_modules/.bin/vite preview --host 0.0.0.0 --port 8085` | same | match |
| Restart delay | `5000` | `5000` | match |
| Max restarts | `20` | `20` | match |
| Log paths | `C:\Users\shivamg\Upgraded HRMS\logs\...` | same | match, but HRMS1 points to HRMS2 path |

## Conclusion

PM2 runtime parity is not verified. The local HRMS1 ecosystem config is not a distinct HRMS1 deployment config because its cwd and log paths point to `C:\Users\shivamg\Upgraded HRMS`.
