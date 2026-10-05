#!/usr/bin/env python3
"""
Daily unattended LP Feedback pipeline -- downloads Agent Wise Performance and
Call Register reports from the IDCloud webconsole, converts them, and imports
them into db_masmis.lp_feedback_apr / lp_feedback_cdr.

Catch-up behaviour: a normal run does not just look at yesterday. It walks
every day from the 1st of the current month through yesterday and imports any
(date, report) pair whose table has no rows yet. So a missed day (laptop off,
task not run, etc.) is filled in automatically on the next run. Sundays are
never attempted (per explicit user instruction, 2026-09-28: "this process not
run in sunday"). A date already present in a table is skipped for that report.

Runs each already-verified, independently-testable script in this folder as a
subprocess, once per missing (date, report):
    download_lp_feedback_report.py --report <apr|cdr> --date <day> --headless
    convert_lp_feedback_<apr|cdr>.py <downloaded file>
    upload_lp_feedback_<apr|cdr>.py <converted file>
Each run writes one timestamped log under uploader/lp_feedback/logs/. The
script exits non-zero if any attempted (date, report) failed, so Task
Scheduler's run history shows it. One failure never stops the other attempts.

Usage:
    py daily_lp_feedback.py                       # catch-up: current month through yesterday
    py daily_lp_feedback.py --date 2026-10-01     # just this one day
    py daily_lp_feedback.py --date 2026-10-01 --force   # re-import even if rows exist
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
from lp_feedback_db_common import connect, load_db_config  # noqa: E402

REPORTS = {
    "apr": ("lp_feedback_apr", "convert_lp_feedback_apr.py", "upload_lp_feedback_apr.py"),
    "cdr": ("lp_feedback_cdr", "convert_lp_feedback_cdr.py", "upload_lp_feedback_cdr.py"),
}
MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def to_report_date(day: date) -> str:
    return f"{day.day}-{MONTH_ABBR[day.month - 1]}-{str(day.year)[2:]}"


def already_imported(table: str, report_date: str) -> bool:
    cfg = load_db_config()
    conn = connect(cfg)
    try:
        with conn.cursor() as cur:
            cur.execute(f"SELECT COUNT(*) FROM db_masmis.{table} WHERE report_date = %s", (report_date,))
            return cur.fetchone()[0] > 0
    finally:
        conn.close()


def catch_up_dates(today: date) -> list[date]:
    yesterday = today - timedelta(days=1)
    first_of_month = yesterday.replace(day=1)
    days = []
    d = first_of_month
    while d <= yesterday:
        if d.weekday() != 6:  # Sunday is never run
            days.append(d)
        d += timedelta(days=1)
    return days


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--date", help="Single day YYYY-MM-DD (default: catch up current month through yesterday)")
    ap.add_argument("--force", action="store_true", help="Import even if the date already has rows")
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

    log(f"=== LP Feedback catch-up run: {len(targets)} day(s) to check: "
        f"{', '.join(t.isoformat() for t in targets) or 'none'} ===")
    if not targets:
        log("=== NOTHING TO DO ===")
        return

    py = sys.executable
    failed: list[str] = []
    for target in targets:
        target_s = target.isoformat()
        report_date = to_report_date(target)
        log(f"--- {target_s} ({report_date}) ---")
        for report, (table, convert_script, upload_script) in REPORTS.items():
            label = f"{target_s} {report}"
            try:
                if not args.force and already_imported(table, report_date):
                    log(f"{table} already has rows for {report_date} -- skipping {report}.")
                    continue

                log(f"[{label}] Step 1/3: download")
                out = run_step(py, str(HERE / "download_lp_feedback_report.py"), "--report", report, "--date", target_s, "--headless")
                non_empty = [ln for ln in out.strip().splitlines() if ln.strip()]
                if not non_empty:
                    raise RuntimeError("download step produced no output -- cannot find the downloaded file path")
                raw_path = non_empty[-1].strip()

                log(f"[{label}] Step 2/3: convert")
                converted_path = HERE / "downloads" / f"converted_{report}_{target_s}.csv"
                run_step(py, str(HERE / convert_script), raw_path, "--out", str(converted_path))

                log(f"[{label}] Step 3/3: import")
                import_args = [py, str(HERE / upload_script), str(converted_path)]
                if args.force:
                    import_args.append("--force")
                run_step(*import_args)

                log(f"[{label}] SUCCESS")
            except Exception as exc:  # noqa: BLE001 -- logged with context; other attempts continue
                log(f"[{label}] FAILED: {exc}")
                failed.append(label)

    if failed:
        log(f"=== FINISHED WITH FAILURES: {', '.join(failed)} ===")
        sys.exit(1)
    log("=== SUCCESS ===")


if __name__ == "__main__":
    main()
