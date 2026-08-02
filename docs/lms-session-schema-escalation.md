# Escalation: `portal_sessions` gained NOT NULL columns without defaults

**To:** MCN LMS repository owner
**From:** HRMS2 / MAS PeopleOS
**Date:** 2026-08-03
**Severity:** High — user-visible failure on `/lms/my-learning`, currently in CEO UAT
**Action requested:** one decision, described in "What we are asking for" below

---

## Summary

On 2026-07-29 the LMS added two `NOT NULL` columns with no default to `portal_sessions`:

| Column | Type | Default | Added by |
| --- | --- | --- | --- |
| `session_family_id` | `CHAR(36)` | none | `20260729100000_secure_browser_sessions` |
| `absolute_expires_at` | `DATETIME` | none | same |

`portal_sessions` lives in `lms_mcn`, the LMS's own database. HRMS writes to it directly
when a user opens the learning portal from HRMS. Our `INSERT` supplies six columns and
predates both, so every attempt now fails.

This is not a report that the LMS change was wrong — adding a session family to bind
refresh chains is the right hardening. It is a report that the change landed on a table a
second service writes to, and that service was not adjusted at the same time.

## Why it took five days to surface

It did not fail visibly on 29-Jul because an unrelated HRMS bug was returning an
unconditional `403` on the same route. The 403 was fixed on our side on 01-Aug, which
removed the mask, and the underlying `INSERT` failure reached the CEO's screen the same
day as a raw driver error. Two independent defects, one hiding the other — so the LMS
change has been broken for us since the day it shipped, not since the day it was noticed.

## What we have already fixed on our side

Both shipped and live in production as of `badec198`:

1. Our `INSERT` now supplies `session_family_id` (set to the session `id`, matching the
   LMS's own convention) and `absolute_expires_at`.
2. The raw driver message no longer reaches the browser. `lms.routes.ts` was returning
   `error: message` and `_details`, and our API client prefers `payload.error` over
   `payload.message`, so the SQL text rendered directly in the UI. Both removed.

**We have not modified the LMS schema and do not intend to.** Cross-repo schema edits are
how the original mismatch becomes permanent.

## Why this still needs you

Our fix guesses at two contracts we cannot see:

1. **`session_family_id` semantics.** We set it to the session's own `id`, which makes each
   session its own family root. If the LMS expects a refreshed session to *inherit* the
   family of the session it replaces, our value silently defeats the reuse detection the
   column was added for. The column would be populated, the constraint satisfied, and the
   security property absent — the worst of the three outcomes, because nothing fails.

2. **`absolute_expires_at` policy.** We are choosing a value with no knowledge of the LMS's
   intended maximum session lifetime. If the LMS enforces its own ceiling elsewhere, ours
   either conflicts with it or is dead.

Neither is visible from our side, and neither will produce an error if we are wrong.

## What we are asking for

Pick one:

- **(a) Publish the contract.** Document the intended `session_family_id` lineage rule and
  the `absolute_expires_at` policy, and we will conform to it. Cheapest.
- **(b) Give the columns defaults.** `session_family_id CHAR(36) NOT NULL DEFAULT (UUID())`
  and a computed `absolute_expires_at`, so external writers cannot get them wrong. This
  also protects any other service that writes to this table.
- **(c) Close the direct write.** Give us an endpoint that creates the session, and we stop
  writing to `portal_sessions` at all. Most correct, most work, and it removes this entire
  class of problem permanently.

We recommend **(c) long-term and (a) now**, because (a) unblocks UAT this week.

## The general request

`portal_sessions` has at least one external writer. A `NOT NULL`-without-default column
added to it is a breaking API change, not an internal migration. If there is a channel
where LMS schema changes are announced, please add us to it; if there is not, we would
like to help create one. We will do the same for any HRMS table the LMS reads.

## Compatibility check we ran, and its limits

We compared our `INSERT` column list against the LMS migration files present in this
repository's working copy and found exactly the two columns above. That is a **read of
files we happen to have, not of your live schema** — we have no credentials for `lms_mcn`
and did not attempt to obtain any. If other `NOT NULL`-without-default columns have been
added since, we would not know. A `SHOW CREATE TABLE portal_sessions` from you would close
that gap in one message.

---

**Contact:** shivam.giri@teammas.in
