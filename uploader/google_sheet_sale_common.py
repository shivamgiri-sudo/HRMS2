"""
Shared logic for pulling Housing Premium's "Sale raw" Google Sheet into
db_masmis.pre_sale. Used by both backfill_google_sheet_sale.py (one-off,
date-ranged) and sync_google_sheet_sale.py (recurring, checkpoint-based).

Sheet: https://docs.google.com/spreadsheets/d/1FHYkToVy9rrW8mmMMzwMzw62U5MZwBymIsfzQLPw_3Y
Tab:   "Sale raw"

Real header row (confirmed live 2026-09-27):
    Order_ID, coupon_code, Amount, Created_At, Partner_Name, Agent_Name,
    TL_Name, Time, Assign_TL, Order_Value, Target, Slots, Count,
    Coupon Code, Date, Week, TL Name
The LAST column, "TL Name", is a broken sheet formula -- every sampled row
shows literal "#REF!" in it. The real TL data lives in "TL_Name" (7th
column). Columns are looked up by exact header name below, not by fuzzy
alias matching like pre-sale-bulk.service.ts's getByColumn() does, because
that kind of matching would silently pick whichever of "TL_Name"/"TL Name"
comes last and get the broken one -- picking the exact real header instead
avoids that ambiguity entirely.

Column mapping to db_masmis.pre_sale (confirmed live against SHOW CREATE TABLE
and against pre-sale-bulk.service.ts, the existing manual-upload importer for
this same table):
    Order_ID     -> order_id       (kept as the exact digit string the sheet
                    shows; fetched with valueRenderOption=FORMATTED_VALUE
                    specifically so large IDs never come back as a Python
                    float/scientific-notation value -- confirmed live that
                    EVERY existing pre_sale row's order_id is already
                    corrupted this way, e.g. "9.03516E+11" where the sheet's
                    real value is "903516430672"; this pipeline must not
                    repeat that.)
    Date         -> report_date    ("23-Sep-26" -> "2026-09-23"; pre_sale's
                    own confirmed-live format is "YYYY-MM-DD" text, NOT
                    Pre_cdr's "M/D/YY" -- do not confuse the two tables.)
    Created_At   -> created_date   ("9/1/2026 0:00:00" -> "2026-09-01",
                    date part only, matching parseDate()'s own M/D/YYYY
                    handling in pre-sale-bulk.service.ts.)
    Agent_Name   -> agent_name
    TL_Name      -> tl_name        (NOT the broken trailing "TL Name" column)
    Partner_Name -> partner_name
    Amount       -> amount         (blank/unparseable -> 0, matching
                    parseAmount()'s own "blank means zero" rule)
    Order_Value  -> order_value    (blank/unparseable -> NULL)
    Target       -> target         (blank/unparseable -> NULL)
    Week         -> week
    month/day/am -> left NULL: the sheet has no such columns of its own (the
                    existing 1,351 pre_sale rows all carry NULL here too --
                    this is pre-existing behaviour, not something this
                    pipeline is introducing.)
coupon_code/Time/Assign_TL/Slots/Count/"Coupon Code" have no pre_sale column
and are intentionally not imported.
"""
from __future__ import annotations

import re
import sys
import uuid
from pathlib import Path
from typing import Any

from google.oauth2 import service_account
from googleapiclient.discovery import build

sys.path.insert(0, str(Path(__file__).parent))
from upload_housing_premium_cdr import connect, load_db_config  # noqa: E402

HERE = Path(__file__).parent
SHEET_ID = "1FHYkToVy9rrW8mmMMzwMzw62U5MZwBymIsfzQLPw_3Y"
SHEET_TAB = "Sale raw"
SERVICE_ACCOUNT_FILE = HERE / "google_service_account.json"

REQUIRED_COLUMNS = [
    "Order_ID", "Amount", "Created_At", "Partner_Name", "Agent_Name",
    "TL_Name", "Order_Value", "Target", "Week", "Date",
]

MONTH_ABBR = {
    "jan": "01", "feb": "02", "mar": "03", "apr": "04", "may": "05", "jun": "06",
    "jul": "07", "aug": "08", "sep": "09", "oct": "10", "nov": "11", "dec": "12",
}


def sheets_service():
    if not SERVICE_ACCOUNT_FILE.exists():
        sys.exit(f"Missing {SERVICE_ACCOUNT_FILE} -- see README.md for how to create it.")
    creds = service_account.Credentials.from_service_account_file(
        str(SERVICE_ACCOUNT_FILE),
        scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"],
    )
    return build("sheets", "v4", credentials=creds)


def fetch_all_rows(svc) -> list[list[str]]:
    """Returns every row INCLUDING the header (row 0)."""
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


def parse_sheet_date(raw: str) -> str | None:
    """'23-Sep-26' -> '2026-09-23'. Returns None (never guessed) if unrecognised."""
    m = re.match(r"^(\d{1,2})-([A-Za-z]{3})-(\d{2}|\d{4})$", raw)
    if not m:
        return None
    day, mon, yr = m.groups()
    month_num = MONTH_ABBR.get(mon.lower())
    if not month_num:
        return None
    year = f"20{yr}" if len(yr) == 2 else yr
    return f"{year}-{month_num}-{int(day):02d}"


def parse_created_at(raw: str) -> str | None:
    """'9/1/2026 0:00:00' -> '2026-09-01' (date part only)."""
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})", raw)
    if not m:
        return None
    mo, da, yr = m.groups()
    return f"{yr}-{int(mo):02d}-{int(da):02d}"


def to_num(raw: str) -> float | None:
    v = raw.replace(",", "").strip()
    if not v:
        return None
    try:
        return float(v)
    except ValueError:
        return None


def convert_row(row: list[str], idx: dict[str, int]) -> tuple[dict[str, Any] | None, str | None]:
    """Returns (pre_sale row dict, None) or (None, skip reason)."""
    order_id = cell(row, idx, "Order_ID")
    if not order_id:
        return None, "blank Order_ID"
    report_date = parse_sheet_date(cell(row, idx, "Date"))
    return {
        "order_id": order_id,
        "report_date": report_date,
        "created_date": parse_created_at(cell(row, idx, "Created_At")),
        "agent_name": cell(row, idx, "Agent_Name") or None,
        "tl_name": cell(row, idx, "TL_Name") or None,
        "partner_name": cell(row, idx, "Partner_Name") or None,
        "amount": to_num(cell(row, idx, "Amount")) or 0.0,
        "order_value": to_num(cell(row, idx, "Order_Value")),
        "target": to_num(cell(row, idx, "Target")),
        "week": cell(row, idx, "Week") or None,
    }, None


INSERT_SQL = """
INSERT INTO db_masmis.pre_sale
    (order_id, report_date, created_date, agent_name, tl_name, partner_name,
     amount, order_value, target, week, month, day, am, uploaded_by, upload_batch_id)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NULL, NULL, NULL, NULL, %s)
"""


def filter_already_inserted(sale_rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[str]]:
    """Drops any row whose order_id is already in pre_sale.

    Belt-and-braces on top of the row-position checkpoint in
    sync_google_sheet_sale.py: catches a deleted/reset checkpoint file, a
    manual re-run, or two runs overlapping -- any of which would otherwise
    re-insert the same order. Reliable specifically for rows THIS pipeline
    put there, since it always writes order_id as the clean digit string;
    the pre-existing (corrupted, scientific-notation) rows never collide
    with a real order_id and are irrelevant to this check.
    """
    if not sale_rows:
        return [], []
    order_ids = [r["order_id"] for r in sale_rows]
    cfg = load_db_config()
    conn = connect(cfg)
    try:
        with conn.cursor() as cur:
            placeholders = ",".join(["%s"] * len(order_ids))
            cur.execute(f"SELECT order_id FROM db_masmis.pre_sale WHERE order_id IN ({placeholders})", order_ids)
            existing = {row[0] for row in cur.fetchall()}
    finally:
        conn.close()
    new_rows = [r for r in sale_rows if r["order_id"] not in existing]
    duplicates = [r["order_id"] for r in sale_rows if r["order_id"] in existing]
    return new_rows, duplicates


def insert_rows(sale_rows: list[dict[str, Any]], label: str) -> str:
    """Inserts all rows in one batch, tagged with a fresh batch id. Returns the batch id."""
    if not sale_rows:
        return ""
    batch_id = str(uuid.uuid4())
    cfg = load_db_config()
    conn = connect(cfg)
    try:
        with conn.cursor() as cur:
            cur.executemany(INSERT_SQL, [
                (r["order_id"], r["report_date"], r["created_date"], r["agent_name"],
                 r["tl_name"], r["partner_name"], r["amount"], r["order_value"],
                 r["target"], r["week"], batch_id)
                for r in sale_rows
            ])
            cur.execute(
                "INSERT INTO db_masmis.upload_log (batch_id, table_name, file_name, row_count, uploaded_by) "
                "VALUES (%s, 'pre_sale', %s, %s, NULL)",
                (batch_id, label, len(sale_rows)),
            )
        conn.commit()
    finally:
        conn.close()
    return batch_id
