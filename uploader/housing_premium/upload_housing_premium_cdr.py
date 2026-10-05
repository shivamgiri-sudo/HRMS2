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
  - Credentials are read only from backend/.env, never hardcoded here.

Usage:
    py upload_housing_premium_cdr.py "C:\\path\\to\\file.xlsx" [--force] [--dry-run] [--workers N] [--chunk-size N]
"""
from __future__ import annotations

import argparse
import json
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
DB_COLUMNS: list[str] = []
for _db_col, _src, _kind in COLUMN_MAP:
    DB_COLUMNS.append(_db_col)
    if _db_col == "report_date":
        # Migration 448: real indexed DATE column, backfilled from report_date so date-range
        # dashboard queries stop doing a full-table STR_TO_DATE scan. Populated here too so
        # rows from this script (including the daily automation) never fall behind it.
        DB_COLUMNS.append("report_date_iso")
DB_COLUMNS += ["uploaded_by", "upload_batch_id"]
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


def refresh_daily_summary(cfg: dict[str, Any], iso_dates: set[date]) -> None:
    """Keeps db_masmis.pre_cdr_daily_summary (migration 449, the Housing Premium Overview
    tab's precomputed day x TL rollup) in sync after an insert -- recomputes the summary
    rows for exactly the dates this run touched, from Pre_cdr's current state. Cheap: only
    re-aggregates these few dates, not the whole table. Self-correcting even for a re-import
    of an already-covered date -- always overwrites from the real current data, never adds.

    Migration 449 has not been run against production yet (the Overview tab was reverted
    to read raw Pre_cdr directly until it is -- see housing-premium-dashboard.service.ts),
    so this table may not exist. Never let that fail a real import that already succeeded:
    this is a courtesy sync, not part of the insert's own correctness."""
    if not iso_dates:
        return
    conn = connect(cfg)
    try:
        with conn.cursor() as cur:
            placeholders = ", ".join(["%s"] * len(iso_dates))
            cur.execute(
                f"""
                INSERT INTO db_masmis.pre_cdr_daily_summary
                    (report_date_iso, tl_name, connected, not_connected, unique_connected, present_count, talk_seconds, row_count)
                SELECT report_date_iso, COALESCE(NULLIF(tl_name, ''), ''),
                       SUM(status = 'Answered'), SUM(status = 'No Answered'),
                       SUM(status = 'Answered' AND unique_count = '1'), SUM(call_count = '1'),
                       SUM(talk_duration + 0), COUNT(*)
                FROM db_masmis.Pre_cdr
                WHERE report_date_iso IN ({placeholders})
                GROUP BY report_date_iso, tl_name
                ON DUPLICATE KEY UPDATE
                    connected = VALUES(connected), not_connected = VALUES(not_connected),
                    unique_connected = VALUES(unique_connected), present_count = VALUES(present_count),
                    talk_seconds = VALUES(talk_seconds), row_count = VALUES(row_count)
                """,
                sorted(iso_dates),
            )
        conn.commit()
    finally:
        conn.close()


def verify_daily_summary(cfg: dict[str, Any], iso_dates: set[date]) -> None:
    """Fails loudly if pre_cdr_daily_summary does not match Pre_cdr for the dates this run touched.
    Compares the summed row_count per date against the raw COUNT(*) in Pre_cdr. Raises RuntimeError
    on any mismatch so a silently stale rollup (the 4-Oct gap) cannot pass as a successful import."""
    if not iso_dates:
        return
    dates = sorted(iso_dates)
    placeholders = ", ".join(["%s"] * len(dates))
    conn = connect(cfg)
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT report_date_iso, COUNT(*) FROM db_masmis.Pre_cdr WHERE report_date_iso IN ({placeholders}) GROUP BY report_date_iso",
                dates,
            )
            raw = {row[0]: int(row[1]) for row in cur.fetchall()}
            cur.execute(
                f"SELECT report_date_iso, SUM(row_count) FROM db_masmis.pre_cdr_daily_summary WHERE report_date_iso IN ({placeholders}) GROUP BY report_date_iso",
                dates,
            )
            summary = {row[0]: int(row[1] or 0) for row in cur.fetchall()}
    finally:
        conn.close()
    mismatched = [
        f"{d}: Pre_cdr={raw.get(d, 0)} summary={summary.get(d, 0)}"
        for d in dates if raw.get(d, 0) != summary.get(d, 0)
    ]
    if mismatched:
        raise RuntimeError("pre_cdr_daily_summary does not match Pre_cdr -- " + "; ".join(mismatched))


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


def to_iso_date(v: Any) -> date | None:
    """Real date object for report_date_iso (migration 448) -- mirrors fmt_date_only's own
    parsing but returns a date the DB driver can bind directly, not the 'M/D/YY' display string."""
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    s = str(v).strip()
    if not s:
        return None
    for fmt in ("%m/%d/%Y", "%m/%d/%y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


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
    skipped_records: list[tuple[int, dict[str, Any]]] = []
    rows: list[list[str | None]] = []
    row_meta: list[tuple[int, dict[str, Any]]] = []  # (row_no, raw record) parallel to `rows`
    dates_seen: set[str] = set()
    for i, rec in enumerate(records, start=2):  # row 2 = first data row (row 1 is the header)
        caller = clean_text(rec.get("CALLER"))
        if not caller:
            skipped.append(i)
            skipped_records.append((i, rec))
            continue
        values = build_row_values(rec)
        report_date_pos = [c[0] for c in COLUMN_MAP].index("report_date")
        rd = values[report_date_pos]
        if rd:
            dates_seen.add(rd)
        values.insert(report_date_pos + 1, to_iso_date(rec.get("Date")))
        rows.append(values)
        row_meta.append((i, rec))

    iso_dates_seen: set[date] = {r[report_date_pos + 1] for r in rows if r[report_date_pos + 1]} if rows else set()

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
    meta_chunks = [row_meta[i : i + args.chunk_size] for i in range(0, len(row_meta), args.chunk_size)]
    print(f"\nInserting {len(rows)} row(s) in {len(chunks)} chunk(s) of up to {args.chunk_size}, {args.workers} worker(s)...")

    inserted = 0
    errors: list[str] = []
    staged_status: list[tuple[int, dict[str, Any], str, str | None]] = []  # (row_no, record, status, error)
    for row_no, rec in skipped_records:
        staged_status.append((row_no, rec, "error", f'Row {row_no}: "CALLER" is required'))
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
                       VALUES (%s, 'Pre_cdr', %s, %s, NULL)""",
                    (batch_id, f"uploader script: {args.file.name}", inserted),
                )
        batch_conn.commit()
        print(f"Recorded upload_batch {batch_no} ({batch_id}) -- will show in the Uploader page's Recent Uploads.")
    finally:
        batch_conn.close()

    print(f"Staging {len(staged_status)} upload_batch_row record(s) so this batch is downloadable from the Uploader page...")
    write_staged_rows(cfg, batch_id, staged_status)

    if inserted > 0:
        try:
            print(f"Refreshing pre_cdr_daily_summary for {len(iso_dates_seen)} date(s)...")
            refresh_daily_summary(cfg, iso_dates_seen)
            verify_daily_summary(cfg, iso_dates_seen)
            print("pre_cdr_daily_summary verified against Pre_cdr.")
        except pymysql.err.ProgrammingError as exc:
            # 1146 = table doesn't exist -- migration 449 hasn't run yet. The real import
            # above already succeeded and committed, so this is not fatal; it is still shouted
            # on stderr so the Housing Premium totals are not silently left stale.
            print(f"WARNING: pre_cdr_daily_summary missing -- Housing Premium rollup NOT updated for these dates ({exc})", file=sys.stderr)
        except RuntimeError as exc:
            # Rollup refresh ran but disagrees with Pre_cdr: fail the run so it shows as failed.
            print(f"ERROR: {exc}", file=sys.stderr)
            sys.exit(1)

    print("Done.")


if __name__ == "__main__":
    main()
