# Credential rotation — what breaks, who has to be told, and in what order

Written 2026-08-08, after the exposure scan. **Rotation is the only action that helps.**
Everything already done — removing the values from 79 tracked files, adding a guard against
their return — stops *future* reads. It does nothing about the copies already taken from a
public repository, and it never will.

---

## Burn status, re-verified 2026-08-17

Two things changed since this was written, and one did not.

**The repository is now PRIVATE** (`isPrivate: true`, confirmed against the GitHub API). Several
passages below still read as though it were public — they are left as written rather than
quietly edited, because the reasoning they record is still the reasoning that applies to
anyone who cloned during the public window.

**The credentials are still burned.** Private-now does not undo public-then:

- The retired database password is reachable in **76 commits** of history. Making the
  repository private removes it from *future* clones and from nobody's existing one.
- Anyone who cloned, forked or CI-mirrored the repository while it was public holds the entire
  history, including every value, permanently and undetectably.
- There is no revocation mechanism for a git object already copied. **Rotation remains the only
  action that helps**, exactly as the original scan concluded.

**The containment claim was re-checked and holds.** A history scan finds the retired fragment in
exactly two tracked files today:
`backend/src/db/__tests__/no-hardcoded-credentials.contract.test.ts` and
`backend/src/db/__tests__/lms-mysql-no-hardcoded-fallback.test.ts`. Both are the regression
guards, which carry the fragment deliberately in order to assert it never reappears in source.
The "79 tracked files → 0" figure below is therefore accurate; those two are the watchers, not a
regression.

**What changed in urgency, honestly:** private repo + closed ports would reduce this from
"actively reachable by anyone" to "reachable by whoever already has a copy". That is a real
reduction and it is not zero risk. It does not make rotation optional before a first full
employee release.

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

All four of those databases answer from the public internet on 3306, as does the COSEC SQL
Server on 1433. **The specific addresses are deliberately not written here.** They are in
`backend/.env`, which is not tracked; this file is, and the repository is public, so listing
them would publish a target list next to a password that is already in this repository's
history. The earlier revision of this document did list them — assume they are known and
prioritise closing the ports accordingly.

Closing those ports is faster than rotation and reduces risk immediately; do it first if you
can only do one thing today.

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

## Owner and rollback

The sequence above says what to do and in what order. It did not say **who does it** or **how to
undo a rotation that goes wrong**, and a runbook without both is a plan nobody can execute under
pressure. Owners are roles, not names, so this does not rot when someone changes jobs.

| Group | Rotation owner | Must be on the call | Rollback |
|---|---|---|---|
| A — database passwords | IT / infrastructure | — | Restore the previous value in `backend/.env` and restart both pm2 apps. The old password keeps working until it is changed **at the database**, so stage it: set the new password at the DB *last*, and until you do, rollback is a file edit and a restart. |
| B — session secrets | IT / infrastructure | Service desk (expect a login-support spike) | Restore the previous secret and restart. Anyone issued a token under the new secret is logged out a second time — unavoidable, and the reason to rotate these in a quiet window. |
| C — inbound webhook secrets | Integration owner per counterparty | The counterparty's engineer, live | Per integration, not in bulk. Restore the old secret and restart; the counterparty reverts on their side. **Rotate one at a time** — a bulk rollback across five counterparties cannot be coordinated in an incident. |
| D — outbound provider credentials | The team that owns the provider relationship | Provider support, if they must issue the value | Usually irreversible: many providers invalidate the old value the moment they issue a new one. Treat as forward-only and verify immediately (see below). Keep the old value recorded until the new one is proven, in case the provider can reinstate. |

Two rules that apply to every group:

- **Never rotate two groups in the same window.** If something breaks you must be able to say
  which change caused it. This has to stay diagnosable.
- **`FIELD_ENCRYPTION_KEY` and `FIELD_BLIND_INDEX_KEY` are NOT in any group above, and must not
  be rotated as part of this exercise.** They are not access credentials — they are the keys the
  stored data was encrypted and indexed *with*. Changing either does not lock an attacker out; it
  makes roughly 110,000 encrypted values undecryptable and every blind index unmatchable. They
  need a re-encryption plan of their own, and that is a different piece of work.

---

## Verification — how you know each rotation actually took

A rotation nobody verified is a rotation you will discover failed at the worst moment. Check the
specific thing, not "the app still loads".

| Group | Verify by |
|---|---|
| A | `GET /api/health/version` returns `schema.valid: true` with a non-zero `applied` count — that response requires a live DB connection, so it proves the pool authenticated. Then confirm **both** pm2 apps restarted; the workers hold their own pools and a backend-only restart leaves them on the old value until they next reconnect. |
| B | Sign in, then confirm an **old** token is now rejected. A successful new login alone does not prove the old secret stopped working. |
| C | Wait for a **real inbound request** from the counterparty and confirm it lands. Do not accept a synthetic test — a self-signed probe verifies your own code, not their configuration. Biometric is the one to watch hardest: it feeds payroll attendance. |
| D | Send one real outbound message per provider and confirm delivery, not just a 200 from the API. `dispatch_log` records `sent` on the provider call returning success, which is not the same as delivered. |

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
