#!/usr/bin/env python3
"""
Converts a raw Tata Tele CloudPhone "Agent Performance" datewise export (as
downloaded and unzipped by download_owner_cdr_report.py) into the column
shape upload_owner_cdr.py expects for db_masmis.Owner_cdr.

Raw export header (confirmed live against a real download, 2026-09-28):
    Date, Agent, Email ID, Intercom ID, Group, Department, Login Based
    Calling, Average Calls/Day, Average C2C Calls/Day - Outbound Answered,
    Average Inbound Calls/Day, Call Handling Rate, Total Calls, Inbound
    Calls Offered, Outbound Click to Call Attempted, "\tCalls Handled" (sic
    -- Tata Tele's own export has a literal leading tab on this one header;
    normalize_key() strips it same as everything else), Inbound Calls
    Answered, Inbound Calls Missed, Outbound Click to Call Answered,
    Available Duration, In-Call Duration, Break Duration, Inbound In-Call
    Duration, Outbound In-Call Duration, Average Call Handling Duration,
    Average Inbound Call Handling Duration, Average Outbound Call Handling
    Duration. Date is "DD-MM-YYYY" (e.g. "27-09-2026").

24 of Owner_cdr's columns exist verbatim in this raw export and pass straight
through unchanged (as clean text/number strings). The rest are computed here,
each confirmed against real existing Owner_cdr rows (db_masmis.Owner_cdr,
checked live before writing this):
    report_date/Month/Day = derived from Date ("27-09-2026" -> report_date
                 "27-Sep-26", Month "Sep", Day "27") -- matches the exact
                 "D-Mon-YY" style already stored in every existing row and
                 the regex housing-owner-dashboard.service.ts's cdrRowDate()
                 parses it with (/^(\\d{1,2})-([A-Za-z]{3})-(\\d{2})$/).
    Connected  = Calls Handled -- confirmed against an existing row (Calls
                 Handled 23, Connected 23).
    Not Connected = Total Calls - Calls Handled -- confirmed against the same
                 row (Total Calls 103, Calls Handled 23, Not Connected 80).
    Average Talk time = In-Call Duration with its leading zero stripped off
                 the hour (e.g. "00:23:56" -> "0:23:56") -- confirmed against
                 the same row (in_call_duration "00:23:56", avg_talk_time
                 "0:23:56"). Never read back by any dashboard query on its
                 own (only avg_talk_time as a whole is), so this is purely
                 cosmetic, matching upload_housing_premium_cdr.py's Talk Time
                 precedent.
    TL Name/AM = looked up from db_masmis.owner_agent_details by Agent (its
                 "overall" column holds the agent's name) -- Tata Tele's own
                 export has no organisational columns at all. An Agent not on
                 that roster is left blank (None), never guessed. (The app's
                 own dashboard queries also prefer this roster over whatever
                 Owner_cdr.tl_name/am says when the agent IS on the roster --
                 see housing-owner-dashboard.service.ts's "roster-first"
                 resolve() -- so populating it here is a courtesy for anyone
                 reading Owner_cdr directly, not load-bearing for the
                 dashboard itself.)
    last       = the last whitespace-separated token of Agent's name (e.g.
                 "Krishna Kumar MCN" -> "MCN") -- confirmed against multiple
                 existing rows; appears to be each agent's branch/process
                 code suffix.
    UID        = <Excel serial date>+<Agent name>, no separator (e.g.
                 "46290Krishna Kumar MCN") -- matches the exact style of
                 every existing Owner_cdr row's own UID (see
                 owner-cdr-bulk.service.ts's docstring). The importer only
                 requires it non-empty; this format is reproduced purely so
                 rows from this script don't look out of place next to
                 already-existing ones.

Rows with Total Calls = 0 are never imported (user instruction, 2026-09-28,
after the very first real import put 178 rows into Owner_cdr for 27-Sep-26
and 137 of them turned out to have Total Calls = 0 -- an agent not active on
this process that day is not meaningful activity for this table). Those 137
rows were deleted from Owner_cdr by hand once (this filter did not exist
yet when they were imported); every run from here on skips them before they
ever reach the database.

IMPORTANT -- this Tata Tele CloudPhone account is shared across several
unrelated campaigns/companies, not just Housing Owner: a real export was
found to contain 440 agents, of which only 59 (the ones whose name ends in
"MCN") belong to Housing Owner -- the other 381 carry suffixes like SKM, OC,
RM, ileads, etc. and belong to entirely different processes. Confirmed live:
every one of the 53 distinct agents already in db_masmis.Owner_cdr ends in
"MCN" (100%, checked against the whole table, not a sample). This script
therefore only keeps rows whose Agent name ends in "MCN" (case-insensitive)
-- everything else is silently out of scope for this table, not a data
error, and is reported as a count so a change in that convention would be
noticed rather than silently importing rows that don't belong here.

Usage:
    py convert_owner_cdr_export.py <raw_export.xlsx> [--out PATH]
"""
from __future__ import annotations

import argparse
import re
import sys
from datetime import date, datetime
from pathlib import Path

from openpyxl import Workbook, load_workbook

sys.path.insert(0, str(Path(__file__).parent))
from upload_owner_cdr import connect, load_db_config  # noqa: E402

EXCEL_EPOCH = date(1899, 12, 30)  # Excel's own (leap-year-bug) date-serial epoch

OUTPUT_HEADER = [
    "UID", "Date", "Agent", "Email ID", "Intercom ID", "Group", "Department", "Login Based Calling",
    "Average Calls/Day", "Average C2C Calls/Day - Outbound Answered", "Average Inbound Calls/Day",
    "Call Handling Rate", "Total Calls", "Inbound Calls Offered", "Outbound Click to Call Attempted",
    "Calls Handled", "Inbound Calls Answered", "Inbound Calls Missed", "Outbound Click to Call Answered",
    "Available Duration", "In-Call Duration", "Break Duration", "Inbound In-Call Duration",
    "Outbound In-Call Duration", "Average Call Handling Duration", "Average Inbound Call Handling Duration",
    "Average Outbound Call Handling Duration", "Not Connected", "Connected", "TL Name",
    "Average Talk time", "Month", "Day", "last", "AM",
]

MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def normalize_key(k: str) -> str:
    return re.sub(r"[^a-z0-9]", "", k.lower())


def load_roster() -> dict[str, tuple[str | None, str | None]]:
    """agent_name (normalized) -> (tl_name, am), from the live, user-editable
    db_masmis.owner_agent_details roster (its "overall" column holds the
    agent's name -- confirmed live: "Sameer Rawat MCN" there matches
    Owner_cdr.agent "Sameer Rawat MCN" exactly)."""
    cfg = load_db_config()
    conn = connect(cfg)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT overall, tl_name, am FROM db_masmis.owner_agent_details")
            rows = cur.fetchall()
    finally:
        conn.close()
    return {normalize_key(r[0]): (r[1], r[2]) for r in rows if r[0]}


def parse_date(v: object) -> date | None:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    s = str(v).strip()
    if not s:
        return None
    for fmt in ("%d-%m-%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def excel_serial(d: date) -> int:
    return (d - EXCEL_EPOCH).days


def to_num(v: object) -> float:
    if v is None:
        return 0.0
    try:
        return float(str(v).strip() or 0)
    except ValueError:
        return 0.0


def clean_number_str(v: object) -> str:
    n = to_num(v)
    return str(int(n)) if n.is_integer() else str(n)


def strip_leading_zero_hour(duration: object) -> str | None:
    """'00:23:56' -> '0:23:56'; '12:03:04' -> '12:03:04' (only the FIRST
    leading zero of a 2-digit hour is stripped, matching the observed style
    -- hours never reach double digits for a single day's talk time anyway)."""
    s = str(duration or "").strip()
    m = re.match(r"^0?(\d{1,2}):(\d{2}):(\d{2})$", s)
    if not m:
        return s or None
    return f"{int(m.group(1))}:{m.group(2)}:{m.group(3)}"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("file", type=Path, help="Raw Tata Tele 'datewise agent performance' export (.xlsx)")
    ap.add_argument("--out", type=Path, default=None, help="Output path (default: alongside input, _converted suffix)")
    args = ap.parse_args()
    if not args.file.exists():
        sys.exit(f"File not found: {args.file}")
    out_path = args.out or args.file.with_name(args.file.stem + "_converted.xlsx")

    print("Loading agent roster (Agent -> TL/AM) from the live database...")
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

    unmatched_agents: set[str] = set()
    blank_agent = 0
    out_of_scope = 0
    zero_calls = 0
    out_of_month = 0
    out_rows: list[list[object]] = []
    for r in raw_rows:
        agent = col(r, "Agent")
        if not agent or not str(agent).strip():
            blank_agent += 1
            continue
        agent = str(agent).strip()
        if not agent.upper().endswith("MCN"):
            out_of_scope += 1
            continue
        if to_num(col(r, "Total Calls")) == 0:
            # User-confirmed rule (2026-09-28): an agent with zero calls that
            # day (not logged in, off that process for the day, etc.) is not
            # meaningful activity -- 137 of 178 rows in the very first real
            # import were exactly this, and importing them was explicitly
            # asked to be undone. Never imported going forward.
            zero_calls += 1
            continue

        d = parse_date(col(r, "Date"))
        now = datetime.now()
        if d is None or (d.year, d.month) != (now.year, now.month):
            out_of_month += 1
            continue
        report_date = f"{d.day}-{MONTH_ABBR[d.month - 1]}-{d.strftime('%y')}"
        month = MONTH_ABBR[d.month - 1] if d else None
        day = str(d.day) if d else None
        uid = f"{excel_serial(d)}{agent}" if d else agent

        total_calls = to_num(col(r, "Total Calls"))
        calls_handled = to_num(col(r, "Calls Handled"))
        connected = int(calls_handled)
        not_connected = int(total_calls - calls_handled)

        tl_name, am = roster.get(normalize_key(agent), (None, None))
        if normalize_key(agent) not in roster:
            unmatched_agents.add(agent)
        last_val = agent.split()[-1] if agent else None

        out_rows.append([
            uid, report_date, agent, col(r, "Email ID"), col(r, "Intercom ID"), col(r, "Group"),
            col(r, "Department"), col(r, "Login Based Calling"),
            clean_number_str(col(r, "Average Calls/Day")),
            clean_number_str(col(r, "Average C2C Calls/Day - Outbound Answered")),
            clean_number_str(col(r, "Average Inbound Calls/Day")),
            col(r, "Call Handling Rate"), clean_number_str(total_calls),
            clean_number_str(col(r, "Inbound Calls Offered")),
            clean_number_str(col(r, "Outbound Click to Call Attempted")),
            clean_number_str(calls_handled),
            clean_number_str(col(r, "Inbound Calls Answered")),
            clean_number_str(col(r, "Inbound Calls Missed")),
            clean_number_str(col(r, "Outbound Click to Call Answered")),
            col(r, "Available Duration"), col(r, "In-Call Duration"), col(r, "Break Duration"),
            col(r, "Inbound In-Call Duration"), col(r, "Outbound In-Call Duration"),
            col(r, "Average Call Handling Duration"), col(r, "Average Inbound Call Handling Duration"),
            col(r, "Average Outbound Call Handling Duration"),
            str(not_connected), str(connected), tl_name,
            strip_leading_zero_hour(col(r, "In-Call Duration")), month, day, last_val, am,
        ])
    wb.close()

    if unmatched_agents:
        print(f"\n  {len(unmatched_agents)} Agent(s) not found in owner_agent_details (TL/AM left blank, not guessed):")
        for a in sorted(unmatched_agents):
            print(f"    - {a}")
    if blank_agent:
        print(f"\n  {blank_agent} row(s) skipped (blank Agent).")
    print(f"  {out_of_scope} row(s) skipped (Agent name does not end in 'MCN' -- belongs to a different "
          f"process sharing this Tata Tele account, not Housing Owner).")
    print(f"  {zero_calls} row(s) skipped (Total Calls = 0 -- not imported, per user instruction 2026-09-28).")
    print(f"  {out_of_month} row(s) skipped (outside the current month -- only the current month is imported).")

    print(f"\nWriting {out_path} ...")
    out_wb = Workbook()
    out_ws = out_wb.active
    out_ws.title = "Owner CDR"
    out_ws.append(OUTPUT_HEADER)
    for row in out_rows:
        out_ws.append(row)
    out_wb.save(out_path)
    print(f"Done: {len(out_rows)} row(s) written.")
    print(out_path.resolve())


if __name__ == "__main__":
    main()
