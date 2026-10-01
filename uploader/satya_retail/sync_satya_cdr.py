#!/usr/bin/env python3
"""
Syncs Satya Retail's real call data from the dialer's own database
(dialer_db.data_master_in, ClientId=499) directly into db_masmis.satya_cdr --
replacing the manual "Satya CDR.xlsx" export/upload workflow entirely, since
the same data is already live in dialer_db the moment a call happens.

dialer_db is a shared upstream telephony database (Database Boundary Rule,
CLAUDE.md) -- read-only, never written back to. It's a generic multi-tenant
schema (Field1..Field50 with no fixed meaning), so the real per-client field
labels come from dialer_db.field_master_in_12 (ClientId=499's own row) and
were then cross-checked against real row *content*, not just trusted labels
-- e.g. Field5 was confirmed as "remarks" specifically because a real
Category2='Order Placed' row's Field5 read
"Order #GGN-1790658657829-8024", an exact format match to satya_cdr's own
historical remarks values, not just a plausible-sounding label.

Column mapping (confirmed live, 2026-09-29):
    scenario                <- Category1        ("Connected"/"Not Connected"/"Call Dropped")
    sub_scenario_1           <- Category2        ("Order Placed", "Call Back", "Busy", ...)
    amount                   <- Field1            (populated only on Order Placed rows)
    beat_name                <- Field2
    shop_name                <- Field3
    warehouse                <- Field4
    remarks                  <- Field5
    roster                   <- Field6            (see caveat below)
    call_date, report_date   <- CallDate
    call_created              <- callcreated       (exact string match, e.g. "DialDesk - MAS63494")
    agent_name                <- the "MAS#####" code parsed out of callcreated
    number_val, in_call_from  <- MSISDN

Two judgment calls made without a perfect source to confirm against (flagged
to the user, proceeding on best available evidence rather than blocking):
  - roster: satya_cdr's own historical values are shift-roster words like
    "Absentee"; data_master_in's Field6 instead holds "Morning" -- same
    structural slot (a per-call shift/session label) but different
    vocabulary. Mapped as-is; if this turns out to be a different concept,
    only this one column is affected.
  - call_id / uid are NOT unique per call in the historical data -- the
    same call_id and uid repeat across multiple attempts to the same lead
    (confirmed live: 3 real historical rows share call_id='272' and the
    same uid). uid is reproduced as <Excel-serial of CallDate><MSISDN>,
    the same convention Owner_cdr already uses, which naturally repeats for
    same-day attempts to the same number, matching the observed pattern.
    call_id (the one column the app's importer actually requires
    non-empty) uses data_master_in's own SrNo instead -- a real,
    client-scoped sequential row number already present in the source,
    not a fabricated value, but not proven identical to whatever numbering
    scheme the old manual uploads used either.

NOT present in data_master_in at all (left NULL, same as most of these
already are on the existing manually-uploaded rows, so this is not a
regression): call_action, call_sub_action, call_action_remarks,
closer_date, follow_up_date, case_close_by, tat, due_date, call_status,
connected, closer_time, attempt.

Two modes:
  --date YYYY-MM-DD   Backfill one specific day by direct CallDate filter --
                       for closing the known gap (31-Aug, 24/25/26/28/29-Sep,
                       all currently missing from satya_cdr entirely, so
                       there is no overlap/duplicate risk for these).
  (no --date)          Incremental sync using a saved checkpoint
                       (satya_dataid_checkpoint.json, dataId-based, mirroring
                       sync_google_sheet_sale.py's own checkpoint pattern) --
                       only pulls data_master_in rows newer than the last
                       run, safe to schedule daily. The checkpoint's
                       starting point is set once, explicitly, to the
                       dataId boundary at the end of 23-Sep-26 (the last
                       date already covered by the historical manual
                       uploads) so the first incremental run doesn't
                       re-import 1-23 Sep.

Usage:
    py sync_satya_cdr.py --date 2026-08-31           # backfill one specific day
    py sync_satya_cdr.py --dry-run                   # preview the incremental sync
    py sync_satya_cdr.py                              # real incremental sync
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import uuid
from datetime import date, datetime
from pathlib import Path
from typing import Any

from dotenv import dotenv_values
import pymysql

HERE = Path(__file__).parent
CHECKPOINT_FILE = HERE / "satya_dataid_checkpoint.json"
CLIENT_ID = 499
EXCEL_EPOCH = date(1899, 12, 30)

DB_COLUMNS = [
    "number_val", "in_call_from", "call_id", "scenario", "sub_scenario_1", "amount", "beat_name",
    "shop_name", "warehouse", "remarks", "roster", "call_date", "call_action", "call_sub_action",
    "call_action_remarks", "closer_date", "follow_up_date", "case_close_by", "tat", "due_date",
    "call_created", "call_status", "connected", "closer_time", "report_date", "attempt",
    "agent_name", "uid", "uploaded_by", "upload_batch_id",
]
INSERT_SQL = f"INSERT INTO db_masmis.satya_cdr ({', '.join(DB_COLUMNS)}) VALUES ({', '.join(['%s'] * len(DB_COLUMNS))})"

MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
AGENT_CODE_RE = re.compile(r"(MAS\d+)")


def load_db_config(prefix: str) -> dict[str, Any]:
    """prefix='' for mas_hrms (db.env), prefix='DIALER_' for dialer_db (dialer_db.env)."""
    env_file = "db.env" if not prefix else "dialer_db.env"
    env_path = HERE / env_file
    if not env_path.exists():
        sys.exit(f"Cannot find {env_path} -- credentials must come from this file, not be hardcoded.")
    env = dotenv_values(env_path)
    missing = [k for k in ("DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME") if not env.get(k)]
    if missing:
        sys.exit(f"{env_path} is missing: {', '.join(missing)}")
    return {
        "host": env["DB_HOST"], "port": int(env.get("DB_PORT", "3306")),
        "user": env["DB_USER"], "password": env["DB_PASSWORD"], "database": env["DB_NAME"],
        "charset": "utf8mb4", "connect_timeout": 20, "read_timeout": 120, "write_timeout": 120,
    }


def connect(cfg: dict[str, Any]) -> pymysql.connections.Connection:
    return pymysql.connect(**cfg)


def excel_serial(d: date) -> int:
    return (d - EXCEL_EPOCH).days


def fmt_datetime(dt: datetime) -> str:
    """'9/23/26 18:05' -- matches satya_cdr's own existing call_date/closer_date convention."""
    return f"{dt.month}/{dt.day}/{dt.year % 100} {dt.hour}:{dt.minute:02d}"


def fmt_report_date(dt: datetime) -> str:
    return f"{dt.day}-{MONTH_ABBR[dt.month - 1]}-{dt.year % 100}"


def parse_agent_code(callcreated: str | None) -> str | None:
    if not callcreated:
        return None
    m = AGENT_CODE_RE.search(callcreated)
    return m.group(1) if m else None


def convert_row(row: dict[str, Any], batch_id: str) -> list[Any]:
    call_date: datetime = row["CallDate"]
    msisdn = str(row["MSISDN"]) if row["MSISDN"] is not None else ""
    uid = f"{excel_serial(call_date.date())}{msisdn}" if call_date and msisdn else None
    call_created = row.get("callcreated")
    values: dict[str, Any] = {
        "number_val": msisdn or None,
        "in_call_from": msisdn or None,
        "call_id": str(row["SrNo"]) if row.get("SrNo") is not None else None,
        "scenario": row.get("Category1"),
        "sub_scenario_1": row.get("Category2"),
        "amount": row.get("Field1"),
        "beat_name": row.get("Field2"),
        "shop_name": row.get("Field3"),
        "warehouse": row.get("Field4"),
        "remarks": row.get("Field5"),
        "roster": row.get("Field6"),
        "call_date": fmt_datetime(call_date) if call_date else None,
        "call_action": None,
        "call_sub_action": None,
        "call_action_remarks": None,
        "closer_date": None,
        "follow_up_date": None,
        "case_close_by": None,
        "tat": None,
        "due_date": None,
        "call_created": call_created,
        "call_status": None,
        "connected": None,
        "closer_time": None,
        "report_date": fmt_report_date(call_date) if call_date else None,
        "attempt": None,
        "agent_name": parse_agent_code(call_created),
        "uid": uid,
        "uploaded_by": None,
        "upload_batch_id": batch_id,
    }
    return [values[c] for c in DB_COLUMNS]


def fetch_rows(dialer_conn, where_sql: str, params: list[Any]) -> list[dict[str, Any]]:
    with dialer_conn.cursor(pymysql.cursors.DictCursor) as cur:
        cur.execute(
            f"""SELECT dataId, SrNo, MSISDN, Category1, Category2, Field1, Field2, Field3, Field4,
                       Field5, Field6, CallDate, callcreated
                  FROM dialer_db.data_master_in
                 WHERE ClientId = %s AND {where_sql}
                 ORDER BY dataId""",
            [CLIENT_ID] + params,
        )
        return cur.fetchall()


def insert_rows(mas_conn, rows: list[dict[str, Any]], label: str) -> tuple[str, int]:
    if not rows:
        return "", 0
    batch_id = str(uuid.uuid4())
    values = [convert_row(r, batch_id) for r in rows]
    with mas_conn.cursor() as cur:
        cur.executemany(INSERT_SQL, values)
        now = datetime.now()
        cur.execute(
            """INSERT INTO upload_batch
                 (id, upload_batch_no, upload_type_code, original_file_name, file_size_bytes,
                  total_rows, valid_rows, error_rows, imported_rows, batch_status,
                  validated_at, imported_at, created_at, updated_at)
               VALUES (%s, %s, 'SATYA_CDR_MASMIS', %s, 0, %s, %s, 0, %s, 'imported', %s, %s, %s, %s)""",
            (batch_id, f"BATCH-{int(time.time() * 1000)}", label, len(rows), len(rows), len(rows), now, now, now, now),
        )
        cur.execute(
            """INSERT INTO db_masmis.upload_log (batch_id, table_name, file_name, row_count, uploaded_by)
               VALUES (%s, 'satya_cdr', %s, %s, NULL)""",
            (batch_id, label, len(rows)),
        )
    mas_conn.commit()
    return batch_id, len(rows)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--date", help="Backfill one specific day (YYYY-MM-DD) by direct CallDate filter")
    ap.add_argument("--dry-run", action="store_true", help="Preview only; writes nothing")
    args = ap.parse_args()

    dialer_cfg = load_db_config("DIALER_")
    mas_cfg = load_db_config("")
    dialer_conn = connect(dialer_cfg)
    mas_conn = connect(mas_cfg)
    try:
        if args.date:
            print(f"Backfilling {args.date} ...")
            rows = fetch_rows(dialer_conn, "DATE(CallDate) = %s", [args.date])
            print(f"  {len(rows)} row(s) found in data_master_in.")
            if args.dry_run:
                print("--dry-run: nothing written. Sample:", rows[:1])
                return
            if not rows:
                print("Nothing to import.")
                return
            batch_id, n = insert_rows(mas_conn, rows, f"dialer_db sync {args.date}")
            max_id = max(r["dataId"] for r in rows)
            print(f"Inserted {n} row(s). Batch {batch_id}.")
        else:
            if not CHECKPOINT_FILE.exists():
                sys.exit(
                    f"No checkpoint file yet ({CHECKPOINT_FILE.name}). Run the one-time backfill for "
                    f"31-Aug and 24/25/26/28/29-Sep first (py sync_satya_cdr.py --date YYYY-MM-DD for "
                    f"each), then create the checkpoint with the dataId as of the end of 23-Sep-26 -- "
                    f"see README.md."
                )
            checkpoint = json.loads(CHECKPOINT_FILE.read_text())
            last_id = checkpoint["last_data_id"]
            print(f"Incremental sync: dataId > {last_id} ...")
            rows = fetch_rows(dialer_conn, "dataId > %s", [last_id])
            print(f"  {len(rows)} new row(s) found.")
            if args.dry_run:
                print("--dry-run: nothing written. Sample:", rows[:1])
                return
            if not rows:
                print("Nothing new to import.")
                return
            batch_id, n = insert_rows(mas_conn, rows, f"dialer_db sync (incremental)")
            max_id = max(r["dataId"] for r in rows)
            CHECKPOINT_FILE.write_text(json.dumps({"last_data_id": max_id}))
            print(f"Inserted {n} row(s). Batch {batch_id}. Checkpoint advanced to dataId {max_id}.")
    finally:
        dialer_conn.close()
        mas_conn.close()


if __name__ == "__main__":
    main()
