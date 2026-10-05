#!/usr/bin/env python3
"""
Converts a raw CallerDesk "Call Logs" export (as downloaded by
download_callerdesk_report.py) into the same column shape
upload_housing_premium_cdr.py already expects, so that already-tested
importer can be reused unchanged for the actual database load.

Raw CallerDesk export header (confirmed live against a real download):
    S.NO., DESK PHONE, CALLER, MEMBER NO., Call Group, MEMBER, End Time,
    DURATION, STATUS, CIRCLE, FILE, Routing Numbers, Routing Status,
    Call Result, Key, Coins, Leg 1 & Leg 2 Details, Routing Error Code,
    Cparty Numbers, Cparty Name, Cparty Call Status, Channel, Talk Duration,
    Ringing Duration, Caller Name, Comment, Start Time, ... (more columns
    the earlier hand-prepared files never had and Pre_cdr has no column for).

10 of Pre_cdr's 19 columns already exist verbatim in this raw export
(CALLER, MEMBER, End Time, DURATION, STATUS, Routing Numbers, Routing
Status, Talk Duration, Ringing Duration, Start Time) and pass straight
through. The other 9 are computed here, each cross-checked against how the
existing hand-prepared files ("1-5 cdr.xlsx" etc, already verified in
Pre_cdr) actually used them:
    Date       = the date part of End Time.
    Time       = the hour part of End Time.
    TL Name/TL = looked up from db_masmis.pre_agent_details by MEMBER (the
                 agent's name) -- this raw export has no TL column at all.
                 A MEMBER not found in that roster is left blank (None),
                 never guessed.
    Count      = '1' for the FIRST row of a given (MEMBER, date) pair *in
                 the file's own row order*, else '0' -- confirmed against
                 an existing Pre_cdr row group: the file lists a member's
                 calls newest-first, and it was the newest (first-listed)
                 row of the day that carried Count=1, not the
                 chronologically-earliest one. Feeds "Present Count" (an
                 agent-day flag) downstream, so this ordering match matters.
    UniqueCount= same idea, grouped by (CALLER, date) instead of member --
                 "first call from this phone number that day", matching
                 this file's own docstring precedent in
                 upload_housing_premium_cdr.py.
    Date row Ct= a running 1.. counter over rows sharing the same date, in
                 file order -- purely an ordinal, no lookup needed.
    V+W        = equal to DURATION in every existing sample row checked.
    Talk Time  = Talk Duration seconds re-expressed as an H:MM time value
                 (this column is never read back by any dashboard query --
                 only the numeric Talk Duration column is -- so it is
                 cosmetic, matching the note already in
                 upload_housing_premium_cdr.py).

End Time/Start Time/Date are written as real Python datetime/date objects
(not pre-formatted strings) so that upload_housing_premium_cdr.py's own
fmt_datetime()/fmt_date_only() -- which only special-case real datetime/date
objects -- format them correctly when it re-reads this file; a plain string
would just pass through unchanged and silently keep the wrong shape.

Usage:
    py convert_callerdesk_export.py <raw_callerdesk_export.xlsx> [--out PATH]
"""
from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from datetime import datetime, time as dt_time
from pathlib import Path

import json

from openpyxl import Workbook, load_workbook

sys.path.insert(0, str(Path(__file__).parent))
from upload_housing_premium_cdr import connect, load_db_config, normalize_key  # noqa: E402

FALLBACK_ROSTER_PATH = Path(__file__).parent / "housing_premium_tl_roster.json"

OUTPUT_HEADER = [
    "CALLER", "MEMBER", "End Time", "DURATION", "STATUS", "Routing Numbers", "Routing Status",
    "Talk Duration", "Ringing Duration", "Start Time", "Time", "Date", "TL Name", "Count",
    "Unique Count", "Date row Count", "V+W", "Talk Time", "TL",
]


def load_roster() -> dict[str, str]:
    """agent_name (normalized) -> tl_name.

    Primary source is the live db_masmis.pre_agent_details roster. Names it
    doesn't cover (confirmed live: 8 real agents -- Abhishek MCN, Anjali
    Gupta, Arish, Ayush Singh, Md Umar shad Ansari, Muskan Bharti, Rishi
    Kumar, Shubham Upadhyay -- all genuinely belong to TL "OJT" per the
    user's own MEMBER/TL sheet, 2026-09-27) fall back to
    housing_premium_tl_roster.json, so the daily unattended run resolves
    them the same way the first few manual runs did by hand, without a
    separate manual fix-up UPDATE each time. A name in neither source is
    still left blank -- never guessed."""
    cfg = load_db_config()
    conn = connect(cfg)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT agent_name, tl_name FROM db_masmis.pre_agent_details")
            rows = cur.fetchall()
    finally:
        conn.close()
    roster = {normalize_key(r[0]): r[1] for r in rows if r[0]}

    if FALLBACK_ROSTER_PATH.exists():
        fallback = json.loads(FALLBACK_ROSTER_PATH.read_text(encoding="utf-8")).get("agents", {})
        for name, tl in fallback.items():
            key = normalize_key(name)
            if key not in roster:
                roster[key] = tl
    return roster


def parse_dt(v: object) -> datetime | None:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v
    s = str(v).strip()
    if not s:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%d-%m-%Y %H:%M:%S"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


def to_num(v: object) -> float:
    if v is None:
        return 0.0
    try:
        return float(str(v).strip() or 0)
    except ValueError:
        return 0.0


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("file", type=Path, help="Raw CallerDesk call-logs export (.xlsx)")
    ap.add_argument("--out", type=Path, default=None, help="Output path (default: alongside input, _converted suffix)")
    args = ap.parse_args()
    if not args.file.exists():
        sys.exit(f"File not found: {args.file}")
    out_path = args.out or args.file.with_name(args.file.stem + "_converted.xlsx")

    print("Loading agent roster (MEMBER -> TL) from the live database...")
    roster = load_roster()
    print(f"  {len(roster)} agents in roster.")

    print(f"Reading {args.file} ...")
    wb = load_workbook(args.file, read_only=True, data_only=True)
    ws = wb[wb.sheetnames[0]]
    rows_iter = ws.iter_rows(values_only=True)
    header = next(rows_iter)
    by_norm = {normalize_key(str(h)): i for i, h in enumerate(header) if h is not None}

    def col(row: tuple, name: str):
        idx = by_norm.get(normalize_key(name))
        return row[idx] if idx is not None and idx < len(row) else None

    raw_rows = [r for r in rows_iter if r is not None and any(v is not None for v in r)]
    print(f"  {len(raw_rows)} data row(s).")

    member_date_seen: dict[tuple[str, str], bool] = {}
    caller_date_seen: dict[tuple[str, str], bool] = {}
    date_row_counter: dict[str, int] = defaultdict(int)
    unmatched_members: set[str] = set()

    out_rows: list[list[object]] = []
    for r in raw_rows:
        caller = col(r, "CALLER")
        member = col(r, "MEMBER")
        end_dt = parse_dt(col(r, "End Time"))
        duration = to_num(col(r, "DURATION"))
        talk_duration = to_num(col(r, "Talk Duration"))

        date_key = end_dt.strftime("%Y-%m-%d") if end_dt else ""
        member_key = (normalize_key(str(member or "")), date_key)
        caller_key = (str(caller or "").strip(), date_key)

        count_flag = 0 if member_date_seen.get(member_key) else 1
        member_date_seen[member_key] = True
        unique_flag = 0 if caller_date_seen.get(caller_key) else 1
        caller_date_seen[caller_key] = True
        if date_key:
            date_row_counter[date_key] += 1

        tl_name = roster.get(normalize_key(str(member or "")))
        if member and tl_name is None:
            unmatched_members.add(str(member))

        talk_minutes_total = int(round(talk_duration / 60))
        talk_time_val = dt_time(hour=min(talk_minutes_total // 60, 23), minute=talk_minutes_total % 60)

        out_rows.append([
            caller, member, end_dt, col(r, "DURATION"), col(r, "STATUS"),
            col(r, "Routing Numbers"), col(r, "Routing Status"), col(r, "Talk Duration"), col(r, "Ringing Duration"),
            parse_dt(col(r, "Start Time")), (end_dt.hour if end_dt else None), (end_dt.date() if end_dt else None),
            tl_name, count_flag, unique_flag, date_row_counter.get(date_key, None), duration, talk_time_val, tl_name,
        ])
    wb.close()

    if unmatched_members:
        print(f"\n  {len(unmatched_members)} MEMBER name(s) not found in the roster (TL left blank for these, not guessed):")
        for m in sorted(unmatched_members):
            print(f"    - {m}")

    print(f"\nWriting {out_path} ...")
    out_wb = Workbook()
    out_ws = out_wb.active
    out_ws.title = "Call-Logs"
    out_ws.append(OUTPUT_HEADER)
    for row in out_rows:
        out_ws.append(row)
    out_wb.save(out_path)
    print(f"Done: {len(out_rows)} row(s) written.")
    print(out_path.resolve())


if __name__ == "__main__":
    main()
