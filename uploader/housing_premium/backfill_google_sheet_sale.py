#!/usr/bin/env python3
"""
One-off backfill: import "Sale raw" Google Sheet rows for a date range into
db_masmis.pre_sale. Written specifically to fill the 25-27 Sep 2026 gap
found live (pre_sale had data only through 24 Sep; the sheet already had
rows through 27 Sep) before the recurring sync (sync_google_sheet_sale.py)
takes over from that point forward.

Confirmed live before use: zero existing pre_sale rows for report_date >=
2026-09-25, so this cannot create duplicates for its default range.

Usage:
    py backfill_google_sheet_sale.py --from 2026-09-25 --to 2026-09-27 --dry-run
    py backfill_google_sheet_sale.py --from 2026-09-25 --to 2026-09-27
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from google_sheet_sale_common import (  # noqa: E402
    convert_row, fetch_all_rows, filter_already_inserted, header_index, insert_rows, sheets_service,
)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--from", dest="date_from", required=True, help="YYYY-MM-DD, inclusive")
    ap.add_argument("--to", dest="date_to", required=True, help="YYYY-MM-DD, inclusive")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    print(f"Reading '{'Sale raw'}' sheet ...")
    svc = sheets_service()
    all_rows = fetch_all_rows(svc)
    header, data_rows = all_rows[0], all_rows[1:]
    idx = header_index(header)
    print(f"  {len(data_rows)} data row(s) in the sheet.")

    matched: list[dict] = []
    skipped: list[str] = []
    for i, row in enumerate(data_rows, start=2):  # sheet row number, 1 = header
        parsed, skip_reason = convert_row(row, idx)
        if skip_reason:
            skipped.append(f"row {i}: {skip_reason}")
            continue
        if parsed["report_date"] is None:
            skipped.append(f"row {i}: unparseable Date")
            continue
        if args.date_from <= parsed["report_date"] <= args.date_to:
            matched.append(parsed)

    print(f"\n{len(matched)} row(s) match {args.date_from}..{args.date_to}.")
    if skipped:
        print(f"{len(skipped)} row(s) skipped (blank Order_ID or unparseable Date), e.g.:")
        for s in skipped[:5]:
            print(f"  - {s}")

    if not matched:
        print("Nothing to import.")
        return

    print("\nSample of matched rows:")
    for r in matched[:3]:
        print(f"  {r}")

    unmatched_tl = sorted({r["agent_name"] for r in matched if r["agent_name"] and not r["tl_name"]})
    if unmatched_tl:
        print(f"\n{len(unmatched_tl)} agent(s) with a blank TL_Name in the sheet itself (left blank, not guessed):")
        for a in unmatched_tl:
            print(f"    - {a}")

    to_insert, duplicates = filter_already_inserted(matched)
    if duplicates:
        print(f"\n{len(duplicates)} row(s) already exist in pre_sale by order_id -- skipped, not re-inserted.")

    if not to_insert:
        print("\nNothing new to insert (all already present).")
        return

    if args.dry_run:
        print(f"\nDRY RUN -- would insert {len(to_insert)} row(s) into db_masmis.pre_sale. No changes made.")
        return

    batch_id = insert_rows(to_insert, f"Google Sheet backfill {args.date_from}..{args.date_to} by {__file__}")
    print(f"\nInserted {len(to_insert)} row(s). Batch id: {batch_id}")


if __name__ == "__main__":
    main()
