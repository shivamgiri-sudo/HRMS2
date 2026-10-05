# Housing Premium data uploader module

Self-contained: this whole `uploader/` folder can be copied to any Windows
machine and run on its own — it does **not** need the rest of the HRMS2
repo checked out alongside it. It already contains its own credentials
(`callerdesk.env`, `db.env`, `google_service_account.json`) and its own
dependency list (`requirements.txt`).

It runs **two independent pipelines** on the same machine:
1. **CDR** (`daily_housing_premium_cdr.py`) — once a day, pulls yesterday's
   call logs from CallerDesk into `db_masmis.Pre_cdr`.
2. **Sale** (`sync_google_sheet_sale.py`) — every 15 minutes, pulls newly
   appended rows from the "Sale raw" Google Sheet into `db_masmis.pre_sale`.

Register both as separate Task Scheduler jobs — see each section below.

## Pipeline 1: CDR (daily) — what it does

Every day, for the previous day's date, it:
1. Logs into CallerDesk (`app.callerdesk.io/admin`) and downloads that day's
   Call Logs export (`download_callerdesk_report.py`).
2. Converts it to the column shape `db_masmis.Pre_cdr` expects — deriving
   Date/Time/TL/Count/Unique Count/Date row Count/V+W/Talk Time, and looking
   up each agent's Team Leader from the live roster, falling back to
   `housing_premium_tl_roster.json` for the handful of agents not yet in
   that roster table (`convert_callerdesk_export.py`).
3. Imports the result into `db_masmis.Pre_cdr` (`upload_housing_premium_cdr.py`).

`daily_housing_premium_cdr.py` runs all three in order and is the one thing
Task Scheduler should call. It's idempotent — if that date already has rows
in `Pre_cdr` (a duplicate scheduled fire, a catch-up run, a manual run
earlier that day), it skips the whole thing rather than risk duplicate rows.
Every run writes one log file to `logs/`.

## One-time setup on a new machine

1. **Copy this whole folder** (`uploader/`) to the target machine, e.g.
   `C:\HousingPremiumCDR\uploader\`.
2. **Install Python 3.11+** (python.org) and **Google Chrome**, if not
   already present.
3. Open a terminal in the folder and install dependencies:
   ```
   py -m pip install -r requirements.txt
   ```
4. Check `callerdesk.env`, `db.env` and `google_service_account.json` are
   present and filled in (they travel with this folder as a direct copy;
   they are deliberately excluded from git, so a `git clone` alone will
   never have them — a real folder copy does). If any is missing, recreate
   it:
   - `callerdesk.env`:
     ```
     CALLERDESK_EMAIL=<real email>
     CALLERDESK_PASSWORD=<real password>
     ```
   - `db.env`:
     ```
     DB_HOST=<host>
     DB_PORT=3306
     DB_USER=<user>
     DB_PASSWORD=<password>
     DB_NAME=mas_hrms
     ```
   - `google_service_account.json`: the JSON key downloaded from Google
     Cloud Console for the `hrms-sale-sheet-reader` service account (see
     "Pipeline 2" below for how it was created). That service account's
     email must also stay shared as a **Viewer** on the "Housing Premium
     Sale" Google Sheet, or pipeline 2 will fail with a permissions error.
5. **Test it manually first**, before scheduling anything:
   ```
   py daily_housing_premium_cdr.py --date 2026-09-01
   ```
   (pick any date already known to have data, so you get the "already
   imported, skipping" message quickly — confirms DB connectivity and
   CallerDesk login both work end-to-end without importing anything new.)
6. **Register the Task Scheduler job** (run as the account that will be
   logged in / unlocked on this machine most of the time — see note below):
   - Open Task Scheduler → Create Task (not "Basic Task", so the extra
     settings below are available).
   - **General** tab: name it e.g. "Housing Premium CDR daily import".
     Check "Run whether user is logged on or not" only if you also set a
     password for the account below — see note. Otherwise leave it as
     "Run only when user is logged on".
   - **Triggers** tab → New: Daily, pick a time after midnight when
     CallerDesk's own data for the previous day is guaranteed final — 06:00
     is a safe default. Under Advanced settings, tick **"Delay task for"**
     is not needed, but do enable this via the Settings tab (next).
   - **Actions** tab → New → Start a program:
     - Program/script: `py`
     - Add arguments: `"C:\HousingPremiumCDR\uploader\daily_housing_premium_cdr.py"`
     - Start in: `C:\HousingPremiumCDR\uploader`
   - **Settings** tab: tick **"Run task as soon as possible after a
     scheduled start is missed"** — this is the catch-up behaviour: if the
     machine was off/asleep at 06:00, it runs as soon as it's back on
     instead of silently skipping that day. Also tick "If the task fails,
     restart every" 15 minutes, up to 3 times, as a safety net against a
     transient CallerDesk server hiccup (this has happened live — see the
     503 errors noted in `download_callerdesk_report.py`'s own history).
   - Save. Enter the account's Windows password if prompted (only needed
     for "run whether logged on or not" mode).

   > **Note on "run whether logged on or not":** the download step uses
   > headless Chrome specifically so it can run without an interactive
   > desktop session. If this machine is always logged in anyway (e.g. a
   > shared always-on office PC that nobody signs out of), "Run only when
   > user is logged on" is simpler and avoids storing a Windows password in
   > Task Scheduler. Use "whether logged on or not" only if this machine is
   > sometimes at the lock screen and you need it to run through that.

## Pipeline 2: Sale (every 15 min) — what it does

Reads the "Sale raw" tab of the Housing Premium Sale Google Sheet
(`https://docs.google.com/spreadsheets/d/1FHYkToVy9rrW8mmMMzwMzw62U5MZwBymIsfzQLPw_3Y`)
and imports any rows appended since the last run into `db_masmis.pre_sale`.

- **Access**: via a Google Cloud service account (`hrms-sale-sheet-reader@agent-506818.iam.gserviceaccount.com`),
  shared as Viewer on that sheet — not a plain API key, since the sheet is
  private. To recreate this on a fresh Google Cloud project: enable the
  "Google Sheets API", create a Service Account under
  **APIs & Services → Credentials**, generate a JSON key for it (**Keys →
  Add Key → Create new key → JSON**), then share the target sheet with its
  email as Viewer.
- **Checkpoint-based, not date-based**: `sale_sheet_checkpoint.json` (auto-created,
  git-ignored, machine-local) tracks how many sheet rows have been processed.
  Each run only looks at rows appended after that point — it assumes the
  sheet only ever grows by appending at the bottom (confirmed true for how
  this log is used today).
- **Belt-and-braces duplicate guard**: even if the checkpoint were ever lost
  or a run overlapped another, every row is also checked against
  `pre_sale.order_id` before insert and skipped if already present.
- Every run writes one log file to `logs/` (`sale_sync_<timestamp>.log`).

**One-off gap already closed**: 25–27 Sep 2026 sale data was missing from
`pre_sale` entirely (last manual import stopped at 24 Sep) and was backfilled
once via `backfill_google_sheet_sale.py --from 2026-09-25 --to 2026-09-27`
before the recurring sync started. That script is also there for any future
gap (e.g. if the recurring job is off for a few days) — re-run it with the
missing date range; it's safe to re-run since it uses the same order_id
duplicate guard.

**Known pre-existing data issue**: every `pre_sale` row imported before this
pipeline (all 1,351 of them, dated 1–24 Sep) has its `order_id` stored in
Excel scientific-notation form (e.g. `9.03516E+11` instead of the real
`903516430672`) — a precision-loss bug from whatever process bulk-uploaded
them originally. This pipeline's own rows are unaffected (it reads the sheet
via `FORMATTED_VALUE`, which returns the exact digit string), but the old
rows are not automatically fixed — that would need a separate, explicitly
approved data-correction pass, and may not even be recoverable from the
scientific-notation form alone (the lost digits can't always be reconstructed).

### Registering the Task Scheduler job
1. Task Scheduler → **Create Task**.
2. **General** tab: name it e.g. "Housing Premium Sale sheet sync".
3. **Triggers** tab → New → **Daily**, recur every 1 day, **Repeat task
   every: 15 minutes**, **for a duration of: Indefinitely** (this is what
   actually gives the every-15-minutes behaviour in Task Scheduler — the
   Daily trigger is just the anchor; the repeat interval is what matters).
4. **Actions** tab → New → Start a program:
   - Program/script: `py`
   - Add arguments: `"C:\HousingPremiumCDR\uploader\sync_google_sheet_sale.py"`
   - Start in: `C:\HousingPremiumCDR\uploader`
5. **Settings** tab: tick **"If the task is already running, then the
   following rule applies"** → **Do not start a new instance** (a run
   should never overlap another — the checkpoint file isn't safe for
   concurrent writers).
6. Save.

## Manual / one-off use

Each script still works standalone, exactly as before, for backfilling a
specific day or debugging one step in isolation:
```
py download_callerdesk_report.py --date 2026-09-24 --headless
py convert_callerdesk_export.py downloads\callerdesk_2026-09-24_....xlsx --out downloads\converted_24.xlsx
py upload_housing_premium_cdr.py downloads\converted_24.xlsx --dry-run   # check first
py upload_housing_premium_cdr.py downloads\converted_24.xlsx            # then for real
```
Or just let the orchestrator do all three:
```
py daily_housing_premium_cdr.py --date 2026-09-24
```

For the sale sheet:
```
py sync_google_sheet_sale.py --dry-run    # preview only, checkpoint untouched
py sync_google_sheet_sale.py              # real run
py backfill_google_sheet_sale.py --from 2026-09-25 --to 2026-09-27 --dry-run
py backfill_google_sheet_sale.py --from 2026-09-25 --to 2026-09-27
```

## Known limitations

- **New agents not yet in the roster.** If a MEMBER name appears in a
  CallerDesk export that's neither in `db_masmis.pre_agent_details` nor in
  `housing_premium_tl_roster.json`, that row still imports (Total
  Calls/Revenue are correct) but its Team Leader is left blank, never
  guessed — check `logs/` for "MEMBER name(s) not found in the roster" and
  add them to `housing_premium_tl_roster.json` (or the DB roster) once
  their real TL is confirmed.
- **CallerDesk's own 7-day archive cutoff.** Its UI moves anything 7+ days
  old into a separate "Archived Database" page with different mechanics.
  If this machine misses more than ~6 days in a row, the missed dates will
  need pulling from that archive instead of this normal flow — not
  something this script currently handles.
- **CallerDesk server-side flakiness.** The export endpoint has returned a
  genuine `503 Service Unavailable` and unexplained long stalls during
  testing — both on CallerDesk's side, not this automation. The Task
  Scheduler retry setting above covers a transient one; a sustained outage
  will still need a manual re-run once it recovers.
