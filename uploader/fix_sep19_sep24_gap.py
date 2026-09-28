#!/usr/bin/env python3
"""
One-off, non-destructive fix for 19-Sep and 24-Sep 2026 pre_sale rows.

Found live: only 8 of 63 sheet rows for 19-Sep and only 6 of 57 for 24-Sep
had ever been imported into db_masmis.pre_sale, all 14 with the same
scientific-notation-corrupted order_id as every other pre-25-Sep row (see
google_sheet_sale_common.py's docstring). Sheet-vs-DB revenue comparison
across every date confirmed these are the ONLY two dates with any mismatch;
after this fix the grand total across all of pre_sale should be exactly
2,223,097 (== the sheet's own full-column total), per user request.

User explicitly declined deleting/replacing the 14 existing rows (mid-task
correction, 2026-09-27) -- this script therefore does NOT touch them. It
instead reverse-engineers the corruption (Excel/SheetJS "General" format
displays a number too long for its column as scientific notation, rounded
to 6 significant digits) to identify EXACTLY which of the sheet's rows for
these two dates already have a corrupted counterpart in the DB, so only the
genuinely-missing rows get inserted -- confirmed live: all 14 existing rows
matched exactly one sheet row each via (reconstructed sci-notation, agent
name, amount, date), with zero ambiguity or leftover unmatched existing row.

Usage:
    py fix_sep19_sep24_gap.py --dry-run
    py fix_sep19_sep24_gap.py
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from upload_housing_premium_cdr import connect, load_db_config  # noqa: E402
from google_sheet_sale_common import (  # noqa: E402
    convert_row, fetch_all_rows, header_index, insert_rows, sheets_service,
)

TARGET_DATES = ("2026-09-19", "2026-09-24")


def to_excel_sci(order_id: str) -> str:
    """Replicates the historical corruption: an N-digit integer displayed in
    Excel/SheetJS 'General' format once it's too long, as D.DDDDDE+NN (6
    significant digits). Confirmed live: exactly reproduces every one of the
    14 existing corrupted order_id values from their real sheet counterpart."""
    n = int(order_id)
    exponent = len(str(n)) - 1
    mantissa = n / (10 ** exponent)
    return f"{mantissa:.5f}E+{exponent:02d}"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    cfg = load_db_config()
    conn = connect(cfg)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT order_id, agent_name, amount, report_date FROM db_masmis.pre_sale "
                "WHERE report_date IN (%s, %s)",
                TARGET_DATES,
            )
            existing = cur.fetchall()
    finally:
        conn.close()
    print(f"{len(existing)} existing row(s) currently in pre_sale for {TARGET_DATES}.")

    print("Reading 'Sale raw' sheet ...")
    svc = sheets_service()
    all_rows = fetch_all_rows(svc)
    header, data_rows = all_rows[0], all_rows[1:]
    idx = header_index(header)

    sheet_rows = []
    for row in data_rows:
        parsed, skip_reason = convert_row(row, idx)
        if skip_reason or parsed["report_date"] not in TARGET_DATES:
            continue
        parsed["_sci"] = to_excel_sci(parsed["order_id"])
        sheet_rows.append(parsed)
    print(f"{len(sheet_rows)} sheet row(s) for {TARGET_DATES}.")

    matched_idx: set[int] = set()
    unmatched_existing = []
    for order_id, agent_name, amount, report_date in existing:
        found = None
        for i, r in enumerate(sheet_rows):
            if i in matched_idx:
                continue
            if (r["_sci"] == str(order_id) and r["agent_name"] == agent_name
                    and abs(r["amount"] - float(amount)) < 0.01 and r["report_date"] == str(report_date)):
                found = i
                break
        if found is not None:
            matched_idx.add(found)
        else:
            unmatched_existing.append((order_id, agent_name, amount, report_date))

    if unmatched_existing:
        sys.exit(
            f"REFUSING to proceed: {len(unmatched_existing)} existing DB row(s) could not be matched to any "
            f"sheet row (would risk under- or double-counting): {unmatched_existing}"
        )

    to_insert = [r for i, r in enumerate(sheet_rows) if i not in matched_idx]
    for r in to_insert:
        del r["_sci"]

    print(f"\n{len(existing)} existing row(s) all matched 1:1 to a sheet row (left untouched, as requested).")
    print(f"{len(to_insert)} row(s) are genuinely new and will be inserted.")
    by_date: dict[str, int] = {}
    for r in to_insert:
        by_date[r["report_date"]] = by_date.get(r["report_date"], 0) + 1
    print(f"  by date: {by_date}")

    if not to_insert:
        print("Nothing to do.")
        return

    if args.dry_run:
        print(f"\nDRY RUN -- would insert {len(to_insert)} row(s). No changes made.")
        return

    batch_id = insert_rows(to_insert, "Sep19/Sep24 gap fix (non-destructive, matched by reconstructed order_id)")
    print(f"\nInserted {len(to_insert)} row(s). Batch id: {batch_id}")


if __name__ == "__main__":
    main()
