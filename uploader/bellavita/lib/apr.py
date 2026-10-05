"""Bellavita APR (db_masmis.bb_apr) check-and-insert.

bb_apr has no natural upsert key the way bb_sale/bb_chat/bb_cart do (an agent
can legitimately have more than one row per day in source data), so this only
ever inserts and warns if any row's report_date is <= the table's current max
report_date -- i.e. it assumes each APR file is a pure forward extension, the
same shape "APR after 24.xlsx" was. Review the warning before running with
execute=True if a file might overlap.

Column mapping matches bb-apr-masmis-bulk.service.ts's importBbAprMasmisBatch,
storing duration columns as raw decimal-fraction text (the table's existing
convention) rather than converting them to seconds.
"""
import math
import os
import pandas as pd

from .dates import excel_serial_to_iso
from .staging import new_batch_id, write_upload_batch, write_staged_rows

UPLOAD_TYPE_CODE = "BB_APR_MASMIS"


def _get(row: dict, key: str) -> str:
    v = row.get(key)
    if v is None:
        return ""
    if isinstance(v, float) and math.isnan(v):
        return ""
    return str(v).strip()


def _or_none(row: dict, key: str):
    v = _get(row, key)
    return v or None


def _nullable_int(v: str):
    try:
        return int(float(v.replace(",", "")))
    except (ValueError, TypeError):
        return None


def run_apr_upload(conn, file_path: str, execute: bool) -> dict:
    df = pd.read_excel(file_path, sheet_name=0)
    rows = df.to_dict(orient="records")
    print(f"[apr] Read {len(rows)} rows from {file_path}")

    with conn.cursor() as cur:
        cur.execute("SELECT MAX(report_date) AS mx FROM db_masmis.bb_apr")
        max_date = cur.fetchone()["mx"]
    print(f"[apr] Current bb_apr max report_date: {max_date}")

    prepared = []
    for row_no, r in enumerate(rows, start=2):  # row 2 = first data row
        report_date = excel_serial_to_iso(r.get("Date")) or (r.get("Date") if isinstance(r.get("Date"), str) else None)
        emp_name = _get(r, "Emp_Name")
        prepared.append({"row_no": row_no, "r": r, "report_date": report_date, "emp_name": emp_name})
    good = [p for p in prepared if p["report_date"] and p["emp_name"]]
    bad = [p for p in prepared if not (p["report_date"] and p["emp_name"])]
    print(f"[apr] Rows with a valid report_date + emp_name: {len(good)} (skipped: {len(prepared) - len(good)})")

    max_date_str = str(max_date) if max_date else ""
    overlapping = [p for p in good if p["report_date"] <= max_date_str]
    if overlapping:
        print(f"[apr] WARNING: {len(overlapping)} rows have report_date <= current max ({max_date}) -- "
              f"bb_apr has no unique constraint, so this WILL create duplicate rows. Review before proceeding.")

    if not execute:
        print("[apr] DRY RUN -- no writes made.")
        return {"total_rows": len(rows), "valid_rows": len(good), "overlapping": len(overlapping), "inserted": 0, "errors": 0}

    insert_sql = """
        INSERT INTO db_masmis.bb_apr
           (unique_id, week, report_date, emp_name, noiid, num_calls_chat, lob, login_time,
            wait_time, talk_time, dispo_time, pause_time, acht, lunch, tea, tea1, washr,
            team_briefing_aux, net_pause, avg_dispo, total_break, actual_login_hrs, downtime,
            login_duration, logout_time, net_login_hrs, utilization, attendance_1, week_1, mtd,
            team_leader, fhd, tenure, tenurity_week, sub_lob, unique_count, attendance_2,
            capping, attendance_3, uploaded_by, upload_batch_id)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
    """
    inserted = 0
    errors = 0
    staged: list[tuple[int, dict, str, str | None]] = [
        (p["row_no"], p["r"], "error", f'Row {p["row_no"]}: "emp_name" and "report_date" are both required') for p in bad
    ]
    batch_id = new_batch_id()
    with conn.cursor() as cur:
        for p in good:
            r, report_date, emp_name = p["r"], p["report_date"], p["emp_name"]
            try:
                cur.execute(insert_sql, [
                    _or_none(r, "Unique ID"), _or_none(r, "Week"), report_date, emp_name, _or_none(r, "NOIID"),
                    _nullable_int(_get(r, "No. of Calls/Chat")), _or_none(r, "LOB"),
                    _or_none(r, "Login Time"), _or_none(r, "WAIT"), _or_none(r, "TALK"), _or_none(r, "DISPO"), _or_none(r, "PAUSE"),
                    _nullable_int(_get(r, "ACHT")), _or_none(r, "Lunch"), _or_none(r, "Tea"), _or_none(r, "Tea1"), _or_none(r, "Washr"),
                    _or_none(r, "Team Briefing AUX"), None, _or_none(r, "Avg Dispo"), _or_none(r, "Total Break"),
                    _or_none(r, "Actual Login Hrs"), _or_none(r, "Downtime"), _or_none(r, "Login"), _or_none(r, "Logout"),
                    _or_none(r, "Net Login Hrs+DN+Briefing"), _or_none(r, "Utilization"), _or_none(r, "Attendance"),
                    _or_none(r, "Week 1"), _or_none(r, "MTD"), _or_none(r, "Team Leader"), _or_none(r, "FHD"),
                    _nullable_int(_get(r, "Tenure")), _or_none(r, "Tenurity Week"), _or_none(r, "Sub Lob"),
                    _nullable_int(_get(r, "Unique Count")), _or_none(r, "Attendence 2"), _or_none(r, "Capping"),
                    _or_none(r, "Attendance_1"), None, batch_id,
                ])
                inserted += 1
                staged.append((p["row_no"], r, "imported", None))
            except Exception as e:  # noqa: BLE001
                print(f"[apr] Insert failed for {emp_name} / {report_date}: {e}")
                errors += 1
                staged.append((p["row_no"], r, "error", str(e)))

    batch_no = write_upload_batch(
        conn, batch_id=batch_id, upload_type_code=UPLOAD_TYPE_CODE, file_name=os.path.basename(file_path),
        file_size_bytes=os.path.getsize(file_path) if os.path.exists(file_path) else 0,
        total_rows=len(rows), valid_rows=len(good), imported_rows=inserted,
        batch_status="imported" if errors == 0 else ("imported_with_errors" if inserted > 0 else "validation_failed"),
    )
    write_staged_rows(conn, batch_id, staged)
    print(f"[apr] Recorded upload_batch {batch_no} ({batch_id}) -- shows in the Uploader page's Recent Uploads.")

    if inserted > 0:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO db_masmis.upload_log (batch_id, table_name, file_name, row_count, uploaded_by) VALUES (%s, 'bb_apr', %s, %s, NULL)",
                [batch_id, file_path, inserted],
            )

    print(f"[apr] Done. Inserted {inserted} rows ({errors} errors).")
    return {"total_rows": len(rows), "valid_rows": len(good), "overlapping": len(overlapping), "inserted": inserted, "errors": errors}
