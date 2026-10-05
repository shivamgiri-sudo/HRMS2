#!/usr/bin/env python3
"""
Reconciliation check: compares the whole "Sale raw" Google Sheet against the whole
db_masmis.pre_sale table and reports whether their row count and total Amount agree --
and if not, exactly which sheet rows (by Order_ID) are missing from pre_sale and would
need inserting.

Read-only: never writes to the sheet or the database. Run it any time to confirm the
two are in sync, independent of sync_google_sheet_sale.py's own checkpoint (which only
tracks how far down the sheet it has looked, not whether every row it processed
actually landed in the table -- this script checks the real end state in both places
instead of trusting either one).

Known, pre-existing caveat (see google_sheet_sale_common.py's own module docstring):
the 1,351 pre_sale rows imported before this pipeline existed (dated 1-24 Sep 2026,
from a separate manual bulk-upload process) have their order_id stored in Excel
scientific-notation form (e.g. "9.03516E+11") instead of the sheet's real digit string
("903516430672") -- a precision-loss bug in whatever process loaded them originally,
not something this script or the sync pipeline caused. Those rows can never
order-id-match the sheet, so this script reports them separately as "pre-existing
corrupted rows" rather than folding them into the "missing from pre_sale" count, which
would otherwise wrongly claim ~1,351 rows need re-inserting when they are already
there under a mangled id.

Usage:
    py check_sale_sheet_sync.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from google_sheet_sale_common import convert_row, fetch_all_rows, header_index, sheets_service  # noqa: E402
from upload_housing_premium_cdr import connect, load_db_config  # noqa: E402

CORRUPTED_ORDER_ID_RE = re.compile(r"^\d+(\.\d+)?E\+\d+$", re.IGNORECASE)


def is_corrupted_order_id(order_id: str) -> bool:
    """True for the pre-existing scientific-notation form, e.g. '9.03516E+11'."""
    return bool(CORRUPTED_ORDER_ID_RE.match(order_id))


def main() -> None:
    print("=== Sale raw sheet <-> pre_sale reconciliation ===\n")

    svc = sheets_service()
    rows = fetch_all_rows(svc)
    if not rows:
        sys.exit("Sheet returned no rows at all -- check SHEET_ID / SHEET_TAB / sharing.")
    header, data_rows = rows[0], rows[1:]
    idx = header_index(header)

    sheet_by_order_id: dict[str, dict] = {}
    blank_order_id = 0
    dup_order_ids: list[str] = []
    for row in data_rows:
        converted, _skip_reason = convert_row(row, idx)
        if converted is None:
            blank_order_id += 1
            continue
        # A real sheet should never repeat an Order_ID; last one wins if it somehow
        # does, and this is reported so it's visible rather than silently overwriting.
        if converted["order_id"] in sheet_by_order_id:
            dup_order_ids.append(converted["order_id"])
        sheet_by_order_id[converted["order_id"]] = converted

    sheet_count = len(sheet_by_order_id)
    sheet_amount = round(sum(r["amount"] for r in sheet_by_order_id.values()), 2)
    print(f"Sheet ('Sale raw'): {len(data_rows)} data row(s), {blank_order_id} with a blank Order_ID (never imported).")
    if dup_order_ids:
        print(f"  NOTE: {len(dup_order_ids)} Order_ID(s) appear more than once in the sheet: {dup_order_ids[:10]}{' ...' if len(dup_order_ids) > 10 else ''}")
    print(f"  -> {sheet_count} row(s) with a real Order_ID, totalling Rs {sheet_amount:,.2f}")

    cfg = load_db_config()
    conn = connect(cfg)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*), COALESCE(SUM(amount), 0) FROM db_masmis.pre_sale")
            db_count, db_amount = cur.fetchone()
            db_amount = round(float(db_amount), 2)
            cur.execute("SELECT order_id FROM db_masmis.pre_sale")
            db_order_ids = {r[0] for r in cur.fetchall()}
    finally:
        conn.close()

    print(f"\ndb_masmis.pre_sale: {db_count} row(s) total, totalling Rs {db_amount:,.2f}")

    count_diff = sheet_count - db_count
    amount_diff = round(sheet_amount - db_amount, 2)

    print("\n--- Result ---")
    if count_diff == 0 and abs(amount_diff) < 0.01:
        print("MATCH: sheet and pre_sale agree on both row count and total amount.")
    else:
        print(f"Row count: sheet has {sheet_count}, pre_sale has {db_count}  (difference: {count_diff:+d})")
        print(f"Amount:    sheet totals Rs {sheet_amount:,.2f}, pre_sale totals Rs {db_amount:,.2f}  (difference: Rs {amount_diff:+,.2f})")

    compare_rows(sheet_by_order_id)

    missing_from_db = [oid for oid in sheet_by_order_id if oid not in db_order_ids]
    corrupted_in_db = [oid for oid in db_order_ids if is_corrupted_order_id(oid)]
    unexplained_in_db = [oid for oid in db_order_ids if oid not in sheet_by_order_id and not is_corrupted_order_id(oid)]

    # A sheet row's real order_id can fail to find its DB row for two very different reasons, and
    # confusing them would tell someone to re-run a backfill that actually double-counts revenue:
    #   1. It genuinely was never inserted (count/amount mismatch above is non-zero) -- act on this.
    #   2. It WAS inserted, just under the pre-existing corrupted (scientific-notation) order_id the
    #      original manual bulk-upload wrote instead of the sheet's real digit string -- the amount is
    #      already counted in pre_sale's total, just filed under a mangled id. Re-inserting these would
    #      duplicate real revenue. The totals already matching above is what proves this bucket is (2),
    #      not (1); this section exists to explain the raw numbers, not to suggest running anything.
    is_full_match = count_diff == 0 and abs(amount_diff) < 0.01
    if is_full_match:
        print(f"\n{len(missing_from_db)} sheet row(s) don't order_id-match any pre_sale row directly, but the totals above already match --")
        print("  so these are the known pre-existing corrupted-order_id legacy rows (case 2 above), already counted, NOT a real gap.")
        print("  Do NOT run sync/backfill for these -- that would double-count their revenue. Nothing to do here.")
    else:
        print(f"\nSheet rows NOT YET in pre_sale (need inserting): {len(missing_from_db)}")
        if missing_from_db:
            preview = missing_from_db[:20]
            for oid in preview:
                r = sheet_by_order_id[oid]
                print(f"    {oid}  {r['report_date']}  {r['agent_name']}  Rs {r['amount']:,.2f}")
            if len(missing_from_db) > len(preview):
                print(f"    ... and {len(missing_from_db) - len(preview)} more")
            missing_amount = round(sum(sheet_by_order_id[oid]["amount"] for oid in missing_from_db), 2)
            print(f"    (totalling Rs {missing_amount:,.2f} -- some of this may still be the known legacy id mismatch below, not all necessarily new)")
            print("  Run: py sync_google_sheet_sale.py   (or backfill_google_sheet_sale.py for a specific date range)")

    print(f"\npre_sale rows with the known pre-existing corrupted (scientific-notation) Order_ID: {len(corrupted_in_db)} unique value(s)")
    print("  (imported before this pipeline existed. Several different real order_ids can round to the same short")
    print("   scientific-notation string, e.g. '9.03516E+11' -- so this unique-value count is smaller than the")
    print("   number of legacy rows it actually covers. Expected, not a real mismatch; see this script's own docstring.)")

    if unexplained_in_db:
        print(f"\npre_sale rows that match NEITHER a real sheet Order_ID NOR the known corrupted pattern: {len(unexplained_in_db)}")
        print("  These may be rows the sheet no longer has (deleted/edited there since import), or a different data source entirely.")
        for oid in unexplained_in_db[:20]:
            print(f"    {oid}")
        if len(unexplained_in_db) > 20:
            print(f"    ... and {len(unexplained_in_db) - 20} more")


COMPARE_FIELDS = ("report_date", "created_date", "agent_name", "tl_name", "partner_name",
                  "amount", "order_value", "target", "week")


def _norm(field: str, value):
    if value is None or (isinstance(value, str) and value.strip() == ""):
        return None
    if field in ("amount", "order_value", "target"):
        return round(float(value), 2)
    return str(value).strip()


def compare_rows(sheet_by_order_id: dict[str, dict]) -> None:
    """Field-by-field comparison of every sheet row against its pre_sale row (matched by exact order_id)."""
    cfg = load_db_config()
    conn = connect(cfg)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT order_id, report_date, created_date, agent_name, tl_name, partner_name, "
                "amount, order_value, target, week FROM db_masmis.pre_sale"
            )
            db_rows = {r[0]: dict(zip(("order_id",) + COMPARE_FIELDS, r)) for r in cur.fetchall()}
    finally:
        conn.close()

    matched = [oid for oid in sheet_by_order_id if oid in db_rows]
    mismatches: list[tuple[str, str, object, object]] = []
    for oid in matched:
        s, d = sheet_by_order_id[oid], db_rows[oid]
        for f in COMPARE_FIELDS:
            sv, dv = _norm(f, s.get(f)), _norm(f, d.get(f))
            if sv != dv:
                mismatches.append((oid, f, sv, dv))

    print("\n--- Row-by-row comparison (exact order_id matches) ---")
    rows_with_diff = len({m[0] for m in mismatches})
    print(f"Sheet rows matched to a pre_sale row: {len(matched)} of {len(sheet_by_order_id)}")
    if not mismatches:
        print("ALL MATCHED ROWS IDENTICAL on every compared field.")
        return
    print(f"ROWS THAT DIFFER: {rows_with_diff}  (field differences: {len(mismatches)})")
    for oid, f, sv, dv in mismatches[:30]:
        print(f"    {oid}  {f}: sheet={sv!r}  pre_sale={dv!r}")
    if len(mismatches) > 30:
        print(f"    ... and {len(mismatches) - 30} more difference(s)")


if __name__ == "__main__":
    main()
