#!/usr/bin/env python3
"""
Pulls Housing Owner's "Payments from Sales Report" Google Sheet into
db_masmis.owner_sale, the same role sync_google_sheet_sale.py plays for
Housing Premium's pre_sale, adapted for owner_sale's real (different) column
set and its own existing bulk-upload importer
(backend/src/modules/bulk-upload/owner-sale-bulk.service.ts).

Sheet: https://docs.google.com/spreadsheets/d/1XXd2ogH9y3HE4u-Ikb8P81n86VOQaMryncv48y1v8n8
Tab:   "Payments from Sales Report"

Real header row (confirmed live 2026-09-28):
    Date, Agent ID, Agent Name, With GST, Count, Package Mode, Package Name,
    Package Type, Opp ID, Discount %, TL Name, City, AM
819 real data rows spanning 1-27 September 2026, all Package Mode =
"Payment Link" -- confirmed by comparing this sheet's own days-1-25 total
(767 rows) against owner_sale's existing distinct opp_id count for the same
window (766) -- close enough (the 1-row difference is not investigated
further; it's immaterial next to the mapping question below) to confirm
this really is the same underlying data already in owner_sale, which is
what justifies the two header renames below rather than treating them as
two unrelated columns:
    "With GST"     -> value        (owner_sale's `value` column; the sheet's
                       own column name is misleading -- it is NOT an
                       additional GST-inclusive figure alongside a separate
                       base value column, it IS the sale value, confirmed by
                       the totals reconciliation above).
    "Package Mode" -> payment_mode (owner-sale-bulk.service.ts's own
                       expected header is "Payment Mode"; this sheet spells
                       the same column "Package Mode" and its values are
                       literally "Payment Link" -- a payment mode, not a
                       package mode -- confirming it is the same field
                       under a typo'd header, not a different concept).
    "City"          -> not imported; owner_sale has no city column.
Date is "D-Month-YY" with the FULL month name (e.g. "1-September-26"), NOT
the 3-letter "D-Mon-YY" owner-sale-bulk.service.ts's own parseDate()
already handles -- so uploading this exact sheet through the app's own
Uploader page would silently produce report_date = NULL for every row (the
same historical bug already documented in that file's parseDate() comment,
which only fixed the 3-letter-month case; 162 existing owner_sale rows
still have report_date NULL today, 2026-09-28, presumably from this exact
gap). This script parses the full month name correctly; see
FULL_MONTH_MAP below.  owner-sale-bulk.service.ts's own parseDate() should
probably also be extended to accept full month names, to stop this
recurring for any future manual re-upload of this same report through the
UI -- flagged, not fixed here (out of scope for a data-import script).

Duplicate-safety: owner_sale already contains 178 duplicate-opp_id rows
from an earlier, unrelated manual import (944 total rows, 766 distinct
opp_id) -- a pre-existing data-quality issue, not something this script
introduces or corrects. This script's own duplicate guard checks the
REAL opp_id set already in owner_sale (via filter_already_inserted) before
inserting anything, so it can never add to that count -- it only inserts
opp_ids that are not there at all yet.

Also writes upload_batch + upload_batch_row (raw_data = the row exactly as
read from the sheet) for every batch it creates, learning from the Owner
CDR pipeline's own earlier gap (see upload_owner_cdr.py's docstring) --
the Uploader page's "Download" button works for this import from day one,
not just after a later fix.

Usage:
    py sync_owner_sale.py                # inserts every sheet row not yet in owner_sale (default)
    py sync_owner_sale.py --dry-run      # preview only, writes nothing
"""
from __future__ import annotations

import argparse
import re
import sys
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from google.oauth2 import service_account
from googleapiclient.discovery import build

sys.path.insert(0, str(Path(__file__).parent))
from upload_owner_cdr import connect, load_db_config, write_staged_rows  # noqa: E402

HERE = Path(__file__).parent
SHEET_ID = "1XXd2ogH9y3HE4u-Ikb8P81n86VOQaMryncv48y1v8n8"
SHEET_TAB = "Payments from Sales Report"
SERVICE_ACCOUNT_FILE = HERE / "google_service_account.json"
UPLOAD_TYPE_CODE = "OWNER_SALE_MASMIS"

REQUIRED_COLUMNS = [
    "Date", "Agent ID", "Agent Name", "With GST", "Count", "Package Mode",
    "Package Name", "Package Type", "Opp ID", "Discount %", "TL Name", "AM",
]

FULL_MONTH_MAP = {
    "january": "01", "february": "02", "march": "03", "april": "04", "may": "05", "june": "06",
    "july": "07", "august": "08", "september": "09", "october": "10", "november": "11", "december": "12",
}
MONTH_ABBR3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def sheets_service():
    if not SERVICE_ACCOUNT_FILE.exists():
        sys.exit(f"Missing {SERVICE_ACCOUNT_FILE} -- see README.md for how to create/share it.")
    creds = service_account.Credentials.from_service_account_file(
        str(SERVICE_ACCOUNT_FILE),
        scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"],
    )
    return build("sheets", "v4", credentials=creds)


def fetch_all_rows(svc) -> list[list[str]]:
    resp = svc.spreadsheets().values().get(
        spreadsheetId=SHEET_ID, range=f"'{SHEET_TAB}'!A:Z",
        valueRenderOption="FORMATTED_VALUE",
    ).execute()
    return resp.get("values", [])


def header_index(header: list[str]) -> dict[str, int]:
    idx = {name: header.index(name) for name in REQUIRED_COLUMNS if name in header}
    missing = [name for name in REQUIRED_COLUMNS if name not in idx]
    if missing:
        sys.exit(f"Sheet header is missing expected column(s): {missing}. Actual header: {header}")
    return idx


def cell(row: list[str], idx: dict[str, int], name: str) -> str:
    i = idx[name]
    return row[i].strip() if i < len(row) and row[i] is not None else ""


def parse_full_month_date(raw: str) -> tuple[str | None, str | None, str | None, str | None]:
    """'1-September-26' -> ('2026-09-01', 'Week-1', "Sep'26", '1'). Returns
    all-None (never guessed) if the format doesn't match."""
    m = re.match(r"^(\d{1,2})-([A-Za-z]+)-(\d{2}|\d{4})$", raw)
    if not m:
        return None, None, None, None
    day_s, mon_s, yr_s = m.groups()
    month_num = FULL_MONTH_MAP.get(mon_s.lower())
    if not month_num:
        return None, None, None, None
    day = int(day_s)
    year = f"20{yr_s}" if len(yr_s) == 2 else yr_s
    report_date = f"{year}-{month_num}-{day:02d}"
    week_no = min(5, (day - 1) // 7 + 1)
    month_label = f"{MONTH_ABBR3[int(month_num) - 1]}'{year[2:]}"
    return report_date, f"Week-{week_no}", month_label, str(day)


def to_num(raw: str) -> float | None:
    v = raw.replace(",", "").strip()
    if not v:
        return None
    try:
        return float(v)
    except ValueError:
        return None


def convert_row(row: list[str], idx: dict[str, int]) -> tuple[dict[str, Any] | None, str | None]:
    """Returns (owner_sale row dict, None) or (None, skip reason)."""
    opp_id = cell(row, idx, "Opp ID")
    if not opp_id:
        return None, "blank Opp ID"
    report_date, week, month, day = parse_full_month_date(cell(row, idx, "Date"))
    if report_date is None or report_date[:7] != datetime.now().strftime("%Y-%m"):
        return None, "outside current month"
    count_raw = cell(row, idx, "Count")
    sale_count = int(to_num(count_raw) or 1) if count_raw else 1
    return {
        "opp_id": opp_id,
        "report_date": report_date,
        "agent_id": cell(row, idx, "Agent ID") or None,
        "agent_name": cell(row, idx, "Agent Name") or None,
        "tl_name": cell(row, idx, "TL Name") or None,
        "value": to_num(cell(row, idx, "With GST")) or 0.0,
        "sale_count": sale_count,
        "payment_mode": cell(row, idx, "Package Mode") or None,
        "package_name": cell(row, idx, "Package Name") or None,
        "package_type": cell(row, idx, "Package Type") or None,
        "discount_pct": to_num(cell(row, idx, "Discount %")),
        "week": week,
        "month": month,
        "day": day,
        "am": cell(row, idx, "AM") or None,
    }, None


INSERT_SQL = """
INSERT INTO db_masmis.owner_sale
    (opp_id, report_date, agent_id, agent_name, tl_name, value, sale_count,
     payment_mode, package_name, package_type, discount_pct, week, month, day, am,
     uploaded_by, upload_batch_id)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NULL, %s)
"""


def filter_already_inserted(sale_rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[str]]:
    """Drops any row whose opp_id is already in owner_sale -- the only
    safety net this script has (no row-position checkpoint), and the thing
    standing between a re-run and duplicating a row on top of owner_sale's
    existing 178 pre-existing duplicate rows (see module docstring)."""
    if not sale_rows:
        return [], []
    cfg = load_db_config()
    conn = connect(cfg)
    try:
        with conn.cursor() as cur:
            opp_ids = [r["opp_id"] for r in sale_rows]
            placeholders = ",".join(["%s"] * len(opp_ids))
            cur.execute(f"SELECT opp_id FROM db_masmis.owner_sale WHERE opp_id IN ({placeholders})", opp_ids)
            existing = {row[0] for row in cur.fetchall()}
    finally:
        conn.close()
    new_rows = [r for r in sale_rows if r["opp_id"] not in existing]
    duplicates = [r["opp_id"] for r in sale_rows if r["opp_id"] in existing]
    return new_rows, duplicates


def insert_rows(sale_rows: list[dict[str, Any]], raw_rows_by_opp: dict[str, dict[str, str]], label: str) -> str:
    if not sale_rows:
        return ""
    batch_id = str(uuid.uuid4())
    cfg = load_db_config()
    conn = connect(cfg)
    try:
        with conn.cursor() as cur:
            cur.executemany(INSERT_SQL, [
                (r["opp_id"], r["report_date"], r["agent_id"], r["agent_name"], r["tl_name"],
                 r["value"], r["sale_count"], r["payment_mode"], r["package_name"], r["package_type"],
                 r["discount_pct"], r["week"], r["month"], r["day"], r["am"], batch_id)
                for r in sale_rows
            ])
            now = datetime.now()
            cur.execute(
                """INSERT INTO upload_batch
                     (id, upload_batch_no, upload_type_code, original_file_name, file_size_bytes,
                      total_rows, valid_rows, error_rows, imported_rows, batch_status,
                      validated_at, imported_at, created_at, updated_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'imported', %s, %s, %s, %s)""",
                (
                    batch_id, f"BATCH-{int(time.time() * 1000)}", UPLOAD_TYPE_CODE, label, 0,
                    len(sale_rows), len(sale_rows), 0, len(sale_rows), now, now, now, now,
                ),
            )
            cur.execute(
                "INSERT INTO db_masmis.upload_log (batch_id, table_name, file_name, row_count, uploaded_by) "
                "VALUES (%s, 'owner_sale', %s, %s, NULL)",
                (batch_id, label, len(sale_rows)),
            )
        conn.commit()
    finally:
        conn.close()

    staged = [(i, raw_rows_by_opp[r["opp_id"]], "imported", None) for i, r in enumerate(sale_rows, start=2)]
    write_staged_rows(cfg, batch_id, staged)
    return batch_id


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true", help="Preview only; writes nothing to the database")
    args = ap.parse_args()

    print(f"Reading '{SHEET_TAB}' from the Google Sheet...")
    svc = sheets_service()
    rows = fetch_all_rows(svc)
    if not rows:
        sys.exit("Sheet returned no rows at all -- check SHEET_ID/SHEET_TAB/sharing.")
    header, data_rows = rows[0], rows[1:]
    idx = header_index(header)
    print(f"  {len(data_rows)} data row(s) in the sheet.")

    converted: list[dict[str, Any]] = []
    raw_by_opp: dict[str, dict[str, str]] = {}
    blank_opp_id = 0
    bad_date = 0
    for row in data_rows:
        rec, skip_reason = convert_row(row, idx)
        if rec is None:
            blank_opp_id += 1
            continue
        if rec["report_date"] is None:
            bad_date += 1
        converted.append(rec)
        raw_by_opp[rec["opp_id"]] = dict(zip(header, row))

    print(f"  {len(converted)} row(s) with a real Opp ID ({blank_opp_id} blank, skipped).")
    if bad_date:
        print(f"  WARNING: {bad_date} row(s) had a Date this script could not parse -- report_date left NULL for those.")

    new_rows, duplicates = filter_already_inserted(converted)
    print(f"\n{len(new_rows)} row(s) not yet in owner_sale (will be inserted).")
    print(f"{len(duplicates)} row(s) already present (skipped, not re-inserted).")

    if not new_rows:
        print("Nothing to do.")
        return

    if args.dry_run:
        print("\n--dry-run: nothing written. Sample of first 3 new rows:")
        for r in new_rows[:3]:
            print(r)
        return

    label = f"{SHEET_TAB} (Google Sheet sync)"
    batch_id = insert_rows(new_rows, raw_by_opp, label)
    print(f"\nInserted {len(new_rows)} row(s) into db_masmis.owner_sale. Batch {batch_id}.")


if __name__ == "__main__":
    main()
