# LP Feedback data uploader module

Self-contained: this whole `lp_feedback/` folder can be copied to any
Windows machine and run on its own — it does **not** need the rest of the
HRMS2 repo, or the `housing_owner`/`housing_premium` folders, checked out
alongside it. It already contains its own credentials (`idcloud.env`,
`db.env`) and its own dependency list (`requirements.txt`).

## What it does (daily)

Every day, for the previous day's date, it downloads **two** reports from
the IDCloud webconsole (`eresolution.idcloud.in:9003`) and imports them:

1. **Agent Wise Performance** (report ID 18, Outbound → Agent) →
   `db_masmis.lp_feedback_apr`
2. **Call Register** (report ID 13, Outbound → Agent) →
   `db_masmis.lp_feedback_cdr`

`daily_lp_feedback.py` runs both end-to-end and is the one thing Task
Scheduler should call. Each report is independently idempotent (checked by
`report_date`) and independently fault-tolerant — one failing doesn't stop
the other. **Sundays are skipped entirely** (LP Feedback doesn't operate
that day — confirmed by the user, 2026-09-28) — no download is even
attempted.

## Hard-won details (read before changing any selector in these scripts)

The IDCloud portal is a Kendo-UI-heavy ASP.NET app, and several things
about it are not obvious from just looking at the page. All confirmed live,
2026-09-28:

- **Login is two steps.** `#LoginId` → click `#submit` → a *new*
  `#LoginPassword` field appears (not present on the first screen at all) →
  click `#submit` again.
- **The Report List page's own grid (`/​_report/_list`) would not render any
  rows in an automated session**, no matter how long the wait or how many
  retries — stuck on "No items to display". This is NOT because the data
  doesn't exist (a real browser session shows 29 reports across 3 pages);
  its own AJAX call (`POST /Report/_list/GetReport?ISparent=True`) defaults
  to `pageSize=10`, and something about a fresh automated session never got
  it to paint. Rather than fight that further, both download scripts go
  straight to `/_Report/_edit/_tab/<report_id>` instead, which works
  reliably. Report IDs currently known: Agent Wise Performance = 18, Call
  Register = 13 (both under Group=Outbound, Sub Group=Agent — the same name
  is reused under other groups with different IDs, e.g. Call Register under
  Inbound→ACD is ID 4; don't reuse an ID without checking which group it
  actually belongs to).
- **The Agent field defaults to EMPTY in a fresh session**, not "all
  agents" — even though a real user's own browser shows it pre-filled with
  all 9 LP Feedback agents (that's per-account persisted state from their
  own prior use, not a server default). Generating a report with it empty
  silently returns a "NOAGENT" / all-zero summary, not an error — costly to
  notice. `download_lp_feedback_report.py` reads the field's own Kendo
  MultiSelect `dataSource` and selects everything in it, so it always picks
  up "however many agents there are right now" rather than a hardcoded list
  of 9.
- **The date fields default to `dateType="Current"`** (today + a day
  offset), but changing that offset's value does NOT reliably change what
  Generate actually queries (confirmed live: the date field's on-screen
  text updated correctly, Generate still returned today's data). What does
  work: switching `dateType` to `"Fixed"` and setting the date field's own
  value directly — both via each field's real Kendo widget API
  (`$(el).data('kendoComboBox'|'kendoDatePicker'|'kendoMultiSelect')`, then
  `.value(...)` + `.trigger('change')`). Setting the underlying `<input>`
  DOM value directly (even with dispatched events) is not enough — it
  updates the visible text but not what Generate reads.
- **"Generate" is a `<span class="galaxyreport-search">`, not a
  `<button>`** — and it navigates straight into the Report View content on
  the same page; no separate tab click is needed.
- **"Export to CSV" is `<input type="submit" data-format="csv">` inside a
  real `<form method="POST">`**, not a plain link — Chrome's normal
  download manager handles the resulting file the same as any other
  download.
- **The export always writes the date as a `"<date> - <date>"` range**,
  even for a single day (e.g. `"2026-09-26 - 2026-09-26"`) — both convert
  scripts take the first half and reformat it to `"D-Mon-YY"` to match
  every existing row's own `report_date` convention.
- **Call Register's real export is missing 4 columns the table has room
  for**: `unique_flag`, `disposition_status`, `attempt`, `service_2`.
  Historical rows (imported before this pipeline existed) have real values
  there; a fresh export genuinely doesn't include them. `upload_lp_feedback_cdr.py`
  inserts `NULL` for these rather than guessing — a less detailed row, not
  a rejected one (only `Call_Number` is actually required).
- **Agent Wise Performance's export ends with two aggregate rows**
  (`Agent = "NOAGENT"`, a per-day "Day Total" and a grand "Summary") —
  `convert_lp_feedback_apr.py` drops both; neither is a real agent-day.

## One-time setup on a new machine

1. **Copy this whole folder** (`lp_feedback/`) to the target machine.
2. **Install Python 3.11+** and **Google Chrome**, if not already present.
3. Open a terminal in the folder and install dependencies:
   ```
   py -m pip install -r requirements.txt
   ```
4. Check `idcloud.env` and `db.env` are present and filled in (git-ignored;
   travel with the folder as a direct copy only):
   - `idcloud.env`:
     ```
     IDCLOUD_USERNAME=<real username>
     IDCLOUD_PASSWORD=<real password>
     ```
   - `db.env`:
     ```
     DB_HOST=<host>
     DB_PORT=3306
     DB_USER=<user>
     DB_PASSWORD=<password>
     DB_NAME=mas_hrms
     ```
5. **Test it manually first**:
   ```
   py daily_lp_feedback.py --date 2026-09-26
   ```
   (a date already known to have data — confirms login, agent selection,
   date handling and DB connectivity all work end-to-end.)
6. **Register the Task Scheduler job** (same pattern as the other
   companies' — see `../housing_owner/README.md` for the full click-by-click
   steps):
   - **Actions** → New → Start a program: Program/script `py`, Add
     arguments `"C:\...\lp_feedback\daily_lp_feedback.py"`, Start in
     `C:\...\lp_feedback`.
   - **Triggers**: Daily, a time after midnight when IDCloud's own data for
     the previous day is final.
   - **Settings**: tick "Run task as soon as possible after a scheduled
     start is missed" and a retry-on-failure policy.

## Manual / one-off use

```
py download_lp_feedback_report.py --report apr --date 2026-09-27 --headless
py convert_lp_feedback_apr.py downloads\LpFeedback_AgentWisePerformance_....csv --out downloads\apr.csv
py upload_lp_feedback_apr.py downloads\apr.csv --dry-run   # check first
py upload_lp_feedback_apr.py downloads\apr.csv             # then for real
```
Same pattern with `cdr` / `convert_lp_feedback_cdr.py` / `upload_lp_feedback_cdr.py`
for Call Register. Or let the orchestrator do all six steps for yesterday:
```
py daily_lp_feedback.py
```

## Known limitations

- **Real backlog not yet backfilled.** As of 2026-09-28, `lp_feedback_apr`
  has data only through 15-Sep-26 and `lp_feedback_cdr` only through
  17-Sep-26 (both missing 6-Sep and 13-Sep — both genuine Sundays, expected
  — plus everything after their last date). 26-Sep-26 was imported live
  while building this pipeline (5 apr rows, 1,736 cdr rows) as a real
  end-to-end test, but the rest of the gap (16/18-Sep through 25-Sep) has
  not been backfilled — ask for that explicitly if wanted; each day is a
  separate `py daily_lp_feedback.py --date YYYY-MM-DD` call (Sundays skip
  automatically).
- **No multi-day export tested.** The Generate button carries a
  `data-max_fetch-days="7"` attribute, suggesting a 7-day cap per request —
  observed, not yet exercised. This pipeline only ever requests one day at
  a time, so it doesn't matter for the daily run, but a future bulk-backfill
  script would need to respect that cap (and would still need one
  `report_date` per row anyway, same as today).
- **IDCloud portal flakiness.** Not yet observed as a real outage during
  testing, but the Report List page's own grid failing to render in an
  automated session (worked around above) suggests this portal is not
  perfectly robust to automation — watch the logs for repeated failures.
