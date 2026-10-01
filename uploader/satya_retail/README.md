# Satya Retail data uploader module

Self-contained: this whole `satya_retail/` folder can be copied to any
Windows machine and run on its own. No browser automation here — this is a
direct **database-to-database** sync, simpler than the other companies'
pipelines. It reads live call data straight from the dialer's own database
(`dialer_db.data_master_in`, `ClientId = 499`) and writes into
`db_masmis.satya_cdr`, which **replaces the manual "Satya CDR.xlsx"
export/upload workflow entirely** — the same data is already sitting live
in `dialer_db` the moment a call happens.

## What it does

`dialer_db` is a shared upstream telephony database (read-only — never
written back to, per this repo's Database Boundary Rule) with a generic
multi-tenant schema (`Field1..Field50`, no fixed meaning). The real
per-client field labels come from `dialer_db.field_master_in_12`
(`ClientId = 499`'s own row), cross-checked against real row *content* —
e.g. `Field5` was confirmed as `remarks` because a real "Order Placed" row's
`Field5` read `"Order #GGN-1790658657829-8024"`, an exact format match to
`satya_cdr`'s own historical remarks values.

See `sync_satya_cdr.py`'s own docstring for the full column mapping and two
open judgment calls (`roster`, and how `call_id`/`uid` are derived since
they aren't unique per call in the historical data either).

## Two modes

```
py sync_satya_cdr.py --date 2026-08-31           # backfill one specific day
py sync_satya_cdr.py --dry-run                   # preview the incremental sync
py sync_satya_cdr.py                              # real incremental sync (checkpoint-based)
```

The incremental mode uses `satya_dataid_checkpoint.json` (dataId-based,
mirroring `housing_premium/sync_google_sheet_sale.py`'s own checkpoint
pattern) — each run only pulls `dialer_db` rows newer than the last run,
safe to schedule daily.

## One-time setup on a new machine

1. Copy this whole folder to the target machine.
2. `py -m pip install -r requirements.txt` (just `python-dotenv` + `PyMySQL` — no Selenium needed).
3. Fill in `db.env` (mas_hrms) and `dialer_db.env` (dialer_db) — same
   `DB_HOST`/`DB_USER`/`DB_PASSWORD`, different `DB_NAME`.
4. If starting fresh (no existing `satya_cdr` history to preserve), just
   run the incremental sync with no checkpoint file present — it will tell
   you to backfill first. Otherwise, set `satya_dataid_checkpoint.json` to
   the `dataId` boundary at the end of the last date already covered by any
   prior manual upload, then backfill anything before that by `--date`.
5. Register the Task Scheduler job the same way as the other companies':
   Program/script `py`, Add arguments `"C:\...\satya_retail\sync_satya_cdr.py"`,
   Start in `C:\...\satya_retail`, Daily trigger.

## Status (2026-09-29)

Backfilled the full gap between the last manual upload (23-Sep-26) and
today: 31-Aug-26, 24/25/26/28/29-Sep-26 — 6,541 rows. `satya_cdr` is now
gap-free from 31-Aug-26 through today (Sundays excluded — this process
doesn't operate on Sundays either, same as LP Feedback/Onboarding).
Checkpoint set to `dataId 2590023` (the max as of this backfill), so the
next scheduled run picks up only genuinely new calls.
