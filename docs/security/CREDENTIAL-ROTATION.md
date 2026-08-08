# Credential rotation — what breaks, who has to be told, and in what order

Written 2026-08-08, after the exposure scan. **Rotation is the only action that helps.**
Everything already done — removing the values from 79 tracked files, adding a guard against
their return — stops *future* reads. It does nothing about the copies already taken from a
public repository, and it never will.

Fifteen secrets are exposed. They are **not** interchangeable: three of them log every user
out, five of them break inbound traffic from an outside company, and four of them are the
same value wearing different names. Rotating them in the wrong order turns a security fix
into an outage.

---

## The four that are one secret

`DB_PASSWORD`, `DIALER_DB_PASSWORD`, `BILL_DB_PASSWORD` and `LMS_DB_PASSWORD` **all hold the
same value.** One literal in the repo authenticated `mas_hrms`, `dialer_db`, `db_bill` and
`mcn_lms` alike.

Two consequences worth stating plainly:

- Compromise of any one of those databases was compromise of all four.
- They cannot be rotated independently while they share a value. Either give each database
  its own password (correct, more work) or accept that changing one means changing all four
  in the same window.

Every one of those databases now answers from the internet — `122.184.128.90:3306`,
`14.97.30.236:3306`, `115.241.59.220:3306`, and COSEC SQL on `14.97.30.234:1433`. Closing
those ports is faster than rotation and reduces risk immediately; do it first if you can only
do one thing today.

---

## Group A — internal only. Rotate freely, restart to apply.

Nobody outside the company needs to know. The blast radius is a service restart.

| Secret | Consumed by | On rotation |
|---|---|---|
| `DB_PASSWORD` | `env.ts`, every pool | restart `hrms2-backend` **and** `hrms2-workers` |
| `DIALER_DB_PASSWORD` | `db/dialerDb.ts`, `apr-vicidial-sync.worker.ts` | restart workers |
| `BILL_DB_PASSWORD` | `db/billDb.ts` | restart backend |
| `LMS_DB_PASSWORD` | `db/lms-mysql.ts` | restart backend |
| `NCOSEC_DB_PASSWORD` | `db/ncosecDb.ts`, cosec-sync worker | restart workers |
| `SOURCE_DB_PASSWORD` | `db/sourceDb.ts` | restart backend |

⚠ The 34 diagnostic scripts now read `process.env`, so they no longer break on rotation —
that was the trap that previously caused the new password to be pasted straight back in.
Run them as `node --env-file=backend/.env <script>`.

⚠ `apr-vicidial-sync.worker.ts` no longer has a hardcoded fallback. **Confirm the production
environment actually sets `DIALER_DB_PASSWORD` or `DB_PASS` before the next restart**, or the
APR sync will log its message and skip instead of running.

---

## Group B — rotating these logs people out

| Secret | Effect the moment it changes |
|---|---|
| `JWT_SECRET` | **every signed-in user is logged out.** Existing tokens fail verification immediately. |
| `PORTAL_JWT_SECRET` | every **client portal** session drops — external users, so pick the window deliberately |
| `OTP_HMAC_SECRET` | in-flight OTPs stop validating; anyone mid-login must restart |

Not dangerous, but not silent either. Do these in a low-traffic window and tell support first,
or you will field "I got logged out" tickets without knowing why.

`env.ts` already FATALs if `JWT_SECRET`, `PORTAL_JWT_SECRET` or `OTP_HMAC_SECRET` is left at
its known-insecure default, so the new value must be real and ≥32 characters.

**`JWT_SECRET` is the one to prioritise.** It is not a database credential — it is the key
`authMiddleware` verifies against. Anyone holding it can mint a valid token for any user id
and any role, with no password and no database reachability. Closing the firewall does not
mitigate it. Rotating the four DB passwords while leaving this one changes very little.

---

## Group C — an outside company must change something too

**These are inbound.** A third party sends us a header or signature and we verify it against
the secret. Rotate unilaterally and their traffic starts failing — silently, from your side,
because a rejected webhook looks like no webhook.

| Secret | Header / mechanism | Who must be coordinated | What breaks until they update |
|---|---|---|---|
| `BGV_WEBHOOK_SECRET` | signature check | BGV provider | background-verification results stop arriving |
| `LUCKPAY_WEBHOOK_SECRET` | `X-HRMS-Webhook-Secret` | Luckpay | eSign / penny-drop callbacks rejected |
| `PENNY_DROP_WEBHOOK_SECRET` | signature check | penny-drop provider | bank-verification results stop arriving |
| `BIOMETRIC_WEBHOOK_SECRET` | `X-Biometric-Token` | biometric middleware owner | punch pushes rejected — **feeds payroll attendance** |
| `ATS_FORM_API_KEY` | `X-ATS-Api-Key` | the Candidate Web Form and Recruiter Mobile App | candidate submissions rejected |

`ATS_FORM_API_KEY` deserves care: those clients are used **outside this repository**, so
"deploy the new key" is not something you control on their side.

**Do not rotate Group C the same evening as Group A.** If attendance, BGV and candidate
intake all go quiet at once, you will be debugging four integrations and a database change
simultaneously.

Where the provider supports two valid secrets at once, use it: add the new one, switch us,
then retire the old. Where they do not, agree a window with them.

---

## Group D — outbound credentials the provider issues

We authenticate to them, so the provider generates the new value; we just store it.

| Secret | Provider | Note |
|---|---|---|
| `LUCKPAY_BASIC_TOKEN` | Luckpay | eSign and BGV calls fail until updated |
| `SMARTPING_PASSWORD` | SmartPing SMS | outbound SMS stops; OTP delivery included |

---

## Suggested order

1. **Close 3306 and 1433 to the internet.** Fastest risk reduction, no coordination, no
   restart. Do this even if rotation is weeks away.
2. **`JWT_SECRET` and `PORTAL_JWT_SECRET`.** Highest severity, internal-only coordination,
   and the firewall does not mitigate them.
3. **Group A**, all four DB passwords together since they share one value. Ideally give each
   database its own password on the way through.
4. **Group C**, one integration at a time, each with its counterparty on the call. Verify a
   real inbound request lands after each before moving to the next.
5. **Group D**, whenever the providers can issue new values.
6. **Then** make the repository private and purge history. Purging is the last step, not the
   first: it invalidates nothing already cloned, and it rewrites every SHA — this repository
   has roughly a dozen concurrent worktrees, and a force-push here has destroyed merged work
   before. Coordinate it so everyone re-clones.

---

## After rotating

Update the regression guard. `backend/src/db/__tests__/no-hardcoded-credentials.contract.test.ts`
matches on a fragment of the **old** password so it can catch that value being pasted back.
Once rotated, replace the fragment with one from the retired value — it should keep watching
for the old one, not the new one, and the new one should never appear in a file at all.

Then re-run the containment check to confirm nothing crept back:

```bash
npx vitest run backend/src/db/__tests__/no-hardcoded-credentials.contract.test.ts
```

## What is already done, so it is not repeated

- 79 tracked files carrying a live credential → **0** (44 docs, 34 scripts, 1 production worker).
- Scripts read `process.env` and fail loudly rather than connecting with an empty password.
- `apr-vicidial-sync.worker.ts` no longer ships a hardcoded fallback in `dist/`.
- A contract test blocks the values returning.

None of that reduces the need to rotate.
