"""Bellavita Cart (db_masmis.bb_cart) check-and-insert.

For each row's Cart ID ("ID" column): dedupe within the file (keep the last
occurrence), then insert only the ones not already in bb_cart. Never updates
existing rows -- unlike bb_sale, cart rows don't have an obvious "status that
changes after upload" field.

Column mapping matches bb-cart-masmis-bulk.service.ts's importBbCartMasmisBatch,
with one addition: Created At/Updated At/Dates/Call Date are converted from
raw Excel serials (or a datetime, if pandas/openpyxl already converted the
cell) to "D-Mon-YY" text, matching the table's existing live convention.
"""
import math
import os
import pandas as pd

from .dates import to_d_mon_yy
from .staging import new_batch_id, write_upload_batch, write_staged_rows

UPLOAD_TYPE_CODE = "BB_CART_MASMIS"


def _get(row: dict, *keys: str) -> str:
    for k in keys:
        v = row.get(k)
        if v is None:
            continue
        if isinstance(v, float) and math.isnan(v):
            continue
        s = str(v).strip()
        if s:
            return s
    return ""


def _nullable_int(v: str):
    try:
        return int(float(v))
    except (ValueError, TypeError):
        return None


def _nullable_decimal(v: str):
    try:
        return float(v)
    except (ValueError, TypeError):
        return None


def run_cart_upload(conn, file_path: str, execute: bool) -> dict:
    df = pd.read_excel(file_path, sheet_name=0)
    rows = df.to_dict(orient="records")
    print(f"[cart] Read {len(rows)} rows from {file_path}")

    all_rows = [{"row_no": i + 2, "r": r, "cart_id": _get(r, "ID", "Cart ID", "cart_id")} for i, r in enumerate(rows)]
    with_id = [x for x in all_rows if x["cart_id"]]
    missing_id = [x for x in all_rows if not x["cart_id"]]
    print(f"[cart] Rows with a Cart ID: {len(with_id)} (missing: {len(missing_id)})")
    by_id: dict[str, dict] = {}
    for x in with_id:
        by_id[x["cart_id"]] = x
    deduped = list(by_id.values())
    print(f"[cart] Distinct Cart IDs in file: {len(deduped)} (dupes within file: {len(with_id) - len(deduped)})")

    id_arr = [x["cart_id"] for x in deduped]
    existing: set[str] = set()
    with conn.cursor() as cur:
        CHUNK = 500
        for i in range(0, len(id_arr), CHUNK):
            chunk = id_arr[i:i + CHUNK]
            placeholders = ",".join(["%s"] * len(chunk))
            cur.execute(f"SELECT DISTINCT cart_id FROM db_masmis.bb_cart WHERE cart_id IN ({placeholders})", chunk)
            for r in cur.fetchall():
                existing.add(r["cart_id"])
    print(f"[cart] Of file's distinct Cart IDs, already in bb_cart: {len(existing)}")
    new_rows = [x for x in deduped if x["cart_id"] not in existing]
    print(f"[cart] NEW (not yet imported): {len(new_rows)}")

    if not execute:
        print("[cart] DRY RUN -- no writes made.")
        return {"total_rows": len(rows), "distinct_in_file": len(deduped), "already_in_db": len(existing), "inserted": 0, "errors": 0}

    insert_sql = """
        INSERT INTO db_masmis.bb_cart
           (cc, source, sno, cart_id, created_at, updated_at, customer_name, customer_address,
            phone_number, email_id, line_items, variant_title, abandoned_cart_link, amount,
            phone_10_digit, dates, agent, disposition, sub_disposition, call_date,
            same_day_connect, status, uploaded_by, upload_batch_id)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
    """
    inserted = 0
    errors = 0
    staged: list[tuple[int, dict, str, str | None]] = [
        (x["row_no"], x["r"], "error", f'Row {x["row_no"]}: "Cart ID" is required') for x in missing_id
    ]
    batch_id = new_batch_id()
    with conn.cursor() as cur:
        for x in new_rows:
            r, cart_id = x["r"], x["cart_id"]
            try:
                cur.execute(insert_sql, [
                    _get(r, "CC.", "CC", "cc") or None,
                    _get(r, "Source") or None,
                    _nullable_int(_get(r, "S.no", "SNo")),
                    cart_id,
                    to_d_mon_yy(r.get("Created At")),
                    to_d_mon_yy(r.get("Updated At")),
                    _get(r, "Customer Name") or None,
                    _get(r, "Customer Address") or None,
                    _get(r, "Phone Number") or None,
                    _get(r, "Email ID") or None,
                    _get(r, "Line items", "Line Items") or None,
                    _get(r, "Variant title", "Variant Title") or None,
                    _get(r, "Abandoned Cart Link") or None,
                    _nullable_decimal(_get(r, "Amount")),
                    _get(r, "Phone Number (10 Digit)", "Phone (10 Digit)") or None,
                    to_d_mon_yy(r.get("Dates")),
                    _get(r, "Agent") or None,
                    _get(r, "Disposition") or None,
                    _get(r, "Sub Dispotion", "Sub Disposition") or None,
                    to_d_mon_yy(r.get("Call Date")),
                    _get(r, "Same Day Connect") or None,
                    _get(r, "Status") or None,
                    None, batch_id,
                ])
                inserted += 1
                staged.append((x["row_no"], r, "imported", None))
            except Exception as e:  # noqa: BLE001
                print(f"[cart] Insert failed for cart_id {cart_id}: {e}")
                errors += 1
                staged.append((x["row_no"], r, "error", str(e)))

    batch_no = write_upload_batch(
        conn, batch_id=batch_id, upload_type_code=UPLOAD_TYPE_CODE, file_name=os.path.basename(file_path),
        file_size_bytes=os.path.getsize(file_path) if os.path.exists(file_path) else 0,
        total_rows=len(rows), valid_rows=len(new_rows), imported_rows=inserted,
        batch_status="imported" if errors == 0 else ("imported_with_errors" if inserted > 0 else "validation_failed"),
    )
    write_staged_rows(conn, batch_id, staged)
    print(f"[cart] Recorded upload_batch {batch_no} ({batch_id}) -- shows in the Uploader page's Recent Uploads.")

    if inserted > 0:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO db_masmis.upload_log (batch_id, table_name, file_name, row_count, uploaded_by) VALUES (%s, 'bb_cart', %s, %s, NULL)",
                [batch_id, file_path, inserted],
            )

    print(f"[cart] Done. Inserted {inserted} rows ({errors} errors).")
    return {"total_rows": len(rows), "distinct_in_file": len(deduped), "already_in_db": len(existing), "inserted": inserted, "errors": errors}
