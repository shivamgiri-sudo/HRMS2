#!/usr/bin/env python3
"""
Direct-to-database loader for Housing Premium's "Premium CDR" export
(db_masmis.Pre_cdr) -- a fast alternative to the app's Uploader page for
one specific file, when that page's own chunked-insert path is too slow
for a 30k-40k row file (see backend/src/modules/bulk-upload/pre-cdr-bulk.service.ts
and masmis-chunked-insert.ts for the app's own equivalent, slower path).

Column mapping and formatting deliberately match what the app's own
importer produces, so rows from this script are indistinguishable from
ones uploaded through the UI:
  - Source header names looked up case/punctuation-insensitively, same as
    pre-cdr-bulk.service.ts's getByColumn().
  - report_date must come out as "M/D/YY" (no leading zeros, 2-digit year)
    -- confirmed against housing-premium-dashboard.service.ts's CDR_DATE_SQL:
    STR_TO_DATE(report_date, '%c/%e/%y'). Getting this wrong would silently
    drop every row from every day-range / week / MTD figure on the
    dashboard, even though the row is sitting right there in the table.
  - end_time/start_time as "M/D/YY H:MM", talk_time as "H:MM" -- matching
    the style already stored by prior real uploads (verified against the
    last-inserted rows in the table before writing this).
  - All other columns pass through as plain text/number strings; every
    column in db_masmis.Pre_cdr is a VARCHAR, so numeric-looking columns
    used in later SQL (talk_duration, unique_count, call_count) are still
    written as clean digit strings (no ".0", no Excel scientific notation).

Safety:
  - Refuses to run if rows for the same report-date range already exist
    in Pre_cdr, unless --force is passed -- Pre_cdr carries no unique
    constraint of its own (confirmed via SHOW COLUMNS), so a second run
    would otherwise silently duplicate every row.
  - Rows missing CALLER (the one required column, same rule the app's
    importer enforces) are skipped and reported, never inserted with a
    guessed value.
  - Also writes one mas_hrms.upload_batch header row and one
    db_masmis.upload_log row, in the same shape the app's own importer
    writes them, so this upload shows up in the Uploader page's "Recent
    Uploads" list exactly like one done through the UI.
  - Credentials are read only from backend/.env, never hardcoded here.

Usage:
    py upload_housing_premium_cdr.py "C:\\path\\to\\file.xlsx" [--force] [--dry-run] [--workers N] [--chunk-size N]
"""
from __future__ import annotations

import argparse
import re
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, time as dt_time
from pathlib import Path
from typing import Any

from dotenv import dotenv_values
from openpyxl import load_workbook
import pymysql

UPLOAD_TYPE_CODE = "PRE_CDR_MASMIS"
TARGET_TABLE = "db_masmis.Pre_cdr"

# Source header (normalized) -> Pre_cdr column, in the exact order
# pre-cdr-bulk.service.ts's insertPrefix lists them.
COLUMN_MAP: list[tuple[str, str, str]] = [
    # (db column, source header, kind)
    ("caller", "CALLER", "text"),
    ("member", "MEMBER", "text"),
    ("end_time", "End Time", "datetime"),
    ("duration", "DURATION", "number"),
    ("status", "STATUS", "text"),
    ("routing_numbers", "Routing Numbers", "text"),
    ("routing_status", "Routing Status", "text"),
    ("talk_duration", "Talk Duration", "number"),
    ("ringing_duration", "Ringing Duration", "number"),
    ("start_time", "Start Time", "datetime"),
    ("time_value", "Time", "number"),
    ("report_date", "Date", "date"),
    ("tl_name", "TL Name", "text"),
    ("call_count", "Count", "number"),
    ("unique_count", "Unique Count", "number"),
    ("date_row_count", "Date row Count", "number"),
    ("v_plus_w", "V+W", "number"),
    ("talk_time", "Talk Time", "time"),
    ("tl", "TL", "text"),
]
DB_COLUMNS = [c[0] for c in COLUMN_MAP] + ["uploaded_by", "upload_batch_id"]
INSERT_SQL = (
    f"INSERT INTO {TARGET_TABLE} ({', '.join(DB_COLUMNS)}) "
    f"VALUES ({', '.join(['%s'] * len(DB_COLUMNS))})"
)


def normalize_key(k: str) -> str:
    return re.sub(r"[^a-z0-9]", "", k.lower())


def load_db_config() -> dict[str, Any]:
    """Reads DB credentials from, in order: this folder's own db.env (so the
    whole uploader/ folder is a self-contained module that can be copied to
    a different machine -- e.g. an always-on company PC for the daily
    scheduled run -- with no HRMS2 repo checkout alongside it), else
    backend/.env (the original within-repo layout). Never hardcoded."""
    here_env = Path(__file__).resolve().parent / "db.env"
    repo_env = Path(__file__).resolve().parent.parent / "backend" / ".env"
    env_path = here_env if here_env.exists() else repo_env
    if not env_path.exists():
        sys.exit(f"Cannot find {here_env} or {repo_env} -- credentials must come from one of these, not be hardcoded.")
    env = dotenv_values(env_path)
    missing = [k for k in ("DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME") if not env.get(k)]
    if missing:
        sys.exit(f"backend/.env is missing: {', '.join(missing)}")
    return {
        "host": env["DB_HOST"],
        "port": int(env.get("DB_PORT", "3306")),
        "user": env["DB_USER"],
        "password": env["DB_PASSWORD"],
        "database": env["DB_NAME"],  # mas_hrms; Pre_cdr is addressed fully-qualified as db_masmis.Pre_cdr
        "charset": "utf8mb4",
        "connect_timeout": 20,
        "read_timeout": 120,
        "write_timeout": 120,
    }


def connect(cfg: dict[str, Any]) -> pymysql.connections.Connection:
    return pymysql.connect(**cfg)


# --------------------------------- formatting --------------------------------- #

def clean_number(v: Any) -> str | None:
    if v is None:
        return None
    if isinstance(v, str):
        v = v.strip()
        if v == "":
            return None
        try:
            f = float(v)
        except ValueError:
            return v  # not numeric text; pass through rather than guess
        v = f
    if isinstance(v, float):
        return str(int(v)) if v.is_integer() else str(v)
    return str(v)


def clean_text(v: Any) -> str | None:
    if v is None:
        return None
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    s = str(v).strip()
    return s or None


def fmt_date_only(v: Any) -> str | None:
    """report_date MUST be 'M/D/YY' -- STR_TO_DATE(report_date, '%c/%e/%y') downstream."""
    if v is None:
        return None
    if isinstance(v, (datetime, date)):
        return f"{v.month}/{v.day}/{v.year % 100}"
    s = str(v).strip()
    return s or None


def fmt_datetime(v: Any) -> str | None:
    if v is None:
        return None
    if isinstance(v, datetime):
        if v.hour == 0 and v.minute == 0 and v.second == 0:
            return f"{v.month}/{v.day}/{v.year % 100}"
        return f"{v.month}/{v.day}/{v.year % 100} {v.hour}:{v.minute:02d}"
    if isinstance(v, date):
        return f"{v.month}/{v.day}/{v.year % 100}"
    s = str(v).strip()
    return s or None


def fmt_time(v: Any) -> str | None:
    if v is None:
        return None
    if isinstance(v, dt_time):
        return f"{v.hour}:{v.minute:02d}"
    if isinstance(v, datetime):
        return f"{v.hour}:{v.minute:02d}"
    s = str(v).strip()
    return s or None


FORMATTERS = {"text": clean_text, "number": clean_number, "date": fmt_date_only, "datetime": fmt_datetime, "time": fmt_time}


# ----------------------------------- reading ----------------------------------- #

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
        for _db_col, source_header, _kind in COLUMN_MAP:
            idx = by_norm.get(normalize_key(source_header))
            record[source_header] = raw[idx] if idx is not None and idx < len(raw) else None
        out.append(record)
    wb.close()
    return out


def build_row_values(record: dict[str, Any]) -> list[str | None]:
    return [FORMATTERS[kind](record.get(source_header)) for _db_col, source_header, kind in COLUMN_MAP]


# ------------------------------------ main ------------------------------------ #

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("file", type=Path, help="Path to the Premium CDR .xlsx export")
    ap.add_argument("--force", action="store_true", help="Import even if this date range already has rows in Pre_cdr")
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
    rows: list[list[str | None]] = []
    dates_seen: set[str] = set()
    for i, rec in enumerate(records, start=2):  # row 2 = first data row (row 1 is the header)
        caller = clean_text(rec.get("CALLER"))
        if not caller:
            skipped.append(i)
            continue
        values = build_row_values(rec)
        rows.append(values)
        rd = values[COLUMN_MAP.index(next(c for c in COLUMN_MAP if c[0] == "report_date"))]
        if rd:
            dates_seen.add(rd)

    print(f"  {len(rows)} row(s) valid, {len(skipped)} skipped (missing CALLER)")
    if skipped:
        print(f"  skipped source rows: {skipped[:20]}{' ...' if len(skipped) > 20 else ''}")
    if dates_seen:
        print(f"  report_date values present: {sorted(dates_seen, key=lambda d: tuple(map(int, d.split('/'))))}")

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
                        f"Refusing to import: {existing} row(s) already exist in Pre_cdr for these report_date "
                        f"value(s). Re-run with --force if you are sure this is not a duplicate."
                    )
    finally:
        guard_conn.close()

    batch_id = str(uuid.uuid4())
    batch_no = f"BATCH-{int(time.time() * 1000)}"
    chunks = [rows[i : i + args.chunk_size] for i in range(0, len(rows), args.chunk_size)]
    print(f"\nInserting {len(rows)} row(s) in {len(chunks)} chunk(s) of up to {args.chunk_size}, {args.workers} worker(s)...")

    inserted = 0
    errors: list[str] = []
    t1 = time.time()

    def insert_chunk_once(chunk: list[list[str | None]]) -> tuple[int, str | None]:
        """One attempt, one dedicated connection. Never raises -- a dead
        connection (the shared host resets these sometimes) can make
        rollback()/close() themselves throw, and an uncaught exception here
        used to kill the whole ThreadPoolExecutor run via fut.result(),
        leaving an untracked partial import (no upload_batch row at all)
        with no way to tell which chunks had actually landed. Every failure
        path below is swallowed locally and reported as a plain 0."""
        conn = connect(cfg)
        try:
            with conn.cursor() as cur:
                cur.executemany(
                    INSERT_SQL,
                    [tuple(r) + (None, batch_id) for r in chunk],
                )
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
        return len(chunk), None

    def insert_chunk(chunk: list[list[str | None]], attempts: int = 3) -> int:
        """Retries a failed chunk against a fresh connection -- the shared DB
        host is documented elsewhere in this app as intermittently resetting
        connections; one dropped connection shouldn't cost 1000 real rows.
        Only a failure on the FINAL attempt is recorded in `errors` -- a
        transient blip that a retry fixed is not a real error, and counting
        it as one used to mislabel a fully-successful import as
        'imported_with_errors' on the Uploader page's status badge."""
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
        futures = [pool.submit(insert_chunk, c) for c in chunks]
        for done, fut in enumerate(as_completed(futures), start=1):
            try:
                inserted += fut.result()
            except Exception as exc:  # noqa: BLE001 -- last-resort net; insert_chunk itself shouldn't raise
                errors.append(str(exc))
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
                       VALUES (%s, 'Pre_cdr', %s, %s, NULL)""",
                    (batch_id, f"uploader script: {args.file.name}", inserted),
                )
        batch_conn.commit()
        print(f"Recorded upload_batch {batch_no} ({batch_id}) -- will show in the Uploader page's Recent Uploads.")
    finally:
        batch_conn.close()


if __name__ == "__main__":
    main()
