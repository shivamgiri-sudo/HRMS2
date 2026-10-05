#!/usr/bin/env python3
"""
Direct-to-database loader for Housing Owner's "Owner CDR" export
(db_masmis.Owner_cdr) -- the Housing Owner equivalent of
upload_housing_premium_cdr.py, for use after convert_owner_cdr_export.py.

Column mapping matches what the app's own importer
(backend/src/modules/bulk-upload/owner-cdr-bulk.service.ts) looks up by
header name, so rows from this script are indistinguishable from ones
uploaded through the Uploader page. Every column in db_masmis.Owner_cdr is a
VARCHAR (confirmed live via SHOW COLUMNS), so every value here is written as
a clean text/number string -- no date/time reformatting needed, unlike
Pre_cdr, since convert_owner_cdr_export.py already produces final display
strings (report_date as "D-Mon-YY", durations as "HH:MM:SS", etc).

Safety:
  - Refuses to run if rows for the same report-date already exist in
    Owner_cdr, unless --force is passed -- same duplicate-guard convention
    as upload_housing_premium_cdr.py (Owner_cdr has no unique constraint of
    its own either).
  - Rows missing UID (the one required column, matching the app's own
    importer's rule) are skipped and reported, never inserted with a
    guessed value.
  - Also writes one mas_hrms.upload_batch header row, one upload_batch_row
    per source row (raw_data = the row exactly as read from the file, same
    shape the app's own /batches/:id/rows staging step would have produced),
    and one db_masmis.upload_log row -- all in the same shape the app's own
    importer writes them, so this upload shows up in the Uploader page's
    "Recent Uploads" list AND its "Download"/"Download Failed Rows" buttons
    both work, exactly like an upload done through the UI. (A first version
    of this script skipped upload_batch_row entirely -- the direct-to-table
    insert doesn't need it -- which silently broke both download buttons for
    every python-imported batch, discovered live when they returned "No
    rows are stored for this upload" instead of a file.)
  - Credentials are read only from this folder's db.env, never hardcoded.

Usage:
    py upload_owner_cdr.py "C:\\path\\to\\converted.xlsx" [--force] [--dry-run] [--workers N] [--chunk-size N]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from typing import Any

from dotenv import dotenv_values
from openpyxl import load_workbook
import pymysql

UPLOAD_TYPE_CODE = "OWNER_CDR_MASMIS"
TARGET_TABLE = "db_masmis.Owner_cdr"

# (db column, source header) in the exact order owner-cdr-bulk.service.ts's
# insertPrefix lists them. Every column is plain text -- no "kind" needed.
COLUMN_MAP: list[tuple[str, str]] = [
    ("uid", "UID"), ("report_date", "Date"), ("agent", "Agent"), ("email_id", "Email ID"),
    ("intercom_id", "Intercom ID"), ("group_name", "Group"), ("department", "Department"),
    ("login_based_calling", "Login Based Calling"), ("avg_calls_per_day", "Average Calls/Day"),
    ("avg_c2c_calls_per_day_outbound_answered", "Average C2C Calls/Day - Outbound Answered"),
    ("avg_inbound_calls_per_day", "Average Inbound Calls/Day"), ("call_handling_rate", "Call Handling Rate"),
    ("total_calls", "Total Calls"), ("inbound_calls_offered", "Inbound Calls Offered"),
    ("outbound_click_to_call_attempted", "Outbound Click to Call Attempted"),
    ("calls_handled", "Calls Handled"), ("inbound_calls_answered", "Inbound Calls Answered"),
    ("inbound_calls_missed", "Inbound Calls Missed"),
    ("outbound_click_to_call_answered", "Outbound Click to Call Answered"),
    ("available_duration", "Available Duration"), ("in_call_duration", "In-Call Duration"),
    ("break_duration", "Break Duration"), ("inbound_in_call_duration", "Inbound In-Call Duration"),
    ("outbound_in_call_duration", "Outbound In-Call Duration"),
    ("avg_call_handling_duration", "Average Call Handling Duration"),
    ("avg_inbound_call_handling_duration", "Average Inbound Call Handling Duration"),
    ("avg_outbound_call_handling_duration", "Average Outbound Call Handling Duration"),
    ("not_connected", "Not Connected"), ("connected", "Connected"), ("tl_name", "TL Name"),
    ("avg_talk_time", "Average Talk time"), ("month", "Month"), ("day", "Day"),
    ("last_val", "last"), ("am", "AM"),
]
DB_COLUMNS = [c[0] for c in COLUMN_MAP] + ["uploaded_by", "upload_batch_id"]
INSERT_SQL = (
    f"INSERT INTO {TARGET_TABLE} ({', '.join(DB_COLUMNS)}) "
    f"VALUES ({', '.join(['%s'] * len(DB_COLUMNS))})"
)


def normalize_key(k: str) -> str:
    return re.sub(r"[^a-z0-9]", "", k.lower())


def load_db_config() -> dict[str, Any]:
    """Reads DB credentials from this folder's own db.env, so housing_owner/
    is a self-contained module copyable to a different machine on its own --
    same convention as upload_housing_premium_cdr.py's load_db_config()."""
    here_env = Path(__file__).resolve().parent / "db.env"
    repo_env = Path(__file__).resolve().parent.parent.parent / "backend" / ".env"
    env_path = here_env if here_env.exists() else repo_env
    if not env_path.exists():
        sys.exit(f"Cannot find {here_env} or {repo_env} -- credentials must come from one of these, not be hardcoded.")
    env = dotenv_values(env_path)
    missing = [k for k in ("DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME") if not env.get(k)]
    if missing:
        sys.exit(f"{env_path} is missing: {', '.join(missing)}")
    return {
        "host": env["DB_HOST"],
        "port": int(env.get("DB_PORT", "3306")),
        "user": env["DB_USER"],
        "password": env["DB_PASSWORD"],
        "database": env["DB_NAME"],  # mas_hrms; Owner_cdr is addressed fully-qualified as db_masmis.Owner_cdr
        "charset": "utf8mb4",
        "connect_timeout": 20,
        "read_timeout": 120,
        "write_timeout": 120,
    }


def connect(cfg: dict[str, Any]) -> pymysql.connections.Connection:
    return pymysql.connect(**cfg)


def clean_text(v: Any) -> str | None:
    if v is None:
        return None
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    s = str(v).strip()
    return s or None


def read_rows(path: Path) -> list[dict[str, Any]]:
    wb = load_workbook(path, read_only=True, data_only=True)
    ws = wb[wb.sheetnames[0]]
    rows_iter = ws.iter_rows(values_only=True)
    header = next(rows_iter)
    by_norm = {normalize_key(str(h)): i for i, h in enumerate(header) if h is not None}
    out = []
    for raw in rows_iter:
        if raw is None or all(v is None for v in raw):
            continue
        record = {}
        for _db_col, source_header in COLUMN_MAP:
            idx = by_norm.get(normalize_key(source_header))
            record[source_header] = raw[idx] if idx is not None and idx < len(raw) else None
        out.append(record)
    wb.close()
    return out


def build_row_values(record: dict[str, Any]) -> list[str | None]:
    return [clean_text(record.get(source_header)) for _db_col, source_header in COLUMN_MAP]


def write_staged_rows(
    cfg: dict[str, Any],
    batch_id: str,
    staged: list[tuple[int, dict[str, Any], str, str | None]],
    chunk_size: int = 1000,
) -> None:
    """Writes one upload_batch_row per source row -- raw_data/normalized_data
    are the record exactly as read from the file (keyed by the same source
    headers COLUMN_MAP looks up), matching the shape the app's own
    /batches/:id/rows staging endpoint would have produced. Without this,
    the Uploader page's "Download"/"Download Failed Rows" buttons find zero
    staged rows for a python-imported batch and report "No rows are stored
    for this upload" -- confirmed live, this is not hypothetical."""
    if not staged:
        return
    conn = connect(cfg)
    try:
        with conn.cursor() as cur:
            for i in range(0, len(staged), chunk_size):
                chunk = staged[i : i + chunk_size]
                cur.executemany(
                    """INSERT INTO upload_batch_row
                         (id, upload_batch_id, row_no, raw_data, normalized_data, row_status, error_messages, created_at)
                       VALUES (UUID(), %s, %s, %s, %s, %s, %s, %s)""",
                    [
                        (
                            batch_id, row_no, json.dumps(rec, default=str), json.dumps(rec, default=str),
                            status, json.dumps([err]) if err else None, datetime.now(),
                        )
                        for row_no, rec, status, err in chunk
                    ],
                )
        conn.commit()
    finally:
        conn.close()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("file", type=Path, help="Path to the converted Owner CDR .xlsx")
    ap.add_argument("--force", action="store_true", help="Import even if this date already has rows in Owner_cdr")
    ap.add_argument("--dry-run", action="store_true", help="Parse and validate only; write nothing to the database")
    ap.add_argument("--workers", type=int, default=6, help="Concurrent DB connections for the insert (default 6)")
    ap.add_argument("--chunk-size", type=int, default=1000, help="Rows per multi-row INSERT (default 1000)")
    args = ap.parse_args()

    if not args.file.exists():
        sys.exit(f"File not found: {args.file}")

    print(f"Reading {args.file} ...")
    t0 = time.time()
    records = read_rows(args.file)
    print(f"  {len(records)} data row(s) read in {time.time() - t0:.1f}s")

    skipped: list[int] = []
    skipped_records: list[tuple[int, dict[str, Any]]] = []
    rows: list[list[str | None]] = []
    row_meta: list[tuple[int, dict[str, Any]]] = []  # (row_no, raw record) parallel to `rows`
    dates_seen: set[str] = set()
    for i, rec in enumerate(records, start=2):  # row 2 = first data row (row 1 is the header)
        uid = clean_text(rec.get("UID"))
        if not uid:
            skipped.append(i)
            skipped_records.append((i, rec))
            continue
        values = build_row_values(rec)
        rows.append(values)
        row_meta.append((i, rec))
        rd = values[COLUMN_MAP.index(next(c for c in COLUMN_MAP if c[0] == "report_date"))]
        if rd:
            dates_seen.add(rd)

    print(f"  {len(rows)} row(s) valid, {len(skipped)} skipped (missing UID)")
    if skipped:
        print(f"  skipped source rows: {skipped[:20]}{' ...' if len(skipped) > 20 else ''}")
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
                cur.execute(
                    f"SELECT COUNT(*) FROM {TARGET_TABLE} WHERE report_date IN ({placeholders})",
                    list(dates_seen),
                )
                existing = cur.fetchone()[0]
                if existing > 0:
                    sys.exit(
                        f"Refusing to import: {existing} row(s) already exist in Owner_cdr for these report_date "
                        f"value(s). Re-run with --force if you are sure this is not a duplicate."
                    )
    finally:
        guard_conn.close()

    batch_id = str(uuid.uuid4())
    batch_no = f"BATCH-{int(time.time() * 1000)}"
    chunks = [rows[i : i + args.chunk_size] for i in range(0, len(rows), args.chunk_size)]
    meta_chunks = [row_meta[i : i + args.chunk_size] for i in range(0, len(row_meta), args.chunk_size)]
    print(f"\nInserting {len(rows)} row(s) in {len(chunks)} chunk(s) of up to {args.chunk_size}, {args.workers} worker(s)...")

    inserted = 0
    errors: list[str] = []
    staged_status: list[tuple[int, dict[str, Any], str, str | None]] = []  # (row_no, record, status, error)
    for row_no, rec in skipped_records:
        staged_status.append((row_no, rec, "error", f'Row {row_no}: "UID" is required'))
    t1 = time.time()

    def insert_chunk_once(chunk: list[list[str | None]]) -> tuple[int, str | None]:
        conn = connect(cfg)
        try:
            with conn.cursor() as cur:
                cur.executemany(INSERT_SQL, [tuple(r) + (None, batch_id) for r in chunk])
            conn.commit()
            return len(chunk), None
        except Exception as exc:  # noqa: BLE001 -- reported to the caller, not swallowed
            try:
                conn.rollback()
            except Exception:  # noqa: BLE001 -- connection may already be dead; nothing to roll back
                pass
            return 0, str(exc)
        finally:
            try:
                conn.close()
            except Exception:  # noqa: BLE001 -- already-dead connection; safe to ignore
                pass

    def insert_chunk(chunk: list[list[str | None]], attempts: int = 3) -> int:
        last_message = "unknown error"
        for attempt in range(1, attempts + 1):
            result, message = insert_chunk_once(chunk)
            if result > 0:
                return result
            last_message = message or last_message
            if attempt < attempts:
                time.sleep(2 * attempt)
        errors.append(last_message)
        return 0

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        future_to_idx = {pool.submit(insert_chunk, c): idx for idx, c in enumerate(chunks)}
        for done, fut in enumerate(as_completed(future_to_idx), start=1):
            idx = future_to_idx[fut]
            chunk_meta = meta_chunks[idx]
            try:
                result = fut.result()
                inserted += result
                status = "imported" if result > 0 else "error"
                err = None if result > 0 else (errors[-1] if errors else "insert failed")
            except Exception as exc:  # noqa: BLE001 -- last-resort net; insert_chunk itself shouldn't raise
                errors.append(str(exc))
                status, err = "error", str(exc)
            for row_no, rec in chunk_meta:
                staged_status.append((row_no, rec, status, err))
            print(f"  chunk {done}/{len(chunks)} done -- {inserted}/{len(rows)} rows inserted", end="\r")
    print()

    elapsed = time.time() - t1
    print(f"Done in {elapsed:.1f}s ({inserted} row(s) inserted, {len(rows) - inserted} row(s) failed).")
    if errors:
        print(f"  {len(errors)} chunk error(s), first: {errors[0][:300]}")

    batch_conn = connect(cfg)
    try:
        with batch_conn.cursor() as cur:
            now = datetime.now()
            cur.execute(
                """INSERT INTO upload_batch
                     (id, upload_batch_no, upload_type_code, original_file_name, file_size_bytes,
                      total_rows, valid_rows, error_rows, imported_rows, batch_status,
                      validated_at, imported_at, created_at, updated_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (
                    batch_id, batch_no, UPLOAD_TYPE_CODE, args.file.name, args.file.stat().st_size,
                    len(records), len(rows), len(records) - len(rows), inserted,
                    "imported" if inserted > 0 and not errors else ("imported_with_errors" if inserted > 0 else "validation_failed"),
                    now, now, now, now,
                ),
            )
            if inserted > 0:
                cur.execute(
                    """INSERT INTO db_masmis.upload_log (batch_id, table_name, file_name, row_count, uploaded_by)
                       VALUES (%s, 'Owner_cdr', %s, %s, NULL)""",
                    (batch_id, f"uploader script: {args.file.name}", inserted),
                )
        batch_conn.commit()
        print(f"Recorded upload_batch {batch_no} ({batch_id}) -- will show in the Uploader page's Recent Uploads.")
    finally:
        batch_conn.close()

    print(f"Staging {len(staged_status)} upload_batch_row record(s) so this batch is downloadable from the Uploader page...")
    write_staged_rows(cfg, batch_id, staged_status)
    print("Done.")


if __name__ == "__main__":
    main()
