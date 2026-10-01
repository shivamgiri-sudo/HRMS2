#!/usr/bin/env python3
"""
Daily unattended LP Onboarding pipeline -- downloads yesterday's Agent Wise
Performance and Call Register reports from the IDCloud webconsole, converts
them, and imports them into db_masmis.lp_onboarding_apr / lp_onboarding_cdr.
Meant to run once a day via Windows Task Scheduler, the same role
daily_owner_cdr.py plays for Housing Owner's Owner_cdr.

Runs each of the already-verified, independently-testable scripts in this
folder as subprocesses, once per report ('apr' then 'cdr'):
    download_lp_onboarding_report.py --report <apr|cdr> --date <yesterday> --headless
    convert_lp_onboarding_<apr|cdr>.py <downloaded file>
    upload_lp_onboarding_<apr|cdr>.py <converted file>
Each step's full output is captured into one timestamped log file per run
under uploader/lp_onboarding/logs/, and this script exits non-zero on any
failure so Task Scheduler's own run history shows it clearly.

Sundays are skipped entirely (no download attempted) -- per explicit user
instruction (2026-09-28): "this process not run in sunday so you can leave
for sunday data". A Sunday isn't a data gap to investigate; it's expected.

Idempotent per report: if a table already has rows for the target date,
that report's download/convert/import is skipped (checked independently for
apr and cdr, since one can legitimately be re-run without the other).

Setup on a new machine (see README.md in this folder for the full version):
  1. Copy this whole uploader/lp_onboarding/ folder to the target machine.
  2. Install Python 3.11+ and Google Chrome.
  3. py -m pip install -r requirements.txt
  4. Fill in idcloud.env and db.env (both git-ignored) with real credentials.
  5. Register a daily Task Scheduler job running:
         py "<path>\\lp_onboarding\\daily_lp_onboarding.py"

Usage:
    py daily_lp_onboarding.py                # yesterday (the normal daily run)
    py daily_lp_onboarding.py --date 2026-09-24   # backfill one specific day
    py daily_lp_onboarding.py --force             # re-import even if rows already exist
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
from lp_onboarding_db_common import connect, load_db_config  # noqa: E402

REPORTS = {
    "apr": ("lp_onboarding_apr", "convert_lp_onboarding_apr.py", "upload_lp_onboarding_apr.py"),
    "cdr": ("lp_onboarding_cdr", "convert_lp_onboarding_cdr.py", "upload_lp_onboarding_cdr.py"),
}
MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def to_report_date(date_str: str) -> str:
    y, m, d = date_str.split("-")
    return f"{int(d)}-{MONTH_ABBR[int(m) - 1]}-{y[2:]}"


def already_imported(table: str, report_date: str) -> bool:
    cfg = load_db_config()
    conn = connect(cfg)
    try:
        with conn.cursor() as cur:
            cur.execute(f"SELECT COUNT(*) FROM db_masmis.{table} WHERE report_date = %s", (report_date,))
            return cur.fetchone()[0] > 0
    finally:
        conn.close()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--date", help="Specific day YYYY-MM-DD to backfill (default: yesterday)")
    ap.add_argument("--force", action="store_true", help="Import even if this date already has rows")
    args = ap.parse_args()
    target = args.date or (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
    weekday = datetime.strptime(target, "%Y-%m-%d").weekday()  # Monday=0 ... Sunday=6
    report_date = to_report_date(target)

    LOG_DIR.mkdir(exist_ok=True)
    log_path = LOG_DIR / f"{target}_{int(time.time())}.log"
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

    log(f"=== LP Onboarding daily run for {target} ({report_date}) ===")

    if weekday == 6:
        log("Target date is a Sunday -- LP Onboarding does not run on Sundays. Nothing to do.")
        log("=== SKIPPED (Sunday) ===")
        return

    py = sys.executable
    failed: list[str] = []
    for report, (table, convert_script, upload_script) in REPORTS.items():
        log(f"--- {report} ({table}) ---")
        try:
            if not args.force and already_imported(table, report_date):
                log(f"{table} already has rows for {report_date} -- skipping (pass --force to re-import anyway).")
                continue

            log(f"Step 1/3: download ({report})")
            out = run_step(py, str(HERE / "download_lp_onboarding_report.py"), "--report", report, "--date", target, "--headless")
            non_empty = [ln for ln in out.strip().splitlines() if ln.strip()]
            if not non_empty:
                raise RuntimeError(f"Download step ({report}) produced no output -- cannot find the downloaded file path.")
            raw_path = non_empty[-1].strip()

            log(f"Step 2/3: convert ({report})")
            converted_path = HERE / "downloads" / f"converted_{report}_{target}.csv"
            run_step(py, str(HERE / convert_script), raw_path, "--out", str(converted_path))

            log(f"Step 3/3: import ({report})")
            import_args = [py, str(HERE / upload_script), str(converted_path)]
            if args.force:
                import_args.append("--force")
            run_step(*import_args)

            log(f"{report}: SUCCESS")
        except Exception as exc:  # noqa: BLE001 -- always logged with full context; one report's failure doesn't stop the other
            log(f"{report}: FAILED: {exc}")
            failed.append(report)

    if failed:
        log(f"=== FAILED: {', '.join(failed)} ===")
        sys.exit(1)
    log(f"=== SUCCESS: {target} imported ===")


if __name__ == "__main__":
    main()
