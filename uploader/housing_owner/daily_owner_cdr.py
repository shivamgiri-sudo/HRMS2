#!/usr/bin/env python3
"""
Daily unattended Housing Owner CDR pipeline -- downloads the Agent Performance
export for the current month from Tata Tele CloudPhone, converts it to the
Owner_cdr upload format (filtering out rows that belong to other processes
sharing the same Tata Tele account -- see convert_owner_cdr_export.py's
docstring), and imports into db_masmis.Owner_cdr ONLY the days that are not
already there.

Catch-up behaviour: a normal run does not just look at yesterday. It checks
every day from the 1st of the current month through yesterday, works out which
days are missing from Owner_cdr, and imports just those. So a missed day (machine
off, task not run) is filled in automatically on the next run.

Why one month download and not one day: this site's date picker only offers
calendar presets, not an arbitrary single day (see download_owner_cdr_report.py).
So the whole current month is downloaded once, and the converted rows are
filtered down to the missing dates before import. Owner_cdr has no unique key,
so the filter is what prevents doubled rows; the uploader's own guard still
refuses any file that contains an existing date.

Runs the three scripts in this folder as subprocesses:
    download_owner_cdr_report.py --range thismonth --headless
    convert_owner_cdr_export.py <downloaded file>
    upload_owner_cdr.py <filtered converted file>
Each run writes one timestamped log under uploader/housing_owner/logs/. Exit
code is non-zero on failure so Task Scheduler's run history shows it.

Setup on a new machine (see README.md in this folder for the full version):
  1. Copy this whole uploader/housing_owner/ folder to the target machine.
  2. Install Python 3.11+ and Google Chrome.
  3. py -m pip install -r requirements.txt
  4. Fill in tatatele.env and db.env (both git-ignored) with the real credentials.
  5. Register a daily Task Scheduler job running:
         py "<path>\\housing_owner\\daily_owner_cdr.py"
     with "Run whether user is logged on or not" and "Run task as soon as
     possible after a scheduled start is missed" both enabled.

Usage:
    py daily_owner_cdr.py      # catch up: current month through yesterday, missing days only
"""
from __future__ import annotations

import subprocess
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

from openpyxl import Workbook, load_workbook

HERE = Path(__file__).parent
LOG_DIR = HERE / "logs"
DOWNLOADS = HERE / "downloads"

sys.path.insert(0, str(HERE))
import upload_owner_cdr as up  # noqa: E402

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def to_report_date(day) -> str:
    return f"{day.day}-{MONTHS[day.month - 1]}-{str(day.year)[2:]}"  # Owner_cdr.report_date "D-Mon-YY"


def existing_report_dates(dates: list[str]) -> set[str]:
    if not dates:
        return set()
    cfg = up.load_db_config()
    conn = up.connect(cfg)
    try:
        with conn.cursor() as cur:
            placeholders = ", ".join(["%s"] * len(dates))
            cur.execute(f"SELECT DISTINCT report_date FROM db_masmis.Owner_cdr WHERE report_date IN ({placeholders})", dates)
            return {r[0] for r in cur.fetchall()}
    finally:
        conn.close()


def filter_to_dates(converted: Path, keep_dates: set[str], out_path: Path) -> tuple[int, dict[str, int]]:
    """Writes only the rows whose Date is in keep_dates. Returns (kept rows, kept count per date)."""
    wb = load_workbook(converted, read_only=True, data_only=True)
    ws = wb[wb.sheetnames[0]]
    rows_iter = ws.iter_rows(values_only=True)
    header = next(rows_iter)
    date_idx = next(i for i, h in enumerate(header) if h is not None and up.normalize_key(str(h)) == up.normalize_key("Date"))

    out = Workbook()
    out_ws = out.active
    out_ws.append(list(header))
    per_date: dict[str, int] = {}
    kept = 0
    for raw in rows_iter:
        if raw is None or all(v is None for v in raw):
            continue
        rd = up.clean_text(raw[date_idx]) if date_idx < len(raw) else None
        if rd in keep_dates:
            out_ws.append(list(raw))
            per_date[rd] = per_date.get(rd, 0) + 1
            kept += 1
    wb.close()
    out.save(out_path)
    return kept, per_date


def main() -> None:
    yesterday = (datetime.now() - timedelta(days=1)).date()
    month_label = yesterday.strftime("%Y-%m")
    days = []
    d = yesterday.replace(day=1)
    while d <= yesterday:
        days.append(d)
        d += timedelta(days=1)
    day_strs = {to_report_date(x): x.isoformat() for x in days}

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

    log(f"=== Housing Owner CDR catch-up run: {days[0]} to {yesterday} ===")
    try:
        already = existing_report_dates(list(day_strs))
        missing = [day_strs[r] for r in day_strs if r not in already]
        log(f"Days already in Owner_cdr: {len(already)}; days missing: {len(missing)} {sorted(missing)}")
        if not missing:
            log("=== SKIPPED (nothing missing) ===")
            return

        py = sys.executable
        log("Step 1/3: download (current month)")
        out = run_step(py, str(HERE / "download_owner_cdr_report.py"), "--range", "thismonth", "--headless")
        non_empty = [ln for ln in out.strip().splitlines() if ln.strip()]
        if not non_empty:
            raise RuntimeError("Download step produced no output -- cannot find the downloaded file path.")
        raw_path = non_empty[-1].strip()

        log("Step 2/3: convert (current month)")
        converted = DOWNLOADS / f"converted_thismonth_{month_label}.xlsx"
        run_step(py, str(HERE / "convert_owner_cdr_export.py"), raw_path, "--out", str(converted))

        log("Filtering to missing days only")
        keep = {to_report_date(x) for x in days if day_strs[to_report_date(x)] in missing}
        filtered = DOWNLOADS / f"missing_owner_cdr_{month_label}.xlsx"
        kept, per_date = filter_to_dates(converted, keep, filtered)
        if kept == 0:
            log("No rows in the export for the missing days (source has no data for them) -- nothing imported.")
            log("=== SUCCESS (no new rows) ===")
            return
        for d_str in sorted(per_date):
            log(f"  {d_str}: {per_date[d_str]} row(s)")

        log("Step 3/3: import (missing days only)")
        run_step(py, str(HERE / "upload_owner_cdr.py"), str(filtered))

        log("=== SUCCESS ===")
    except Exception as exc:  # noqa: BLE001 -- always logged with full context
        log(f"=== FAILED: {exc} ===")
        sys.exit(1)


if __name__ == "__main__":
    main()
