#!/usr/bin/env python3
"""
Daily unattended Housing Premium CDR pipeline -- downloads CallerDesk Call Logs
exports, converts them to the Pre_cdr upload format, and imports them into
db_masmis.Pre_cdr.

Catch-up behaviour: a normal run does not just look at yesterday. It walks every
day from the 1st of the current month through yesterday and imports any day
whose Pre_cdr rows are missing. So a missed day (machine off, task not run) is
filled in automatically on the next run. Sundays are included like every other
day. A day already present in Pre_cdr is skipped.

Runs the three already-verified scripts in this folder as subprocesses, per day:
    download_callerdesk_report.py --date <day> --headless
    convert_callerdesk_export.py <downloaded file>
    upload_housing_premium_cdr.py <converted file>
Each run writes one timestamped log under uploader/housing_premium/logs/. The
script exits non-zero if any attempted day failed; one day's failure never stops
the others.

Pre_cdr has no unique constraint of its own (see upload_housing_premium_cdr.py),
so the already-imported check is the only thing preventing doubled rows on a
re-run. Pass --force to re-import a day anyway (this ADDS a second batch's rows).

Setup on a new machine (see README.md in this folder for the full version):
  1. Copy this whole uploader/housing_premium/ folder to the target machine.
  2. Install Python 3.11+ and Google Chrome.
  3. py -m pip install -r requirements.txt
  4. Fill in callerdesk.env and db.env (both git-ignored) with real credentials.
  5. Register a daily Task Scheduler job running:
         py "<path>\\housing_premium\\daily_housing_premium_cdr.py"
     with "Run whether user is logged on or not" and "Run task as soon as
     possible after a scheduled start is missed" both enabled.

Usage:
    py daily_housing_premium_cdr.py                       # catch up: current month through yesterday
    py daily_housing_premium_cdr.py --date 2026-09-24     # just this one day
    py daily_housing_premium_cdr.py --date 2026-09-24 --force   # re-import even if rows exist
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

HERE = Path(__file__).parent
LOG_DIR = HERE / "logs"

sys.path.insert(0, str(HERE))
from upload_housing_premium_cdr import connect, load_db_config  # noqa: E402


def to_report_date(day: date) -> str:
    return f"{day.month}/{day.day}/{str(day.year)[2:]}"  # Pre_cdr.report_date's own "M/D/YY" convention


def already_imported(day: date) -> bool:
    cfg = load_db_config()
    conn = connect(cfg)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM db_masmis.Pre_cdr WHERE report_date = %s", (to_report_date(day),))
            return cur.fetchone()[0] > 0
    finally:
        conn.close()


def catch_up_dates(today: date) -> list[date]:
    yesterday = today - timedelta(days=1)
    days = []
    d = yesterday.replace(day=1)
    while d <= yesterday:
        days.append(d)
        d += timedelta(days=1)
    return days


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--date", help="Single day YYYY-MM-DD (default: catch up current month through yesterday)")
    ap.add_argument("--force", action="store_true", help="Import even if the date already has rows in Pre_cdr")
    args = ap.parse_args()

    if args.date:
        targets = [datetime.strptime(args.date, "%Y-%m-%d").date()]
    else:
        targets = catch_up_dates(datetime.now().date())

    LOG_DIR.mkdir(exist_ok=True)
    log_path = LOG_DIR / f"run_{int(time.time())}.log"
    lines: list[str] = []

    def log(msg: str) -> None:
        for line in str(msg).splitlines() or [""]:
            stamped = f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {line}"
            print(stamped)
            lines.append(stamped)
        log_path.write_text("\n".join(lines), encoding="utf-8")

    def run_step(*cmd: str) -> str:
        log(f"$ {' '.join(cmd)}")
        result = subprocess.run(cmd, capture_output=True, text=True, cwd=HERE, timeout=900)
        log(result.stdout)
        if result.stderr:
            log("--- stderr ---")
            log(result.stderr)
        if result.returncode != 0:
            raise RuntimeError(f"Step failed (exit {result.returncode}): {' '.join(cmd)}")
        return result.stdout

    log(f"=== Housing Premium CDR catch-up run: {len(targets)} day(s) to check: "
        f"{', '.join(t.isoformat() for t in targets) or 'none'} ===")
    if not targets:
        log("=== NOTHING TO DO ===")
        return

    py = sys.executable
    failed: list[str] = []
    for target in targets:
        target_s = target.isoformat()
        try:
            log(f"--- {target_s} ---")
            if not args.force and already_imported(target):
                log(f"Pre_cdr already has rows for {target_s} -- skipping.")
                continue

            log(f"[{target_s}] Step 1/3: download")
            out = run_step(py, str(HERE / "download_callerdesk_report.py"), "--date", target_s, "--headless")
            non_empty = [ln for ln in out.strip().splitlines() if ln.strip()]
            if not non_empty:
                raise RuntimeError("download step produced no output -- cannot find the downloaded file path")
            raw_path = non_empty[-1].strip()

            log(f"[{target_s}] Step 2/3: convert")
            converted_path = HERE / "downloads" / f"converted_{target_s}.xlsx"
            run_step(py, str(HERE / "convert_callerdesk_export.py"), raw_path, "--out", str(converted_path))

            log(f"[{target_s}] Step 3/3: import")
            import_args = [py, str(HERE / "upload_housing_premium_cdr.py"), str(converted_path)]
            if args.force:
                import_args.append("--force")
            run_step(*import_args)

            log(f"[{target_s}] SUCCESS")
        except Exception as exc:  # noqa: BLE001 -- logged with context; other days continue
            log(f"[{target_s}] FAILED: {exc}")
            failed.append(target_s)

    if failed:
        log(f"=== FINISHED WITH FAILURES: {', '.join(failed)} ===")
        sys.exit(1)
    log("=== SUCCESS ===")


if __name__ == "__main__":
    main()
