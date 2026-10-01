#!/usr/bin/env python3
"""
Direct-to-database loader for LP Feedback's "Call Register" export
(db_masmis.lp_feedback_cdr) -- same pattern as housing_owner/upload_owner_cdr.py,
for use after convert_lp_feedback_cdr.py.

Column mapping matches what the app's own importer
(backend/src/modules/bulk-upload/lp-feedback-cdr-bulk.service.ts) looks up by
header name. Four of that importer's columns (unique_flag, disposition_status,
attempt, service_2) have no source in the real IDCloud export (confirmed
live -- see convert_lp_feedback_cdr.py's docstring) and are always inserted
as NULL here, never guessed.

Safety:
  - Refuses to run if rows for the same report_date already exist, unless
    --force is passed.
  - Rows missing Call_Number (the one required column, matching the app's
    own importer) are skipped and reported.
  - Also writes upload_batch + upload_batch_row + upload_log, so this
    upload shows up in the Uploader page's Recent Uploads and its Download
    button works, the same as an upload done through the UI.
  - Credentials are read only from this folder's db.env, never hardcoded.

Usage:
    py upload_lp_feedback_cdr.py "C:\\path\\to\\converted.csv" [--force] [--dry-run]
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

UPLOAD_TYPE_CODE = "LP_FEEDBACK_CDR_MASMIS"
TARGET_TABLE = "db_masmis.lp_feedback_cdr"

# (db column, source header). source_header=None -> always NULL (not present
# in the real export -- see this file's own docstring).
# disposition_status IS now present in the converted file (added by
# convert_lp_feedback_cdr.py via lp_disposition_map.py, 2026-09-28).
# unique_flag/attempt/service_2 remain genuinely absent from the source --
# see convert_lp_feedback_cdr.py's docstring for why attempt specifically
# was tried and then deliberately reverted.
COLUMN_MAP: list[tuple[str, str | None]] = [
    ("s_no", "S_No"), ("report_date", "Date"), ("interval_val", "Interval"), ("call_number", "Call_Number"),
    ("service", "Service"), ("agent", "Agent"), ("login_id", "Login_Id"), ("start_time", "Start_Time"),
    ("end_time", "End_Time"), ("extension", "Extension"), ("remarks", "Remarks"), ("dni", "Dni"),
    ("cli", "Cli"), ("disposition", "Desposition"), ("lead_id", "Lead_Id"), ("batch", "Batch"),
    ("dialer_type", "Dialer_Type"), ("duration", "Duration"), ("ivr_duration", "Ivr_Duration"),
    ("ring_duration", "Ring_Duration"), ("talk_duration", "Talk_Duration"), ("wrapup_duration", "Wrapup_Duration"),
    ("hold_duration", "Hold_Duration"), ("call_status", "Call_Status"), ("hangup_by", "Hangup_By"),
    ("child_call_number", "Child_CallNumbr"), ("ivr_terminal", "Ivr_Terminal"),
    ("unique_flag", None), ("disposition_status", "Disposition_Status"), ("attempt", None), ("service_2", None),
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
            if source_header is None:
                continue
            idx = by_norm.get(normalize_key(source_header))
            record[source_header] = raw[idx] if idx is not None and idx < len(raw) else None
        out.append(record)
    return out


def build_row_values(record: dict[str, Any]) -> list[str | None]:
    return [clean_text(record.get(source_header)) if source_header else None for _db_col, source_header in COLUMN_MAP]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("file", type=Path, help="Path to the converted Call Register .csv")
    ap.add_argument("--force", action="store_true", help="Import even if this date already has rows")
    ap.add_argument("--dry-run", action="store_true", help="Parse and validate only; write nothing")
    ap.add_argument("--chunk-size", type=int, default=2000, help="Rows per multi-row INSERT (default 2000)")
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
        call_number = clean_text(rec.get("Call_Number"))
        if not call_number:
            skipped_records.append((i, rec))
            continue
        values = build_row_values(rec)
        rows.append(values)
        row_meta.append((i, rec))
        rd = values[COLUMN_MAP.index(next(c for c in COLUMN_MAP if c[0] == "report_date"))]
        if rd:
            dates_seen.add(rd)

    print(f"  {len(rows)} row(s) valid, {len(skipped_records)} skipped (missing Call_Number)")
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
    chunks = [rows[i : i + args.chunk_size] for i in range(0, len(rows), args.chunk_size)]
    print(f"\nInserting {len(rows)} row(s) in {len(chunks)} chunk(s) of up to {args.chunk_size}...")
    conn = connect(cfg)
    inserted = 0
    try:
        with conn.cursor() as cur:
            for chunk in chunks:
                cur.executemany(INSERT_SQL, [tuple(r) + (None, batch_id) for r in chunk])
                inserted += cur.rowcount
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
                       VALUES (%s, 'lp_feedback_cdr', %s, %s, NULL)""",
                    (batch_id, f"uploader script: {args.file.name}", inserted),
                )
        batch_conn.commit()
        print(f"Recorded upload_batch {batch_no} ({batch_id}).")
    finally:
        batch_conn.close()

    staged = [(row_no, rec, "imported", None) for row_no, rec in row_meta] + \
             [(row_no, rec, "error", f'Row {row_no}: "Call_Number" is required') for row_no, rec in skipped_records]
    print(f"Staging {len(staged)} upload_batch_row record(s)...")
    write_staged_rows(cfg, batch_id, staged)
    print("Done.")


if __name__ == "__main__":
    main()
