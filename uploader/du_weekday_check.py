#!/usr/bin/env python3
"""
Read-only DU Digital data check (CDR and APR).

DU Digital does not operate on Saturdays or Sundays, so:
  - any Saturday or Sunday that has rows in du_cdr_daily_actual / du_apr_daily_actual
    is reported as UNEXPECTED (the source should never produce weekend data), and
  - any weekday (Mon-Fri) in the range with no rows is reported as MISSING
    (could be a real gap, a holiday, or a not-yet-uploaded day -- review manually).

Default range: 1st of the current month through yesterday. Pass --from / --to
(YYYY-MM-DD) to check another window.

Read-only: SELECT statements only. Never writes to the database.

DB settings are read from an env file (default: ../housing_premium/db.env, the
same MySQL server the DU Digital tables live on). Pass --env to use another file.

Usage:
    py du_weekday_check.py
    py du_weekday_check.py --from 2026-09-01 --to 2026-09-30
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

import pymysql

HERE = Path(__file__).parent
DEFAULT_ENV = HERE / "housing_premium" / "db.env"
TABLES = ("du_cdr_daily_actual", "du_apr_daily_actual")
WEEKEND = {5, 6}  # Saturday, Sunday


def load_env(path: Path) -> dict[str, str]:
    cfg: dict[str, str] = {}
    if not path.is_file():
        sys.exit(f"DB env file not found: {path}")
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        cfg[k.strip()] = v.strip().strip('"').strip("'")
    return cfg


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--from", dest="start", help="YYYY-MM-DD (default: 1st of current month)")
    ap.add_argument("--to", dest="end", help="YYYY-MM-DD (default: yesterday)")
    ap.add_argument("--env", default=str(DEFAULT_ENV), help="DB env file to read")
    args = ap.parse_args()

    yesterday = datetime.now().date() - timedelta(days=1)
    start = datetime.strptime(args.start, "%Y-%m-%d").date() if args.start else yesterday.replace(day=1)
    end = datetime.strptime(args.end, "%Y-%m-%d").date() if args.end else yesterday
    if end < start:
        sys.exit("--to is before --from")

    env = load_env(Path(args.env))
    conn = pymysql.connect(
        host=env["DB_HOST"], port=int(env.get("DB_PORT", "3306")), user=env["DB_USER"],
        password=env["DB_PASSWORD"], database=env.get("DB_NAME", "mas_hrms"), charset="utf8mb4",
        read_timeout=60, connect_timeout=15,
    )
    print(f"=== DU Digital weekday check: {start} to {end} (read-only) ===")
    try:
        with conn.cursor() as cur:
            for table in TABLES:
                cur.execute(
                    "SELECT table_schema FROM information_schema.TABLES WHERE table_name = %s "
                    "AND table_schema IN ('db_masmis', 'mas_hrms') LIMIT 1",
                    (table,),
                )
                found = cur.fetchone()
                if not found:
                    print(f"\n--- {table} ---\n  TABLE NOT FOUND in db_masmis or mas_hrms -- cannot check.")
                    continue
                schema = found[0]
                cur.execute(
                    f"SELECT DATE(call_date) AS d, COUNT(*) FROM {schema}.{table} "
                    f"WHERE call_date >= %s AND call_date < DATE_ADD(%s, INTERVAL 1 DAY) GROUP BY d",
                    (start, end),
                )
                counts = {r[0]: r[1] for r in cur.fetchall()}
                unexpected, missing = [], []
                d = start
                while d <= end:
                    has = counts.get(d, 0)
                    if d.weekday() in WEEKEND and has:
                        unexpected.append((d, has))
                    if d.weekday() not in WEEKEND and not has:
                        missing.append(d)
                    d += timedelta(days=1)
                print(f"\n--- {table} ---")
                print(f"  days with data: {len(counts)}, total rows: {sum(counts.values())}")
                if unexpected:
                    print(f"  UNEXPECTED weekend data ({len(unexpected)} day(s)):")
                    for day, n in unexpected:
                        print(f"    {day.isoformat()} ({day.strftime('%a')}): {n} row(s)")
                else:
                    print("  UNEXPECTED weekend data: none (OK)")
                if missing:
                    print(f"  MISSING weekday data ({len(missing)} day(s)) -- review (gap, holiday, or not yet uploaded):")
                    print("    " + ", ".join(f"{m.isoformat()} ({m.strftime('%a')})" for m in missing))
                else:
                    print("  MISSING weekday data: none (OK)")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
