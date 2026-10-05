"""Bellavita Sale (db_masmis.bb_sale) check-and-upsert.

For each row's Bella Vita Order ID: INSERT if the order id doesn't exist yet
in bb_sale; if it already exists, UPDATE only calling_status and
current_status on every existing row for that order id (every other column,
and any pre-existing duplicate rows, are left untouched).

Column mapping/date parsing ports bb-sale-masmis-bulk.service.ts's own
parseBellavitaDateOnly/parseBellavitaDateTime, so a row inserted here is
identical to one a browser upload through the app would produce.
"""
import math
import os
import pandas as pd

from .dates import parse_bellavita_date_only, parse_bellavita_date_time
from .staging import new_batch_id, write_upload_batch, write_staged_rows

UPLOAD_TYPE_CODE = "BB_SALE_MASMIS"


def _get(row: dict, key: str) -> str:
    v = row.get(key)
    if v is None:
        return ""
    if isinstance(v, float) and math.isnan(v):
        return ""
    return str(v).strip()


def _nullable_float(v: str):
    try:
        return float(v)
    except (ValueError, TypeError):
        return None


def _nullable_int(v: str):
    try:
        return int(float(v))
    except (ValueError, TypeError):
        return None


def run_sale_upload(conn, file_path: str, execute: bool, skip_updates: bool = False) -> dict:
    df = pd.read_excel(file_path, sheet_name=0)
    rows = df.to_dict(orient="records")
    print(f"[sale] Read {len(rows)} rows from {file_path}")

    order_ids = list({_get(r, "Bella Vita Order ID") for r in rows if _get(r, "Bella Vita Order ID")})
    existing: set[str] = set()
    with conn.cursor() as cur:
        CHUNK = 500
        for i in range(0, len(order_ids), CHUNK):
            chunk = order_ids[i:i + CHUNK]
            placeholders = ",".join(["%s"] * len(chunk))
            cur.execute(
                f"SELECT DISTINCT bella_vita_order_id FROM db_masmis.bb_sale WHERE bella_vita_order_id IN ({placeholders})",
                chunk,
            )
            for r in cur.fetchall():
                existing.add(r["bella_vita_order_id"])

    to_insert = []  # (row_no, record)
    to_update = []
    no_order_id = 0
    for row_no, r in enumerate(rows, start=2):  # row 2 = first data row
        order_id = _get(r, "Bella Vita Order ID")
        if not order_id:
            no_order_id += 1
            continue
        if order_id in existing:
            to_update.append({"order_id": order_id, "calling_status": _get(r, "Calling Status"), "current_status": _get(r, "Current Status")})
        else:
            to_insert.append((row_no, r))
    print(f"[sale] New order ids to INSERT: {len(to_insert)}")
    print(f"[sale] Existing order ids to UPDATE (calling_status/current_status only): {len(to_update)}")
    if no_order_id:
        print(f"[sale] Rows with no Bella Vita Order ID (skipped entirely): {no_order_id}")

    if not execute:
        print("[sale] DRY RUN -- no writes made.")
        return {"total_rows": len(rows), "new_order_ids": len(to_insert), "existing_order_ids": len(to_update), "inserted": 0, "insert_errors": 0, "updated_rows": 0}

    inserted = 0
    insert_errors = 0
    staged: list[tuple[int, dict, str, str | None]] = []
    batch_id = new_batch_id()
    insert_sql = """
        INSERT INTO db_masmis.bb_sale
           (week, Date, emp_id, emp_name, tl, t1, t2, FHD, days,
            phone_number, email_id, payment_status, amount, bella_vita_order_id,
            campaign, calling_status, discount_code, sale_count,
            current_status, final_status, Order_DateTime, state, line_item_name,
            pincode, `Order Date`, hrs_24_48, crazy_deal, perfume, size,
            order_pickup_datetime, rto_initiated_datetime, diff_hour,
            lob, pincode_relevent, rto_status, draft_order, time_1608,
            sale_source_name, shift, uploaded_by, upload_batch_id)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
    """
    with conn.cursor() as cur:
        for row_no, r in to_insert:
            order_id = _get(r, "Bella Vita Order ID")
            sale_date = parse_bellavita_date_only(r.get("Date"))
            if not sale_date:
                print(f"[sale] Skipping insert for {order_id}: unparseable Date")
                insert_errors += 1
                staged.append((row_no, r, "error", f'Row {row_no}: "Date" is unparseable'))
                continue
            try:
                cur.execute(insert_sql, [
                    _get(r, "Week"), sale_date, _get(r, "EMP ID"), _get(r, "Emp_Name"), _get(r, "TL"), _get(r, "T1"), _get(r, "T2"),
                    parse_bellavita_date_only(r.get("FHD")), _nullable_int(_get(r, "Days")),
                    _get(r, "Phone Number"), _get(r, "E-mail ID"), _get(r, "Payment Status"), _nullable_float(_get(r, "Amount")),
                    order_id, _get(r, "Campaign"), _get(r, "Calling Status"), _get(r, "Discount Code"), _nullable_int(_get(r, "Count")),
                    _get(r, "Current Status"), _get(r, "Final Status"),
                    parse_bellavita_date_time(r.get("Order Date&Time")) or parse_bellavita_date_time(r.get("Order Date")),
                    _get(r, "State"), _get(r, "Line Item Name"), _get(r, "Pincode"), parse_bellavita_date_only(r.get("Order Date")),
                    _get(r, "24Hrs&48hrs"), _get(r, "Crazy Deal"), _get(r, "Perfume"), _get(r, "Size"),
                    parse_bellavita_date_time(r.get("Order Pickup Date")), parse_bellavita_date_time(r.get("RTO Initiated Date")),
                    _nullable_int(_get(r, "Diff Hour")), _get(r, "LOB"), _get(r, "Pincode Relevent"), _get(r, "RTO Status"),
                    _get(r, "Draft Order"), _get(r, "16:08") or _get(r, "Time 1608"), _get(r, "Sale Source Name"), _get(r, "Shift"), None, batch_id,
                ])
                inserted += 1
                staged.append((row_no, r, "imported", None))
            except Exception as e:  # noqa: BLE001 -- report and keep going, same as the other rows
                print(f"[sale] Insert failed for {order_id}: {e}")
                insert_errors += 1
                staged.append((row_no, r, "error", str(e)))

    updated = 0
    if skip_updates:
        print(f"[sale] Skipping the {len(to_update)} calling_status/current_status updates (skip_updates=True).")
    else:
        with conn.cursor() as cur:
            for u in to_update:
                cur.execute(
                    "UPDATE db_masmis.bb_sale SET calling_status = %s, current_status = %s WHERE bella_vita_order_id = %s",
                    [u["calling_status"], u["current_status"], u["order_id"]],
                )
                updated += cur.rowcount

    batch_no = write_upload_batch(
        conn, batch_id=batch_id, upload_type_code=UPLOAD_TYPE_CODE, file_name=os.path.basename(file_path),
        file_size_bytes=os.path.getsize(file_path) if os.path.exists(file_path) else 0,
        total_rows=len(rows), valid_rows=len(to_insert), imported_rows=inserted,
        batch_status="imported" if insert_errors == 0 else ("imported_with_errors" if inserted > 0 else "validation_failed"),
    )
    write_staged_rows(conn, batch_id, staged)
    print(f"[sale] Recorded upload_batch {batch_no} ({batch_id}) -- shows in the Uploader page's Recent Uploads.")

    if inserted > 0:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO db_masmis.upload_log (batch_id, table_name, file_name, row_count, uploaded_by) VALUES (%s, 'bb_sale', %s, %s, NULL)",
                [batch_id, file_path, inserted],
            )

    print(f"[sale] Done. Inserted {inserted} ({insert_errors} errors). Updated {updated} rows across {len(to_update)} order ids.")
    return {"total_rows": len(rows), "new_order_ids": len(to_insert), "existing_order_ids": len(to_update), "inserted": inserted, "insert_errors": insert_errors, "updated_rows": updated}
