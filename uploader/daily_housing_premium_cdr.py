#!/usr/bin/env python3
"""
Daily unattended Housing Premium CDR pipeline -- downloads yesterday's Call
Logs export from CallerDesk, converts it to the Pre_cdr upload format, and
imports it into db_masmis.Pre_cdr. Meant to run once a day via Windows Task
Scheduler on an always-on machine (not a personal laptop, which is off some
nights -- a missed run there just never happens; there is no way around
that for a task that requires the OS to be running).

Runs each of the three already-verified, independently-testable scripts in
this folder as a subprocess, in order:
    download_callerdesk_report.py --date <yesterday> --headless
    convert_callerdesk_export.py <downloaded file>
    upload_housing_premium_cdr.py <converted file>
Each step's full output is captured into one timestamped log file per run
under uploader/logs/, and this script exits non-zero on any failure so
Task Scheduler's own run history shows it clearly.

Idempotent: if db_masmis.Pre_cdr already has rows for the target date (the
task fired twice, a catch-up run after the machine was off, someone already
ran it by hand earlier), the whole download/convert/import is skipped --
Pre_cdr has no unique constraint of its own (see upload_housing_premium_cdr.py),
so this check is the only thing standing between a re-run and doubled data.
Pass --force to re-import anyway (this ADDS a second batch's rows; it does
not delete or replace the first).

Setup on a new machine (see README.md in this folder for the full version):
  1. Copy this whole uploader/ folder to the target machine.
  2. Install Python 3.11+ and Google Chrome.
  3. py -m pip install -r requirements.txt
  4. Fill in callerdesk.env and db.env (both git-ignored; not included in
     any commit) with the real credentials.
  5. Register a daily Task Scheduler job running:
         py "<path>\\uploader\\daily_housing_premium_cdr.py"
     with "Run whether user is logged on or not" and "Run task as soon as
     possible after a scheduled start is missed" both enabled.

Usage:
    py daily_housing_premium_cdr.py                       # yesterday (the normal daily run)
    py daily_housing_premium_cdr.py --date 2026-09-24      # backfill one specific day
    py daily_housing_premium_cdr.py --force                # re-import even if rows already exist
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

HERE = Path(__file__).parent
LOG_DIR = HERE / "logs"

sys.path.insert(0, str(HERE))
from upload_housing_premium_cdr import connect, load_db_config  # noqa: E402


def already_imported(date_str: str) -> bool:
    y, m, d = date_str.split("-")
    report_date = f"{int(m)}/{int(d)}/{y[2:]}"  # matches Pre_cdr.report_date's own "M/D/YY" convention
    cfg = load_db_config()
    conn = connect(cfg)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM db_masmis.Pre_cdr WHERE report_date = %s", (report_date,))
            return cur.fetchone()[0] > 0
    finally:
        conn.close()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--date", help="Specific day YYYY-MM-DD to backfill (default: yesterday)")
    ap.add_argument("--force", action="store_true", help="Import even if this date already has rows in Pre_cdr")
    args = ap.parse_args()
    date_str = args.date or (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")

    LOG_DIR.mkdir(exist_ok=True)
    log_path = LOG_DIR / f"{date_str}_{int(time.time())}.log"
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

    log(f"=== Housing Premium CDR daily run for {date_str} ===")
    try:
        if not args.force and already_imported(date_str):
            log(f"Pre_cdr already has rows for {date_str} -- nothing to do (pass --force to re-import anyway).")
            log("=== SKIPPED (already up to date) ===")
            return

        py = sys.executable
        log("Step 1/3: download")
        out = run_step(py, str(HERE / "download_callerdesk_report.py"), "--date", date_str, "--headless")
        # download_callerdesk_report.py's main() prints the resolved file path as its last non-empty line.
        non_empty = [ln for ln in out.strip().splitlines() if ln.strip()]
        if not non_empty:
            raise RuntimeError("Download step produced no output -- cannot find the downloaded file path.")
        raw_path = non_empty[-1].strip()

        log("Step 2/3: convert")
        converted_path = HERE / "downloads" / f"converted_{date_str}.xlsx"
        run_step(py, str(HERE / "convert_callerdesk_export.py"), raw_path, "--out", str(converted_path))

        log("Step 3/3: import")
        import_args = [py, str(HERE / "upload_housing_premium_cdr.py"), str(converted_path)]
        if args.force:
            import_args.append("--force")
        run_step(*import_args)

        log(f"=== SUCCESS: {date_str} imported ===")
    except Exception as exc:  # noqa: BLE001 -- always logged with full context, never silently swallowed
        log(f"=== FAILED: {exc} ===")
        sys.exit(1)


if __name__ == "__main__":
    main()
