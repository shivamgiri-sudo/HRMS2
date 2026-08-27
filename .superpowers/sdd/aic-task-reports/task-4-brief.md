### Task 4 — Frontend: build a real `BiometricSyncPanel`

`src/pages/wfm/attendance-integrity/BiometricSyncPanel.tsx` (new).

Replaces `NativeCosecSyncMonitoring.tsx` — 12 lines wrapping `PeopleOSDataPage`, a generic JSON
dumper that renders one KPI and the latest run as `JSON.stringify` in a black `<pre>`, with a date
picker whose `from`/`to` the endpoint ignores. Meanwhile the nav calls this "Biometric sync" and
the CEO/WFM dashboards link to it labelled **"Devices"** — and there is no device list on it.

Build the panel the backend already supports. Live data as of 2026-08-27: **2,067 COSEC sync runs
(2,051 warning, 15 failed, 1 success), latest 2026-08-27 13:32; 209,437 rows in
`biometric_attendance_log`.** All four endpoints exist and are mounted; three have never had a
caller:

- `GET /api/integrations/cosec/sync-status` — health header: current status, last run, confidence
- `GET /api/integrations/cosec/sync-runs` — recent runs (50): started/completed, status, counts
- `GET /api/integrations/cosec/sync-errors` — failed runs / non-zero `records_failed` (50)
- `GET /api/integrations/cosec/latest-punches` — per-day rollups (100): employee, device, first in,
  last out, total punches, raw minutes. Note these are **day rollups, not individual punches** —
  label them accordingly; do not call them "punches".

Requirements: a KPI row (last sync, status, failed runs, punch-log freshness) using the tone system;
a runs table and an errors table, both in `overflow-x-auto`; a device column surfaced from
`device_id` so the "Devices" label the dashboards use is finally true. Loading skeleton, empty,
error and forbidden states. No raw JSON anywhere on the surface.

Since `2,051 of 2,067` runs carry status `warning`, a single status KPI reading "warning" is not
informative on its own — show the run-status breakdown so the number means something.

Run after: `npm run typecheck`

