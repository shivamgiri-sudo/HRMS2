# Housing Owner data uploader module

Self-contained: this whole `housing_owner/` folder can be copied to any
Windows machine and run on its own — it does **not** need the rest of the
HRMS2 repo, or the `housing_premium/` folder, checked out alongside it. It
already contains its own credentials (`tatatele.env`, `db.env`,
`google_service_account.json`) and its own dependency list
(`requirements.txt`).

It runs **two independent pipelines**:
1. **CDR** (`daily_owner_cdr.py`) — once a day, pulls yesterday's Agent
   Performance report from Tata Tele CloudPhone into `db_masmis.Owner_cdr`.
2. **Sale** (`sync_owner_sale.py`) — on demand (not yet scheduled), pulls
   rows from the "Payments from Sales Report" Google Sheet into
   `db_masmis.owner_sale`.

## What it does (CDR pipeline, daily)

Every day, for the previous day's date, it:
1. Logs into Tata Tele Services' CloudPhone console
   (`cloudphone.tatateleservices.com`) and downloads that day's "Agent
   Performance" datewise report (`download_owner_cdr_report.py`).
2. Converts it to the column shape `db_masmis.Owner_cdr` expects — deriving
   report_date/Month/Day, Connected/Not Connected/Average Talk time, and
   looking up each agent's TL/AM from the live `db_masmis.owner_agent_details`
   roster (`convert_owner_cdr_export.py`).
3. Imports the result into `db_masmis.Owner_cdr` (`upload_owner_cdr.py`).

`daily_owner_cdr.py` runs all three in order and is the one thing Task
Scheduler should call. It's idempotent — if that date already has rows in
`Owner_cdr`, it skips the whole thing rather than risk duplicate rows. Every
run writes one log file to `logs/`.

## Important: this Tata Tele account is shared with other processes

A real export was found to contain ~440 agents, but only the ones whose name
ends in **"MCN"** belong to Housing Owner — the rest (suffixes like SKM, OC,
RM, ileads, etc.) belong to entirely different campaigns sharing the same
Tata Tele CloudPhone tenant. Confirmed live: every one of the 53 distinct
agents already in `Owner_cdr` before this pipeline existed ends in "MCN".
`convert_owner_cdr_export.py` filters to "MCN"-suffixed agents only and
prints how many rows it skipped for this reason on every run — check the
logs if that count ever looks unexpectedly low (it would mean Housing
Owner's own naming convention changed) or unexpectedly high (a real new
Housing Owner agent not following the "MCN" suffix would otherwise be
silently dropped).

## Zero-call rows are never imported

An agent with `Total Calls = 0` for a day (not logged in, not active on this
process that day, etc.) is not meaningful activity for this table (user
instruction, 2026-09-28). `convert_owner_cdr_export.py` filters these out
before they ever reach `upload_owner_cdr.py`. The very first real import
(27-Sep-26, before this filter existed) put 178 rows in, 137 of which had
Total Calls = 0 — those were deleted by hand once; every run since has the
filter built in.

## What it does (Sale pipeline, on demand)

Reads the "Payments from Sales Report" tab of the Housing Owner Google
Sheet (`https://docs.google.com/spreadsheets/d/1XXd2ogH9y3HE4u-Ikb8P81n86VOQaMryncv48y1v8n8`)
and imports any row not yet in `db_masmis.owner_sale`, matched by `Opp ID`
(no checkpoint file — the sheet is small enough, ~800 rows, that a full
opp_id diff on every run is cheap and catches a genuinely-missing older row,
not just new ones at the tail).

- **Access**: the same Google Cloud service account already used for
  Housing Premium's sale sheet (`hrms-sale-sheet-reader@agent-506818.iam.gserviceaccount.com`),
  additionally shared as Viewer on this sheet.
- **Column mapping quirks** (see `sync_owner_sale.py`'s own docstring for
  the full reasoning): the sheet's "With GST" column is actually
  `owner_sale.value`, and "Package Mode" is actually `payment_mode` — both
  confirmed by reconciling the sheet's own totals against what was already
  in `owner_sale` before trusting the mapping. The sheet's "City" column has
  no home in `owner_sale` and is dropped.
- **Date format**: "D-Month-YY" with the FULL month name (e.g.
  "1-September-26"), not the 3-letter form the app's own Uploader page
  importer originally supported — `owner-sale-bulk.service.ts`'s `parseDate()`
  was extended (2026-09-28) to accept both, so a future manual re-upload of
  this same report through the UI no longer silently produces `report_date =
  NULL` the way 162 existing rows already do (a pre-existing gap, not
  retroactively fixed by this change).
- First real run (2026-09-28) found `owner_sale` already had 766 of the
  sheet's 819 distinct Opp IDs (a mix of earlier manual uploads); imported
  the 53 genuinely missing ones (₹2,09,589) — one from 24-Sep (a gap inside
  an otherwise-covered date) and the rest from 26–27 Sep.
- **Known pre-existing data issue, not caused by this script**: `owner_sale`
  had 944 rows but only 766 distinct Opp IDs before this run — 178 rows are
  duplicates from an earlier, unrelated manual import. This script's
  Opp-ID-based duplicate guard means it can never add to that count, but it
  also does not clean up the existing duplicates — that would need a
  separate, explicitly-approved dedup pass.
- Not yet scheduled via Task Scheduler (run manually with `py
  sync_owner_sale.py` whenever a check is needed); wire it up the same way
  as Housing Premium's Pipeline 2 if a recurring cadence is wanted later.

## One-time setup on a new machine

1. **Copy this whole folder** (`housing_owner/`) to the target machine.
2. **Install Python 3.11+** (python.org) and **Google Chrome**, if not
   already present.
3. Open a terminal in the folder and install dependencies:
   ```
   py -m pip install -r requirements.txt
   ```
4. Check `tatatele.env` and `db.env` are present and filled in (they travel
   with this folder as a direct copy; they are deliberately excluded from
   git, so a `git clone` alone will never have them — a real folder copy
   does). If either is missing, recreate it:
   - `tatatele.env`:
     ```
     TATATELE_LOGIN_ID=<real login id>
     TATATELE_PASSWORD=<real password>
     ```
   - `db.env`:
     ```
     DB_HOST=<host>
     DB_PORT=3306
     DB_USER=<user>
     DB_PASSWORD=<password>
     DB_NAME=mas_hrms
     ```
5. **Test it manually first**, before scheduling anything:
   ```
   py daily_owner_cdr.py
   ```
6. **Register the Task Scheduler job** (same pattern as Housing Premium's —
   see `../housing_premium/README.md`'s "Registering the Task Scheduler job"
   section for the full click-by-click steps):
   - **Actions** tab → New → Start a program:
     - Program/script: `py`
     - Add arguments: `"C:\...\housing_owner\daily_owner_cdr.py"`
     - Start in: `C:\...\housing_owner`
   - **Triggers** tab: Daily, a time after midnight when Tata Tele's own data
     for the previous day is guaranteed final (06:00 is a safe default).
   - **Settings** tab: tick "Run task as soon as possible after a scheduled
     start is missed" and a retry-on-failure policy, same as Housing
     Premium's job.

## Manual / one-off use

Each script still works standalone, for backfilling a recent day (via
`--range`) or debugging one step in isolation:
```
py download_owner_cdr_report.py --range yesterday --headless
py convert_owner_cdr_export.py downloads\OwnerCDR_yesterday_....xlsx --out downloads\converted.xlsx
py upload_owner_cdr.py downloads\converted.xlsx --dry-run   # check first
py upload_owner_cdr.py downloads\converted.xlsx             # then for real
```
Or let the orchestrator do all three for yesterday:
```
py daily_owner_cdr.py
```

## Known limitations

- **No arbitrary single-day backfill yet.** `download_owner_cdr_report.py`
  only supports the site's calendar presets (`today`, `yesterday`, `last7`,
  `last30`, `thismonth`, `lastmonth`) — CallerDesk's downloader (Housing
  Premium) additionally supports an exact `--date` via its Custom Range
  calendar, confirmed live against that site's DOM. Tata Tele's own Custom
  Range calendar has not been inspected against a real session, so it isn't
  implemented here — guessing its cell structure risks silently selecting
  the wrong day. Use `--range last7`/`--range last30` to cover a recent gap
  instead (each row already carries its own Date, so a multi-day preset's
  export naturally contains one row per agent per day in that window;
  `upload_owner_cdr.py`'s per-report_date duplicate guard means re-running it
  over a range that overlaps already-imported days is refused unless
  `--force` is passed for the whole batch — check day-by-day before forcing).
  Exercised live 2026-09-28 to close a real one-day gap (26-Sep-26): ran
  `--range last7`, converted, filtered the converted file down to just the
  one missing report_date, then ran `upload_owner_cdr.py` on that filtered
  file (no `--force` needed, since that date had zero existing rows).
- **New agents not yet in the roster.** If an Agent appears in a Tata Tele
  export that's neither "MCN"-suffixed-and-known nor in
  `db_masmis.owner_agent_details`, the row still imports (Total
  Calls/Connected/etc. are correct) but its TL/AM are left blank — check
  `logs/` for "Agent(s) not found in owner_agent_details" and add them via
  the Process Details page (or directly in that table) once their real
  TL/AM is confirmed. Only 2 real (non-zero-call) agents were unmatched in a
  7-day sample (2026-09-28) — the large "123 unmatched" figure seen in the
  very first test run was almost entirely agents with zero calls that day
  (now filtered out entirely, see above), not a real roster gap.
- **Tata Tele server-side flakiness.** Not yet observed in testing, but not
  ruled out either — the Task Scheduler retry setting covers a transient
  failure; a sustained outage will still need a manual re-run once it
  recovers.
