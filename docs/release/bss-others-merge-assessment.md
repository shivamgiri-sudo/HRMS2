# BSS-OTHERS: merge assessment

**Prepared:** 2026-08-03 · **Recommendation: do not merge yet.** One question must be
answered first, and it cannot be answered from the data.

---

## What was reported

CEO UAT flagged "2 duplicate BSS-OTHERS" among the test data to be purged. It was grouped
with the CODEX candidates and TEST DEMO processes as cleanup.

It does not belong in that group, and treating it as cleanup would have been the most
damaging thing in the whole purge.

## What is actually there

Two rows in `process_master`:

| | `BSS_OTHERS` | `BSSOTHERS` |
| --- | --- | --- |
| Employees attached | **15** | **179** |
| `client_name` | NULL | NULL |
| `workload_type` | NULL | NULL |
| `billing_rate_per_hour` | NULL | NULL |
| `branch_id` | NULL | NULL |

Neither is test data. Between them they carry **194 real employees**. Deleting either one
orphans that many people from every process-scoped report — headcount, attendance, KPI,
payroll cost attribution and P&L.

`process_master` has **38 inbound foreign keys**. A delete does not stay local.

This is why `scripts/classify-test-data.sql` marks a process only when nothing is attached
to it, and reports name-matching processes that carry employees separately (Step 0d). A
name-based rule would have caught these two.

## Why they cannot be told apart from the data

Every field that would distinguish them is NULL on both rows. There is no client, no
workload type, no billing rate, no branch. The only difference is the headcount and the
underscore in the name.

So the data cannot answer the question that matters:

> **Are these two spellings of one process, or two genuinely different pieces of work that
> were both named "other"?**

If it is the first, merging is right and overdue. If it is the second, merging destroys the
only remaining distinction between two cohorts — and because every other field is NULL, it
would be unrecoverable except from a backup.

## What must be answered before merging

**Ask the operations owner one question:** do the 15 employees on `BSS_OTHERS` and the 179 on
`BSSOTHERS` do the same work, for the same client, billed the same way?

Two supporting checks that narrow it, neither conclusive on its own:

1. **Do the two cohorts sit in different branches or report to different managers?** Separate
   branches or separate management lines point to two real groups. Same branch and same
   manager points to a data-entry split.
2. **When were the two rows created, and by whom?** A row created months apart from the other,
   by a different user, is more likely a duplicate typed in by someone who could not find the
   existing one. Both created in the same import points to a deliberate split.

Both are read-only queries against `process_master` and `employees`. **They have not been
run** — no production SQL is authorised for this work.

## If the answer is "same work" — how to merge safely

Not a `DELETE`. The order matters, and each step is separately reversible:

1. **Archive both rows** and the full list of affected `employees.id` values, before anything
   changes. The employee list is the part that cannot be reconstructed afterwards.
2. **Choose the survivor by headcount**, not by name: keep `BSSOTHERS` (179) and move the 15.
   Fewer rows change, so a mistake is smaller and easier to reverse.
3. **Re-point the 15 employees**, then re-point every other referencing table. All 38 foreign
   keys must be enumerated first — the ones that matter most are the historical rows
   (attendance, KPI actuals, salary lines), because leaving those behind silently changes
   what past months report.
4. **Deactivate the empty row, do not delete it.** `active_status = 0` keeps it out of every
   picker while preserving the audit trail and making the merge reversible. Deleting it
   destroys the evidence of what was merged.
5. **Verify the sum.** Headcount on the survivor must be exactly 194 afterwards. If it is not,
   stop and roll back — a mismatch means a referencing table was missed.

## If the answer is "different work"

Do not merge. Instead, populate the fields that would have made this obvious — `client_name`
and `workload_type` at minimum — and rename both rows so nobody flags them as duplicates
again. The cost of the current state is that this question gets re-asked every audit.

## Recommendation

**Hold.** This is a fifteen-minute conversation with an operations owner, followed by either
a scripted merge or two `UPDATE`s. It is not a release blocker and it should not be resolved
under time pressure — a wrong merge here is silent, affects 194 people's reporting history,
and the NULL fields mean nothing in the data would reveal the mistake afterwards.
