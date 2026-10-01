#!/usr/bin/env python3
"""
One-off backfill: fills disposition_status on every EXISTING db_masmis.lp_onboarding_cdr
row (imported before convert_lp_onboarding_cdr.py started computing it, 2026-09-29),
by looking up each row's real disposition value through lp_disposition_map.py --
the same lookup the converter now applies to every future import.

Only ever SETs disposition_status = <mapped value> WHERE disposition = <exact
text>, one UPDATE per distinct disposition string that has a real mapping.
Never touches attempt, unique_flag, service_2, or any other column. A
disposition with no entry in the map (e.g. "Hung up the call" -- left out of
the map on purpose, see lp_disposition_map.py's docstring) is left exactly
as it already was.

Safe to re-run: every UPDATE is idempotent.

Usage:
    py backfill_disposition_status.py --dry-run   # see the plan, write nothing
    py backfill_disposition_status.py             # apply for real
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from lp_disposition_map import get_disposition_status  # noqa: E402
from lp_onboarding_db_common import connect, load_db_config  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true", help="Print the plan; write nothing")
    args = ap.parse_args()

    cfg = load_db_config()
    conn = connect(cfg)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT disposition, COUNT(*) FROM db_masmis.lp_onboarding_cdr GROUP BY disposition"
            )
            rows = cur.fetchall()

        plan: list[tuple[str, str, int]] = []
        unmapped: list[tuple[str, int]] = []
        for disposition, count in rows:
            if disposition is None:
                continue
            status = get_disposition_status(disposition)
            if status is None:
                unmapped.append((disposition, count))
            else:
                plan.append((disposition, status, count))

        print(f"{len(plan)} distinct disposition value(s) mapped, {sum(c for _, _, c in plan)} row(s) affected.")
        if unmapped:
            print(f"{len(unmapped)} distinct disposition value(s) NOT in lp_disposition_map.py ({sum(c for _, c in unmapped)} row(s), left untouched):")
            for disp, count in sorted(unmapped, key=lambda x: -x[1]):
                print(f"    {count:>6}x  {disp!r}")

        if args.dry_run:
            print("\n--dry-run: nothing written.")
            return

        total_updated = 0
        with conn.cursor() as cur:
            for disposition, status, count in plan:
                cur.execute(
                    "UPDATE db_masmis.lp_onboarding_cdr SET disposition_status = %s WHERE disposition = %s",
                    (status, disposition),
                )
                total_updated += cur.rowcount
        conn.commit()
        print(f"\nUpdated {total_updated} row(s) across {len(plan)} disposition value(s).")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
