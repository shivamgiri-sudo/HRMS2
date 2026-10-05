#!/usr/bin/env python3
"""
Daily unattended DU Digital Korea pipeline -- same role as
daily_du_thailand.py, for the Korea CDR + APR pair. See that script's own
doc for the full rationale (shared architecture, both scripts differ only
in which download_*/upload_du_*.py --country they call).

Usage:
    py daily_du_korea.py                # today (the normal daily run)
    py daily_du_korea.py --date 2026-10-01
    py daily_du_korea.py --force         # re-import APR even if today already has rows
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
    log_path = LOG_DIR / f"korea_{run_date}_{int(time.time())}.log"
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

    log(f"=== DU Digital Korea daily run for {run_date} ===")
    py = sys.executable
    headless_flag = ["--headless"] if args.headless else []
    try:
        log("Step 1/4: download CDR")
        out = run_step(py, str(HERE / "download_cdr_korea.py"), *headless_flag)
        cdr_path = [ln for ln in out.strip().splitlines() if ln.strip()][-1].strip()

        log("Step 2/4: import CDR")
        run_step(py, str(HERE / "upload_du_cdr.py"), cdr_path, "--country", "KOREA")

        log("Step 3/4: download APR")
        apr_args = [py, str(HERE / "download_apr_korea.py"), *headless_flag]
        if args.date:
            apr_args += ["--date", args.date]
        out = run_step(*apr_args)
        apr_path = [ln for ln in out.strip().splitlines() if ln.strip()][-1].strip()

        log("Step 4/4: import APR")
        import_args = [py, str(HERE / "upload_du_apr.py"), apr_path, "--country", "KOREA", "--date", run_date]
        if args.force:
            import_args.append("--force")
        run_step(*import_args)

        log(f"=== SUCCESS: {run_date} imported (CDR + APR) ===")
    except Exception as exc:  # noqa: BLE001 -- always logged with full context, never silently swallowed
        log(f"=== FAILED: {exc} ===")
        sys.exit(1)


if __name__ == "__main__":
    main()
