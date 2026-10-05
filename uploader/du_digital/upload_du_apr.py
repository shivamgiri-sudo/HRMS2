#!/usr/bin/env python3
"""
Direct-to-database loader for DU Digital's APR (Agent Performance Report)
export into du_apr_daily_actual -- mirrors backend/src/modules/bulk-upload/
du-apr-daily-bulk.service.ts's importBatch() exactly (same parsing, same
table, same dashboard_label split), the fast-path pattern this repo's other
uploader/ scripts already use for the web Uploader page's slower chunked-
insert path.

Accepts the file EITHER in the backend importer's own expected shape
(Date, Agent, Agent_ID, Calls, Login_Seconds, Net_Login_Seconds, Talk_Seconds,
Idle_Seconds, Wrapup_Seconds, Break_Seconds, Dead_Seconds, Utilization_Pct,
Week) OR the raw vicidial "APR Raw" export shape (Date, USER, ID, CALLS,
LOGINTIME, WAIT, TALK, DISPO, Break, DEAD, "Utilization %", "Net login",
Week...) -- the column rename table below maps the latter onto the former,
so download_du_apr.py's raw output can be uploaded as-is with no separate
"convert" step. Duration values are accepted as day-fraction decimals (the
raw export's own format) or plain seconds, per parse_seconds_flexible.

Idempotency: du_apr_daily_actual's own UNIQUE KEY includes source_reference,
which this script sets to a stable "du_digital_auto" tag (not a fresh UUID
per run, unlike the web UI's batch id) -- but that alone does not stop a
second run from re-inserting under a *different* source_reference, so this
script ALSO refuses to import a date that already has ANY rows for this
process+dashboard unless --force is passed, the same explicit-pre-check
pattern housing_premium/upload_housing_premium_cdr.py uses, for the same
reason: the schema's own key cannot be trusted alone to prevent duplicates
across unrelated upload sources.

Usage:
    py upload_du_apr.py <file.xlsx> --country KOREA|THAILAND [--force] [--dry-run]
"""
from __future__ import annotations

import argparse
import sys
import uuid
from pathlib import Path
from typing import Any

from openpyxl import load_workbook

sys.path.insert(0, str(Path(__file__).resolve().parent))
from du_common import (  # noqa: E402
    connect, get_process_id, load_db_config, parse_count, parse_excel_date,
    parse_seconds_flexible, parse_utilization_pct, write_staged_rows, write_upload_batch,
)

UPLOAD_TYPE_CODE = {"KOREA": "DU_APR_KOREA", "THAILAND": "DU_APR_THAILAND"}

# Raw "APR Raw" header -> the backend importer's own expected header. Headers are matched
# case/space-insensitively (normalize_key), so "TALK" and "Talk" are the same key either way.
RAW_TO_IMPORTER_HEADER = {
    "USER": "Agent",
    "ID": "Agent_ID",
    "CALLS": "Calls",
    "LOGINTIME": "Login_Seconds",
    "NETLOGIN": "Net_Login_Seconds",
    "TALK": "Talk_Seconds",
    "WAIT": "Idle_Seconds",
    "DISPO": "Dispo_Seconds",  # not stored (no column for it); kept only for visibility if inspected
    "DEAD": "Dead_Seconds",
    "BREAK": "Break_Seconds",
    "UTILIZATION": "Utilization_Pct",
    "WEEKWISE": "Week",
}


def normalize_key(k: str) -> str:
    return "".join(ch for ch in k.lower() if ch.isalnum())


def read_rows(path: Path) -> list[dict[str, Any]]:
    """For .csv: the live "Agent Time Detail" file download (confirmed live 2026-10-01,
    download_apr_thailand.py's own output) is NOT a plain table -- it has a 3-line report
    title/time-range preamble before the real header row, a trailing "TOTALS" aggregate
    row mixed in with the per-agent rows, and durations as HH:MM:SS text rather than the
    Excel-pasted "APR Raw" sheet's day-fraction decimals (parse_seconds_flexible already
    handles both). It also has NO Date column at all -- the whole file is already scoped
    to one day by the report's own date-range filter, so main() supplies --date instead.
    This finds the real header row (the first one containing both "USER" and "CALLS",
    case/space-insensitive) and skips the TOTALS row and any blank/preamble lines."""
    lower = path.suffix.lower()
    if lower == ".csv":
        import csv
        with path.open(encoding="utf-8-sig", newline="") as f:
            all_rows = list(csv.reader(f))
        header_idx = next(
            (i for i, r in enumerate(all_rows) if {normalize_key(c) for c in r} >= {"user", "calls"}),
            None,
        )
        if header_idx is None:
            return []
        header = [str(h).strip() for h in all_rows[header_idx]]
        out = []
        for r in all_rows[header_idx + 1:]:
            if not r or all(not str(c).strip() for c in r):
                continue
            if str(r[0]).strip().upper() == "TOTALS":
                continue
            out.append({header[i]: r[i] for i in range(len(header)) if i < len(r)})
        return out
    wb = load_workbook(path, read_only=True, data_only=True)
    ws = wb[wb.sheetnames[0]]
    rows_iter = ws.iter_rows(values_only=True)
    header = [str(h) if h is not None else "" for h in next(rows_iter)]
    out = []
    for raw in rows_iter:
        if raw is None or all(v is None for v in raw):
            continue
        out.append({header[i]: raw[i] for i in range(len(header)) if i < len(raw)})
    wb.close()
    return out


def mapped_value(record: dict[str, Any], *candidates: str) -> Any:
    """Case/space-insensitive lookup across the record's own real headers,
    trying each candidate name in order (the importer's own name first, then
    the raw export's name) -- so either file shape just works.

    Keeps the FIRST occurrence when two real headers normalize to the same key --
    confirmed live 2026-10-01: the "Agent Time Detail" CSV download pairs a raw
    duration column with its own "X %" percentage-of-total column right after it
    (WAIT, WAIT %, TALK, TALK TIME %, ...), and stripping spaces/% for matching
    makes "WAIT" and "WAIT %" collide to the same normalized key. A naive
    last-write-wins dict comprehension silently replaced WAIT's real duration
    with WAIT %'s percentage string, which parse_seconds_flexible then read as
    0 -- caught by a dry-run mismatch against the source file's own WAIT value."""
    norm: dict[str, Any] = {}
    for k, v in record.items():
        nk = normalize_key(k)
        if nk not in norm:
            norm[nk] = v
    for c in candidates:
        v = norm.get(normalize_key(c))
        if v is not None and str(v).strip() != "":
            return v
    return None


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("file", type=Path)
    ap.add_argument("--country", required=True, choices=["KOREA", "THAILAND"])
    ap.add_argument("--force", action="store_true", help="Import even if rows already exist for a date in range")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--date", help="YYYY-MM-DD, required when the file has no Date column (the live CSV download shape)")
    args = ap.parse_args()
    file_date = parse_excel_date(args.date) if args.date else None

    if not args.file.exists():
        sys.exit(f"File not found: {args.file}")

    print(f"Reading {args.file} ...")
    records = read_rows(args.file)
    print(f"  {len(records)} data row(s) read.")

    cfg = load_db_config()
    process_id = get_process_id(cfg)

    rows: list[tuple[str, Any]] = []
    staged: list[tuple[int, dict[str, Any], str, str | None]] = []
    dates_seen: set[str] = set()
    for i, rec in enumerate(records, start=2):
        # "USER NAME" is the Korea ASCII-table report's own header (confirmed live
        # 2026-10-01); "ID" in that same report is fixed-width truncated (e.g.
        # "Agent700" for both Agent7004 and Agent7005) so it is never used for identity,
        # only as the lower-priority Agent_ID fallback below.
        agent = mapped_value(rec, "Agent", "USER NAME", "USER")
        agent_name = str(agent).strip() if agent else ""
        if agent_name.upper() == "TOTALS":
            continue
        call_date = parse_excel_date(mapped_value(rec, "Date")) or file_date
        if not agent_name or not call_date:
            msg = f'Row {i}: "Agent"/"Date" is required and must be readable (pass --date for a file with no Date column)'
            staged.append((i, rec, "error", msg))
            continue
        iso_date = call_date.isoformat()
        dates_seen.add(iso_date)
        # Break_Seconds: Thailand's export has one combined "Break" column; Korea's
        # ASCII table instead splits it into "Lunch" + "ShortB" with no combined total
        # (confirmed live 2026-10-01) -- summed here so both shapes land in the same field.
        break_sec = parse_seconds_flexible(mapped_value(rec, "Break_Seconds", "Break"))
        if break_sec == 0:
            break_sec = parse_seconds_flexible(mapped_value(rec, "Lunch")) + parse_seconds_flexible(mapped_value(rec, "ShortB"))
        rows.append((iso_date, {
            "agent_name": agent_name,
            "agent_code": (str(mapped_value(rec, "Agent_ID", "ID") or "").strip() or None),
            "calls": parse_count(mapped_value(rec, "Calls", "CALLS")),
            "login_sec": parse_seconds_flexible(mapped_value(rec, "Login_Seconds", "LOGIN TIME", "LOGINTIME")),
            "net_login_sec": parse_seconds_flexible(mapped_value(rec, "Net_Login_Seconds", "Net login")),
            "talk_sec": parse_seconds_flexible(mapped_value(rec, "Talk_Seconds", "TALK")),
            "idle_sec": parse_seconds_flexible(mapped_value(rec, "Idle_Seconds", "WAIT")),
            "wrapup_sec": parse_seconds_flexible(mapped_value(rec, "Wrapup_Seconds", "DISPO")),
            "break_sec": break_sec,
            "dead_sec": parse_seconds_flexible(mapped_value(rec, "Dead_Seconds", "DEAD")),
            "util_pct": parse_utilization_pct(mapped_value(rec, "Utilization_Pct", "Utilization %")),
            "week": (str(mapped_value(rec, "Week", "Week wise") or "").strip() or None),
        }))
        staged.append((i, rec, "valid", None))

    print(f"  {len(rows)} row(s) valid, {len(staged) - len(rows)} skipped.")
    if dates_seen:
        print(f"  dates present: {sorted(dates_seen)}")

    if args.dry_run:
        print("\n--dry-run: nothing written. First 3 mapped rows:")
        for _, r in rows[:3]:
            print(r)
        return

    conn = connect(cfg)
    try:
        with conn.cursor() as cur:
            if dates_seen and not args.force:
                placeholders = ", ".join(["%s"] * len(dates_seen))
                cur.execute(
                    f"""SELECT COUNT(*) FROM db_masmis.du_apr_daily_actual
                         WHERE process_id = %s AND dashboard_label = %s AND call_date IN ({placeholders})""",
                    [process_id, args.country, *sorted(dates_seen)],
                )
                existing = cur.fetchone()[0]
                if existing > 0:
                    sys.exit(
                        f"Refusing to import: {existing} row(s) already exist for {args.country} on these date(s). "
                        f"Re-run with --force if this is intentional."
                    )
    finally:
        conn.close()

    batch_id = str(uuid.uuid4())
    imported = 0
    conn = connect(cfg)
    try:
        with conn.cursor() as cur:
            for iso_date, r in rows:
                cur.execute(
                    """INSERT INTO db_masmis.du_apr_daily_actual
                         (id, process_id, dashboard_label, agent_name, agent_code, call_date, total_calls,
                          login_seconds, net_login_seconds, talk_seconds, idle_seconds, wrapup_seconds,
                          break_seconds, dead_seconds, utilization_pct, week_label,
                          data_source, source_reference, created_by)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'bulk_upload', %s, NULL)
                       ON DUPLICATE KEY UPDATE
                         agent_code = VALUES(agent_code), total_calls = VALUES(total_calls),
                         login_seconds = VALUES(login_seconds), net_login_seconds = VALUES(net_login_seconds),
                         talk_seconds = VALUES(talk_seconds), idle_seconds = VALUES(idle_seconds),
                         wrapup_seconds = VALUES(wrapup_seconds), break_seconds = VALUES(break_seconds),
                         dead_seconds = VALUES(dead_seconds), utilization_pct = VALUES(utilization_pct),
                         week_label = VALUES(week_label)""",
                    (str(uuid.uuid4()), process_id, args.country, r["agent_name"], r["agent_code"], iso_date,
                     r["calls"], r["login_sec"], r["net_login_sec"], r["talk_sec"], r["idle_sec"],
                     r["wrapup_sec"], r["break_sec"], r["dead_sec"], r["util_pct"], r["week"],
                     "du_digital_auto"),
                )
                imported += 1
        conn.commit()
    finally:
        conn.close()

    print(f"Imported {imported}/{len(rows)} row(s) into du_apr_daily_actual ({args.country}).")

    batch_id = write_upload_batch(
        cfg, UPLOAD_TYPE_CODE[args.country], "du_apr_daily_actual", args.file.name, args.file.stat().st_size,
        len(records), len(rows), imported, len(staged) - len(rows),
    )
    write_staged_rows(cfg, batch_id, staged)
    print(f"Recorded upload_batch {batch_id} -- will show in the Uploader page's Recent Uploads.")


if __name__ == "__main__":
    main()
