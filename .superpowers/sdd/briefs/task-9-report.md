# Task 9 Report — Bulk-upload mode (cycle-linked)

## Status
DONE (minimal scope, exactly as the brief specifies)

## Files
- Modified: `src/pages/wfm/RosterBuilderPage.tsx` (deep link added next to the publish button)
- Test: three cases appended to `src/pages/wfm/__tests__/RosterBuilderPage.test.tsx`

## What shipped

A "Bulk upload this week's roster instead →" link to
`/wfm/roster-import?cycleId={cycleId}&processId={processId}`, rendered only once a cycle exists.
Verified the target route is real: `src/config/routes/workforce.routes.tsx:105` mounts
`/wfm/roster-import` behind `Gate pageCode="WFM_ROSTER"`.

`RosterImportPage.tsx` is untouched, per the plan's Global Constraints — asserted by a test, so
a later edit that reaches into that page from this subsystem fails the suite rather than
sliding in.

## Deferred, explicitly (carried forward from the brief, still true)

The import page does not read `cycleId`/`processId` from the query string, so the link carries
context that the destination currently ignores: the uploaded batch must still be committed from
that page, and its commit will not be cycle-linked until `RosterImportPage.tsx` is changed to
read these params and pass `cycleId` into Task 4's now-cycle-aware `commitImportBatch`. That is
real follow-up work needing separate sign-off on editing that page — it is not done here, and
the UI does not pretend otherwise.

## Verification

Covered by the RosterBuilderPage suite (see task-10 report for the run output): the link's
target, that the route exists, and that `RosterImportPage.tsx` was not modified.
