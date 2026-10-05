# DU Digital (Thailand + Korea) uploader module

Self-contained: this whole `du_digital/` folder can be copied to any
Windows machine and run on its own, the same pattern as this repo's other
`uploader/*` modules. Downloads CDR (Export Calls Report) and APR (Agents
Time Detail) daily from the DU dialer (`dudigital.par-infinity.com`, a
vicidial instance) and imports both into `mas_hrms`'s
`du_cdr_daily_actual` / `du_apr_daily_actual` tables.

Thailand and Korea are **not** separate backend pipelines -- both write to
the same two tables under one shared "DU Digital" process, split only by a
`dashboard_label` column (`KOREA`/`THAILAND`). This mirrors
`backend/src/modules/bulk-upload/du-apr-daily-bulk.service.ts` and
`du-cdr-bulk.service.ts` exactly, which this uploader calls into (via
direct DB insert, same fast-path pattern as `housing_premium`'s own
uploader scripts -- see that folder's README for why a direct-DB path
exists alongside the web Uploader page).

## What each script does

- `download_cdr_thailand.py` / `download_cdr_korea.py` -- logs into the DU
  dialer admin panel, runs the "Export Calls Report" for that country's
  campaign groups, and saves the raw export (Korea's is converted to
  `.xlsx`; Thailand's stays `.txt`, which the upload script also reads
  directly).
- `download_apr_korea.py` / `download_apr_thailand.py` -- same login, runs
  "Agents Time Detail" for that country's campaign group id, and saves an
  `.xlsx`/`.csv`.
- `upload_du_cdr.py` / `upload_du_apr.py` -- read a downloaded (or manually
  exported) file and insert it into `du_cdr_daily_actual` /
  `du_apr_daily_actual`, with the same column parsing the backend's own
  `DU_CDR_*`/`DU_APR_*` importers use (ported line-for-line into
  `du_common.py`, so a row imported here is indistinguishable from one
  imported through the web Uploader page).
- `daily_du_thailand.py` / `daily_du_korea.py` -- the daily orchestrator:
  download CDR -> import CDR -> download APR -> import APR, all logged to
  `logs/`, non-zero exit on any failure.

## Manual vs. scheduled upload

**Manual**: `DU_CDR_KOREA`, `DU_CDR_THAILAND`, `DU_APR_KOREA` and
`DU_APR_THAILAND` are all registered in `upload_template_master`, so they
already work from the app's own Uploader page (Bulk Upload Hub) like any
other upload type -- no separate manual-upload UI was needed. Export CDR
Raw / APR Raw from the dialer yourself and upload the file there whenever
you want, independent of the scheduled job below.

**Scheduled**: register `daily_du_thailand.py` and `daily_du_korea.py` as
two separate Windows Task Scheduler jobs (Program/script `py`, Add
arguments the full path to the script, Start in this folder, Daily
trigger, "Run whether user is logged on or not"). Each one downloads and
imports both CDR and APR for that country in one run.

## One-time setup on a new machine

1. Copy this whole `uploader/du_digital/` folder to the target machine.
2. Install Python 3.11+ and Google Chrome.
3. `py -m pip install -r requirements.txt`
4. Create `du.env` in this folder (git-ignored) with:
   ```
   DU_USERNAME=8888
   DU_PASSWORD=Welcome12345
   DU_HOST=dudigital.par-infinity.com
   # Optional -- defaults to this folder's own downloads/ subfolder if unset.
   # Set this only to keep using an existing Task Scheduler job already
   # pointed at a specific folder (e.g. D:\MIS\DU\Auto).
   DU_DOWNLOAD_DIR=
   ```
5. Create `db.env` in this folder (git-ignored), same `DB_HOST`/`DB_PORT`/
   `DB_USER`/`DB_PASSWORD`/`DB_NAME` as the other `uploader/*` modules
   (falls back to `backend/.env` if this file is absent).
6. Register the two Task Scheduler jobs described above.

## Usage

```
py daily_du_thailand.py                       # today's CDR + APR, Thailand
py daily_du_korea.py                          # today's CDR + APR, Korea
py daily_du_thailand.py --date 2026-10-01      # backfill a specific day's APR
py daily_du_thailand.py --force                # re-import APR even if today already has rows

# Individual steps, for manual runs or debugging:
py download_cdr_thailand.py [--headless]
py upload_du_cdr.py <file> --country THAILAND [--dry-run]
py download_apr_korea.py [--date YYYY-MM-DD] [--headless]
py upload_du_apr.py <file> --country KOREA [--force] [--dry-run]
```

## Idempotency

- **CDR**: always safe to re-run. `du_cdr_daily_actual`'s unique key is
  `(process_id, dashboard_label, uniqueid)` -- vicidial's own real per-call
  id -- so a re-import of the same or an overlapping range always upserts
  each real call to itself rather than duplicating it.
- **APR**: `upload_du_apr.py` refuses to import a date that already has
  rows for that country unless `--force` is passed. This is a deliberate,
  explicit pre-check (not a bare reliance on the table's own unique key,
  which includes a `source_reference` column that is not guaranteed stable
  across different upload sources for the same agent+date) -- the same
  safety pattern `housing_premium/upload_housing_premium_cdr.py` uses for
  the same reason.

## Status (2026-10-01)

Built from the user's own working reference Selenium scripts (confirmed
live against `dudigital.par-infinity.com`) plus the two real reference
workbooks ("Du-Digital Korea/Thailand MIS Dashboard Oct'26.xlsb") read
directly to confirm the CDR Raw / APR Raw column shapes. `du_cdr_daily_actual`
is a new table (`backend/sql/1810_du_cdr_daily_actual.sql`) -- not yet run
against production as of this writing; `du_apr_daily_actual` already
existed (`backend/sql/1710_du_apr_daily_actual.sql`) but had no reporting
dashboard reading it before this. The dashboard pages themselves
(DU Digital Thailand / Korea Performance Dashboard, matching the reference
workbooks' layout) are a separate, not-yet-built follow-on phase.
