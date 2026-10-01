#!/usr/bin/env python3
"""
Direct-to-database loader for LP Feedback's "Agent Wise Performance" export
(db_masmis.lp_feedback_apr) -- same pattern as housing_owner/upload_owner_cdr.py,
for use after convert_lp_feedback_apr.py.

Column mapping matches what the app's own importer
(backend/src/modules/bulk-upload/lp-feedback-apr-bulk.service.ts) looks up by
header name. Every column in lp_feedback_apr is a VARCHAR (confirmed live via
SHOW COLUMNS), so every value is written as a clean text string.

Safety:
  - Refuses to run if rows for the same report_date already exist, unless
    --force is passed.
  - Rows missing LoginId (falling back to Agent, matching the app's own
    importer rule) are skipped and reported, never inserted with a guessed
    value.
  - Also writes upload_batch + upload_batch_row + upload_log, so this
    upload shows up in the Uploader page's Recent Uploads and its Download
    button works, the same as an upload done through the UI.
  - Credentials are read only from this folder's db.env, never hardcoded.

Usage:
    py upload_lp_feedback_apr.py "C:\\path\\to\\converted.csv" [--force] [--dry-run]
"""
from __future__ import annotations

import argparse
import csv
import re
import sys
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent))
from lp_feedback_db_common import connect, load_db_config, write_staged_rows  # noqa: E402

UPLOAD_TYPE_CODE = "LP_FEEDBACK_APR_MASMIS"
TARGET_TABLE = "db_masmis.lp_feedback_apr"

COLUMN_MAP: list[tuple[str, str]] = [
    ("report_date", "CalLDate"), ("interval_val", "Interval"), ("agent", "Agent"), ("login_id", "LoginId"),
    ("total_calls", "Total_Calls"), ("dialer_calls", "Dialer_Calls"), ("outbound_calls", "Outbound_Calls"),
    ("manual_calls", "Manual_Calls"), ("transfered_calls", "Transfered_Calls"), ("login_time", "Login_Time"),
    ("net_login_time", "Net_LoginTime"), ("break_count", "Break_Count"), ("tea", "Tea"), ("lunch", "Lunch"),
    ("meeting", "Meeting"), ("bio_break", "BIO_Break"), ("unsolicited", "Unsolicted"),
    ("total_break_duration", "Total_Break_Duration"), ("handle_duration", "Handle_Duration"),
    ("avg_handle_duration", "Average_Handle_Duration"), ("idle_duration", "Idle_Duration"),
    ("avg_idle_duration", "Average_Idle_Duration"), ("idle_block_duration", "Idle_Block_Duration"),
    ("ring_duration", "Ring_Duration"), ("avg_ring_duration", "Average_Ring_Duration"),
    ("talk_duration", "Talk_Duration"), ("avg_talk_duration", "Average_Talk_Duration"),
    ("hold_duration", "Hold_Duration"), ("avg_hold_duration", "Average_Hold_Duration"),
    ("wrapup_duration", "Wrapup_Duration"), ("avg_wrapup_duration", "Average_Wrapup_Duration"),
]
DB_COLUMNS = [c[0] for c in COLUMN_MAP] + ["uploaded_by", "upload_batch_id"]
INSERT_SQL = f"INSERT INTO {TARGET_TABLE} ({', '.join(DB_COLUMNS)}) VALUES ({', '.join(['%s'] * len(DB_COLUMNS))})"


def normalize_key(k: str) -> str:
    return re.sub(r"[^a-z0-9]", "", k.lower())


def clean_text(v: Any) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def read_rows(path: Path) -> list[dict[str, Any]]:
    with path.open(encoding="utf-8-sig", newline="") as f:
        rows = list(csv.reader(f))
    if not rows:
        return []
    header, data_rows = rows[0], rows[1:]
    by_norm = {normalize_key(h): i for i, h in enumerate(header)}
    out = []
    for raw in data_rows:
        if not raw or all(not v.strip() for v in raw):
            continue
        record = {}
        for _db_col, source_header in COLUMN_MAP:
            idx = by_norm.get(normalize_key(source_header))
            record[source_header] = raw[idx] if idx is not None and idx < len(raw) else None
        out.append(record)
    return out


def build_row_values(record: dict[str, Any]) -> list[str | None]:
    return [clean_text(record.get(source_header)) for _db_col, source_header in COLUMN_MAP]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("file", type=Path, help="Path to the converted Agent Wise Performance .csv")
    ap.add_argument("--force", action="store_true", help="Import even if this date already has rows")
    ap.add_argument("--dry-run", action="store_true", help="Parse and validate only; write nothing")
    args = ap.parse_args()

    if not args.file.exists():
        sys.exit(f"File not found: {args.file}")

    print(f"Reading {args.file} ...")
    records = read_rows(args.file)
    print(f"  {len(records)} data row(s) read")

    skipped_records: list[tuple[int, dict[str, Any]]] = []
    rows: list[list[str | None]] = []
    row_meta: list[tuple[int, dict[str, Any]]] = []
    dates_seen: set[str] = set()
    for i, rec in enumerate(records, start=2):
        login_id = clean_text(rec.get("LoginId")) or clean_text(rec.get("Agent"))
        if not login_id:
            skipped_records.append((i, rec))
            continue
        values = build_row_values(rec)
        rows.append(values)
        row_meta.append((i, rec))
        rd = values[COLUMN_MAP.index(next(c for c in COLUMN_MAP if c[0] == "report_date"))]
        if rd:
            dates_seen.add(rd)

    print(f"  {len(rows)} row(s) valid, {len(skipped_records)} skipped (missing LoginId/Agent)")
    if dates_seen:
        print(f"  report_date values present: {sorted(dates_seen)}")

    if args.dry_run:
        print("\n--dry-run: nothing written. Sample of first 3 mapped rows:")
        for r in rows[:3]:
            print(dict(zip(DB_COLUMNS[:-2], r)))
        return

    cfg = load_db_config()
    guard_conn = connect(cfg)
    try:
        with guard_conn.cursor() as cur:
            if dates_seen and not args.force:
                placeholders = ", ".join(["%s"] * len(dates_seen))
                cur.execute(f"SELECT COUNT(*) FROM {TARGET_TABLE} WHERE report_date IN ({placeholders})", list(dates_seen))
                existing = cur.fetchone()[0]
                if existing > 0:
                    sys.exit(f"Refusing to import: {existing} row(s) already exist for these report_date value(s). Re-run with --force if sure.")
    finally:
        guard_conn.close()

    batch_id = str(uuid.uuid4())
    batch_no = f"BATCH-{int(time.time() * 1000)}"
    conn = connect(cfg)
    inserted = 0
    try:
        with conn.cursor() as cur:
            cur.executemany(INSERT_SQL, [tuple(r) + (None, batch_id) for r in rows])
            inserted = cur.rowcount
        conn.commit()
    finally:
        conn.close()
    print(f"Inserted {inserted} row(s).")

    batch_conn = connect(cfg)
    try:
        with batch_conn.cursor() as cur:
            now = datetime.now()
            cur.execute(
                """INSERT INTO upload_batch
                     (id, upload_batch_no, upload_type_code, original_file_name, file_size_bytes,
                      total_rows, valid_rows, error_rows, imported_rows, batch_status,
                      validated_at, imported_at, created_at, updated_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'imported', %s, %s, %s, %s)""",
                (batch_id, batch_no, UPLOAD_TYPE_CODE, args.file.name, args.file.stat().st_size,
                 len(records), len(rows), len(records) - len(rows), inserted, now, now, now, now),
            )
            if inserted > 0:
                cur.execute(
                    """INSERT INTO db_masmis.upload_log (batch_id, table_name, file_name, row_count, uploaded_by)
                       VALUES (%s, 'lp_feedback_apr', %s, %s, NULL)""",
                    (batch_id, f"uploader script: {args.file.name}", inserted),
                )
        batch_conn.commit()
        print(f"Recorded upload_batch {batch_no} ({batch_id}).")
    finally:
        batch_conn.close()

    staged = [(row_no, rec, "imported", None) for row_no, rec in row_meta] + \
             [(row_no, rec, "error", 'Row {}: "LoginId" (or "Agent") is required'.format(row_no)) for row_no, rec in skipped_records]
    print(f"Staging {len(staged)} upload_batch_row record(s)...")
    write_staged_rows(cfg, batch_id, staged)
    print("Done.")


if __name__ == "__main__":
    main()
