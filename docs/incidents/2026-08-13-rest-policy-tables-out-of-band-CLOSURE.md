# Closure note — out-of-band rest-policy DDL (2026-08-13 incident)

**Companion to:** `2026-08-13-rest-policy-tables-out-of-band.md` (the forensic record — unchanged, still the evidence of record)
**Prepared:** 2026-08-14, as part of the enterprise delta-audit remediation
**Purpose:** separate what has actually been resolved since 13 Aug from the one question that is still open, so this incident can be closed on a decision rather than left to lapse quietly.

This note does **not** close the incident. It narrows it to a single decision and puts that decision in front of an owner.

---

## Why this note exists

The original document set `Restart: NO-GO` and `Deploy: NO-GO`. Those gates are now, in practice, stale — 128 commits have landed on `origin/main` since, including several explicitly about unblocking deploys (`a2e30e35`, `3fcd8efd`). Production has plainly been restarted and deployed many times over.

That is the risk this note addresses. An incident whose stated controls no longer match reality stops being a control and becomes a piece of misleading documentation: the next person to read it either believes a freeze that isn't real, or concludes the whole document is out of date and ignores the part that still matters.

The forensic record is sound and should not be edited. What follows is the delta since it was written.

---

## Resolved since 2026-08-13

**1. The "loaded gun" has been disarmed.**

The original hazard was that `isRestPolicyFeatureActive()` decides feature activation by table existence alone, so the out-of-band tables had already flipped it `true` while `schema_migrations` knew nothing about them — meaning the next deploy carrying `rest-policy.service.ts` would have returned `REST_POLICY_MISSING` on every guarded roster write path for all 1,327 active employees.

Six of the seven roster-programme migrations are now registered in `MIGRATION_MANIFEST` and have been applied by the sanctioned runner against the already-existing objects — exactly the reconciliation sequence the original document prescribed (`CREATE TABLE IF NOT EXISTS` and guarded `ALTER`s making this an honest no-op that produces a real success record, not a forged one):

| Migration | Manifest state |
|---|---|
| 1200, 1201, 1202, 1210, 1211, 1212 | Registered and applied through the runner |
| 1213 (`wfm_shift_master_immutability_trigger`) | Deliberately in `knownUnlisted`, documented at `runPendingMigrations.ts:630` — not an omission |

`schema_migrations` and the production schema now agree, through the sanctioned path. No manual repair was performed, and the prohibition on forging `schema_migrations` rows was respected throughout.

**2. The deploy and restart gates are satisfied on the schema-drift grounds that raised them.** The freeze existed because a restart could have activated an unconfigured feature. That specific mechanism no longer applies.

**3. The tool that would have caught this class of problem is now partly in place.** A read-only target-table-existence check (`backend/scripts/migration-target-table-check.ts`) is wired into `npm run preflight` and CI, so a migration whose target table does not exist is caught before it reaches production. This does not detect out-of-band DDL — see the open item below.

---

## Not resolved

**Nobody has identified who executed the DDL, and nothing prevents a recurrence.**

The forensic position is unchanged from the original document: `general_log` was off, so the database offers no query-level attribution. `log_bin` was ON, and binlog events from `2026-08-13T16:49:10Z` may still be inspectable if retention covers a now-32-day-old window — that remains the only untried avenue, and it is a DBA action.

The leading hypothesis — that the full contents of `1210_minimum_rest_policy.sql` were run directly against production via a `mysql` client in the 4h45m window after the file was committed — is still a hypothesis.

What matters for closure is not the identity itself but what it stands for: **an unknown number of people or processes hold direct, unaudited write access to production `mas_hrms`, and there is no detective control that would surface the next such event.** The schema drift from this instance is repaired. The capability that produced it is untouched.

---

## The decision required

This incident cannot be closed by engineering work. It needs an owner to pick one of:

**Option A — Investigate.** Have the DBA attempt binlog inspection for `2026-08-13T16:49:10Z` before retention expires, and produce an access inventory: who and what currently holds DDL-capable credentials on production `mas_hrms`. Close the incident on findings.

**Option B — Accept and control.** Accept that attribution is no longer recoverable, and close the incident on a stated control change instead — for example enabling `general_log` (or an audit plugin) so the next occurrence is attributable, and/or restricting DDL-capable credentials. Recurrence stays possible but stops being invisible.

**Option C — Accept as-is.** Record an explicit accepted-risk decision, with a named accepting owner and a date, and close.

All three are legitimate. What is not legitimate is the current state: an incident marked OPEN, carrying controls that reality has already overridden, with no owner and no review date.

**Recommendation: Option B.** Attribution for a single 32-day-old event is worth much less than knowing about the next one. The detective control is cheap, and it converts an unbounded unknown into a monitored one. Option A's binlog attempt is worth doing *only if* it is cheap for the DBA and the retention window still covers it — it should not hold the closure.

---

## Suggested closure record

Whoever owns this should append to the original document, not overwrite it:

```
Status: CLOSED <date> — <owner name>
Disposition: <Option A / B / C, and the specific control adopted>
Schema drift: reconciled via MIGRATION_MANIFEST registration, applied through
  the sanctioned runner (see CLOSURE note, 2026-08-14).
Attribution: <finding, or "not recoverable — accepted">
Residual risk accepted by: <name>
Next review: <date, if any>
```

---

## What this note does not claim

- It does not claim the root cause was found. It was not.
- It does not lift the freeze on anyone's authority. It reports that the freeze has already lapsed in practice and that the schema-drift basis for it is resolved, so that the gap between the document and reality is visible rather than silent.
- It does not assess whether rest-policy enforcement should now go live. That remains blocked on its own separate gate: a read-only impact simulation plus WFM/Ops and HR/Payroll approval, with zero policy rows configured for 1,327 active employees and an explicit standing prohibition on picking an arbitrary seed value.
