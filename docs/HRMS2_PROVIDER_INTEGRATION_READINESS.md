# HRMS2 Provider Integration Readiness

**Date:** 2026-06-25  
**Audited from:** `backend/src/config/env.ts`, `sms.helper.ts`, `bgv-provider.adapter.ts`, `appointment-esign.service.ts`, `mock-digilocker.routes.ts`, `communication/providers/`

---

## Provider Status Summary

| Provider | Env Key(s) | Mode | Fallback | Failure Behavior | Status |
|---|---|---|---|---|---|
| SMS OTP (2FA + password reset) | `LOCAL_SMS_API_URL` / `LOCAL_SMS_API_KEY` or MSG91/Twilio via DB config | DB-configured | `local-sms.provider.ts` (requires endpoint) | Returns `false` → 2FA/OTP code shown in console only | **PENDING** |
| Email SMTP | `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` | Direct SMTP (Gmail or relay) | No fallback — email silently not sent | Notification delivery fails silently | **PENDING** |
| BGV / InfinitiAI | `INFINITY_AI_API_KEY`, `BGV_PROVIDER=infinity_ai` | Mock (`BGV_PROVIDER=mock`) | Mock adapter: returns format-pass, logs "switch to live" message | Returns mock pass — no real check | **DEFERRED** |
| BGV / Digio | `DIGIO_CLIENT_ID`, `DIGIO_CLIENT_SECRET` | Not configured | `BGV_PROVIDER=mock` | Returns mock pass | **DEFERRED** |
| Aadhaar e-sign (Digio) | `DIGIO_CLIENT_ID`, `DIGIO_CLIENT_SECRET`, `DIGIO_WEBHOOK_SECRET` | Not configured — mock internal URL | Manual override path available | Returns internal mock sign-page URL, not a real Digio URL | **DEFERRED** |
| Company digital signature | Not a separate provider key — part of appointment-esign.service.ts | Stub (service writes `company_sign_status='signed'` when override approved) | Manual override approval path | Company sign step can be completed via HR override | **DEFERRED** |
| DigiLocker / eKYC | `mock-digilocker.routes.ts` present | Mock DigiLocker in-process | Mock callback marks `status='verified'` | All candidate docs marked mock_verified | **DEFERRED (mock only)** |
| PAN verification | `INFINITY_AI_API_KEY` (BGV path) | Mock — format check only | Returns format-pass message | No real PAN verification | **DEFERRED** |
| Bank penny drop | `INFINITY_AI_API_KEY` (BGV path) | Mock — IFSC + account format check | Returns mock pass | No real bank validation | **DEFERRED** |
| EPFO / UAN | Not wired to external API | Manual HR data entry | No API call — data stored in employees table | Correct — EPFO API not yet in scope | **N/A — Manual** |
| COSEC / biometric sync | `NCOSEC_DB_HOST`, `NCOSEC_DB_PORT`, `NCOSEC_DB_USER`, `NCOSEC_DB_PASSWORD` | Not configured in production env | Attendance engine falls back to APR data or marks `missing_punch` | No biometric sync; WFM must use APR or manual regularization | **PENDING** |
| Domain / email provisioning | IT provisioning tasks tracked in `it_provisioning_task` table | Manual workflow tracked | No external API — tracked as WFM tasks | Correct — manual process | **N/A — Manual** |

---

## Detail: SMS OTP Provider

**Used for:** 2FA verification codes, forgot-password OTP  
**Code path:** `twoFactor.service.ts` → `sms.helper.ts` → `providerFactory.getProviderAsync('sms', dbConfig)`  
**Behavior when no provider configured:** `sendOtpSms()` returns `false`; OTP code logged to console; 2FA flow fails silently for the user  
**Required for production:** Yes — 2FA will not deliver OTP to users without a working SMS provider

**Setup required:**
```bash
# Option A: MSG91 (recommended for India)
# Configure MSG91 provider in DB via /api/communication/providers endpoint
# Keys: MSG91 auth key, template ID

# Option B: Twilio
TWILIO_ACCOUNT_SID=<value>
TWILIO_AUTH_TOKEN=<value>
TWILIO_FROM=<value>

# Option C: Local SMS relay (LOCAL_SMS_API_URL)
LOCAL_SMS_API_URL=http://<internal-sms-server>/api
LOCAL_SMS_API_KEY=<key>
LOCAL_SMS_SENDER_ID=MASCAL
```

---

## Detail: Email SMTP

**Used for:** Password reset links, onboarding invites, notification emails  
**Code path:** SMTP module in `communication/providers/email/`  
**Behavior when SMTP_USER/SMTP_PASS empty:** Email send attempts fail; notifications silently not delivered  
**Required for production:** Yes — candidate onboarding invites and password resets depend on email

**Setup required:**
```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=hrms-noreply@mascallnet.com   # or Gmail account
SMTP_PASS=<app-specific-password>        # Gmail app password (not account password)
SMTP_FROM=noreply@mascallnet.com
SMTP_FROM_NAME=MAS Callnet HRMS
```

---

## Detail: BGV Provider

**Current mode:** `BGV_PROVIDER=mock` (default)  
**Impact of mock mode:** All BGV checks (PAN, Aadhaar, bank, education, court) return mock pass with message "switch BGV_PROVIDER for live checks". Candidate is marked `verified` in the DB without real verification.  
**Acceptable for controlled pilot?** Yes — HR can do manual BGV review. Mock mode is clearly labelled in the service response.

**To activate live InfinitiAI BGV:**
```bash
BGV_PROVIDER=infinity_ai
INFINITY_AI_API_KEY=<key>
INFINITY_AI_CLIENT_ID=<client_id>
```

---

## Detail: Aadhaar E-Sign

**Current state:** `appointment-esign.service.ts` line 76 explicitly states "mock — no real provider". Candidate e-sign URL is an internal route (`/api/letters/appointment/:id/candidate-sign-page`), not a real Digio URL.  
**Impact:** Candidate cannot do real Aadhaar-based e-sign. HR must use manual override approval path to proceed past this step.  
**Manual override path:** Available in `appointment-esign.routes.ts` — HR submits override request; admin approves; letter moves to next state.  
**Acceptable for controlled pilot?** Yes — manual override is a valid production path. Real Digio integration is a Phase 2 integration task.

**To activate Digio e-sign:**
```bash
DIGIO_CLIENT_ID=<client_id>
DIGIO_CLIENT_SECRET=<secret>
DIGIO_WEBHOOK_SECRET=<webhook_secret>
BGV_PROVIDER=digio   # or keep infinity_ai for BGV, add Digio specifically for e-sign
```

---

## Detail: COSEC Biometric Sync

**Used for:** WFM attendance from Matrix Cosec devices  
**Env keys:** `NCOSEC_DB_HOST`, `NCOSEC_DB_PORT`, `NCOSEC_DB_USER`, `NCOSEC_DB_PASSWORD`, `NCOSEC_DB_NAME`  
**Behavior when not configured:** `cosec-sync.service.ts` will fail to connect; no biometric data synced; attendance engine uses APR (Vicidial) data for Operations staff; all others will show `missing_punch` or `unreconciled`  
**Required for controlled pilot?** Depends on whether biometric attendance is needed in pilot scope. If pilot is limited to ATS + onboarding + payroll governance, COSEC can remain deferred.

---

## Pilot Readiness Summary

| Provider | Pilot Blocking? | Action |
|---|---|---|
| SMS OTP | **YES** — 2FA delivery depends on it | Configure MSG91 or local SMS relay before pilot |
| SMTP Email | **YES** — onboarding invites and password reset depend on it | Configure SMTP credentials before pilot |
| BGV (InfinitiAI/Digio) | No — mock mode acceptable | Upgrade to live for full production |
| Aadhaar e-sign | No — manual override available | Upgrade to Digio for full production |
| DigiLocker | No — mock acceptable | Upgrade for full production |
| Bank penny drop | No — manual verification acceptable | Upgrade for full production |
| COSEC biometric | Depends on pilot scope | Configure if WFM is in pilot scope |
| EPFO/UAN | No — manual entry | N/A |
| Domain/email provisioning | No — manual IT process | N/A |
