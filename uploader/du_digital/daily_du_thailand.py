#!/usr/bin/env python3
"""
Daily unattended DU Digital Thailand pipeline -- downloads today's CDR
(Export Calls Report) and APR (Agents Time Detail) from the DU dialer, then
imports both into du_cdr_daily_actual / du_apr_daily_actual. Meant to run
once a day via Windows Task Scheduler, the same role
housing_premium/daily_housing_premium_cdr.py plays for that company.

The reference workbook's own SOP pulls TODAY's data each day (not
yesterday's, unlike Housing Premium) -- both download scripts default to
today, matching the user's own working reference scripts exactly.

Each step's output is captured into one timestamped log file per run under
uploader/du_digital/logs/, and this script exits non-zero on any failure.
CDR import is always safe to re-run (uniqueid is the real de-dup key); APR
import refuses to re-import an already-covered date unless --force is
passed (see upload_du_apr.py's own doc for why).

Usage:
    py daily_du_thailand.py                # today (the normal daily run)
    py daily_du_thailand.py --date 2026-10-01
    py daily_du_thailand.py --force         # re-import APR even if today already has rows
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).parent
LOG_DIR = HERE / "logs"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--date", help="YYYY-MM-DD for the APR report (default: today)")
    ap.add_argument("--force", action="store_true", help="Re-import APR even if today already has rows")
    ap.add_argument("--headless", action="store_true", default=True)
    args = ap.parse_args()

    LOG_DIR.mkdir(exist_ok=True)
    run_date = args.date or datetime.now().strftime("%Y-%m-%d")
    log_path = LOG_DIR / f"thailand_{run_date}_{int(time.time())}.log"
    lines: list[str] = []

    def log(msg: str) -> None:
        for line in str(msg).splitlines() or [""]:
            stamped = f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {line}"
            print(stamped)
            lines.append(stamped)
        log_path.write_text("\n".join(lines), encoding="utf-8")

    def run_step(*cmd: str) -> str:
        log(f"$ {' '.join(cmd)}")
        result = subprocess.run(cmd, capture_output=True, text=True, cwd=HERE, timeout=600)
        log(result.stdout)
        if result.stderr:
            log("--- stderr ---")
            log(result.stderr)
        if result.returncode != 0:
            raise RuntimeError(f"Step failed (exit {result.returncode}): {' '.join(cmd)}")
        return result.stdout

    log(f"=== DU Digital Thailand daily run for {run_date} ===")
    py = sys.executable
    headless_flag = ["--headless"] if args.headless else []
    try:
        log("Step 1/4: download CDR")
        out = run_step(py, str(HERE / "download_cdr_thailand.py"), *headless_flag)
        cdr_path = [ln for ln in out.strip().splitlines() if ln.strip()][-1].strip()

        log("Step 2/4: import CDR")
        run_step(py, str(HERE / "upload_du_cdr.py"), cdr_path, "--country", "THAILAND")

        log("Step 3/4: download APR")
        apr_args = [py, str(HERE / "download_apr_thailand.py"), *headless_flag]
        if args.date:
            apr_args += ["--date", args.date]
        out = run_step(*apr_args)
        apr_path = [ln for ln in out.strip().splitlines() if ln.strip()][-1].strip()

        log("Step 4/4: import APR")
        import_args = [py, str(HERE / "upload_du_apr.py"), apr_path, "--country", "THAILAND", "--date", run_date]
        if args.force:
            import_args.append("--force")
        run_step(*import_args)

        log(f"=== SUCCESS: {run_date} imported (CDR + APR) ===")
    except Exception as exc:  # noqa: BLE001 -- always logged with full context, never silently swallowed
        log(f"=== FAILED: {exc} ===")
        sys.exit(1)


if __name__ == "__main__":
    main()
