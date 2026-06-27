# HRMS1 / HRMS2 Env Parity Report

Audit date: 2026-06-26

## Repositories Checked

- HRMS1 local path: `C:\Users\shivamg\HRMS1`
- HRMS2 local path: `C:\Users\shivamg\Upgraded HRMS`

## File Presence

| File | HRMS1 | HRMS2 | Parity |
| --- | --- | --- | --- |
| `.env` | missing | missing | match |
| `.env.production` | missing | missing | match |
| `.env.example` | present | present | match |
| `backend/.env` | present | present | match |
| `backend/.env.production` | missing | missing | match |
| `ecosystem.config.cjs` | present | present | match |
| `package.json` | present | present | present but differs |
| `backend/package.json` | present | present | present but differs |
| `vite.config.ts` | present | present | match by size/presence |
| `backend/tsconfig.json` | present | present | match by size/presence |

## Key Presence And Safe Value Parity

Secret values were not printed. For non-empty values, only same/different fingerprint status was evaluated.

### Root `.env`, `.env.production`, `.env.example`, `backend/.env.production`

All requested keys were missing in both repositories for these files.

### `backend/.env`

| Key | HRMS1 | HRMS2 | Safe parity result |
| --- | --- | --- | --- |
| `NODE_ENV` | exists, non-empty | exists, non-empty | different fingerprint |
| `INTERNAL_DEMO_BYPASS` | exists, non-empty | exists, non-empty | same fingerprint |
| `JWT_SECRET` | exists, non-empty | exists, non-empty | different fingerprint |
| `PORTAL_JWT_SECRET` | exists, non-empty | exists, non-empty | different fingerprint |
| `ENCRYPTION_KEY` | exists, non-empty | exists, non-empty | same fingerprint |
| `BGV_WEBHOOK_SECRET` | missing | exists, non-empty | mismatch |
| `ATS_FORM_API_KEY` | missing | exists, non-empty | mismatch |
| `DB_HOST` | exists, non-empty | exists, non-empty | same fingerprint |
| `DB_NAME` | exists, non-empty | exists, non-empty | same fingerprint |
| `DB_USER` | exists, non-empty | exists, non-empty | same fingerprint |
| `FRONTEND_URL` | exists, non-empty | exists, non-empty | different fingerprint |
| `CORS_ALLOWED_ORIGINS` | missing | missing | match |
| `SMS_PROVIDER` | missing | missing | match |
| `SMTP_HOST` | exists, non-empty | exists, non-empty | same fingerprint |

## Conclusion

Env key parity does not pass. HRMS2 has keys missing in HRMS1 (`BGV_WEBHOOK_SECRET`, `ATS_FORM_API_KEY`), and several shared keys have different safe fingerprints (`NODE_ENV`, `JWT_SECRET`, `PORTAL_JWT_SECRET`, `FRONTEND_URL`).
