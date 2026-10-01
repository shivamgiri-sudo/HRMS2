#!/usr/bin/env python3
"""
Converts a raw IDCloud "Agent Wise Performance" CSV export (as downloaded by
download_lp_feedback_report.py --report apr) into the column shape
upload_lp_feedback_apr.py expects for db_masmis.lp_feedback_apr.

Real export header (confirmed live, 2026-09-28):
    CalLDate, [Interval], Agent, LoginId, [Total Calls], [Dialer Calls],
    [Outbound Calls], [Manual Calls], [Transfered Calls], [Login Time],
    [Net LoginTime], [Break Count], [Tea], [Lunch], [Meeting], [BIO Break],
    [Unsolicted], [Total Break Duration], [Handle Duration],
    [Average Handle Duration], [Idle Duration], [Average Idle Duration],
    [Idle Block Duration], [Ring Duration], [Average Ring Duration],
    [Talk Duration], [Average Talk Duration], [Hold Duration],
    [Average Hold Duration], [Wrapup Duration], [Average Wrapup Duration]
All 30 non-derived columns exist verbatim (the bracket-wrapped header names
normalize identically to the app's own expected "Total_Calls" etc -- both
reduce to "totalcalls" once non-alphanumeric characters are stripped, same
normalize_key() every bulk-upload service in this app already uses) and pass
straight through unchanged.

Two things ARE derived here:
    report_date = the first half of CalLDate, which the export always
                 writes as a "<date> - <date>" range even for a single day
                 (e.g. "2026-09-26 - 2026-09-26") -- reformatted to
                 "D-Mon-YY" (e.g. "26-Sep-26") to match every existing
                 lp_feedback_apr row's own report_date convention.
    (trailing "Summary" row dropped) -- the export's last row is always an
                 aggregate totals row with Agent/LoginId = "NOAGENT" (or the
                 first cell literally "Summary") -- not a real agent-day, so
                 never imported, the same way Owner_cdr's zero-call rows are
                 dropped by convert_owner_cdr_export.py.

Usage:
    py convert_lp_feedback_apr.py <raw_export.csv> [--out PATH]
"""
from __future__ import annotations

import argparse
import csv
import re
import sys
from pathlib import Path

OUTPUT_HEADER = [
    "CalLDate", "Interval", "Agent", "LoginId", "Total_Calls", "Dialer_Calls", "Outbound_Calls",
    "Manual_Calls", "Transfered_Calls", "Login_Time", "Net_LoginTime", "Break_Count", "Tea", "Lunch",
    "Meeting", "BIO_Break", "Unsolicted", "Total_Break_Duration", "Handle_Duration",
    "Average_Handle_Duration", "Idle_Duration", "Average_Idle_Duration", "Idle_Block_Duration",
    "Ring_Duration", "Average_Ring_Duration", "Talk_Duration", "Average_Talk_Duration", "Hold_Duration",
    "Average_Hold_Duration", "Wrapup_Duration", "Average_Wrapup_Duration",
]

MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def normalize_key(k: str) -> str:
    return re.sub(r"[^a-z0-9]", "", k.lower())


def report_date_from_calldate(raw: str) -> str | None:
    """'2026-09-26 - 2026-09-26' -> '26-Sep-26'. Only the first date is used
    (both halves are always identical for a single-day export)."""
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", raw.strip())
    if not m:
        return None
    year, month, day = m.groups()
    return f"{int(day)}-{MONTH_ABBR[int(month) - 1]}-{year[2:]}"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("file", type=Path, help="Raw IDCloud Agent Wise Performance export (.csv)")
    ap.add_argument("--out", type=Path, default=None, help="Output path (default: alongside input, _converted suffix)")
    args = ap.parse_args()
    if not args.file.exists():
        sys.exit(f"File not found: {args.file}")
    out_path = args.out or args.file.with_name(args.file.stem + "_converted.csv")

    print(f"Reading {args.file} ...")
    with args.file.open(encoding="utf-8-sig", newline="") as f:
        rows = list(csv.reader(f))
    if not rows:
        sys.exit("File is empty.")
    header, data_rows = rows[0], rows[1:]
    by_norm = {normalize_key(h): i for i, h in enumerate(header)}

    def col(row: list[str], name: str) -> str:
        idx = by_norm.get(normalize_key(name))
        return row[idx].strip() if idx is not None and idx < len(row) else ""

    print(f"  {len(data_rows)} data row(s).")

    summary_rows = 0
    bad_date = 0
    out_rows: list[list[str]] = []
    for row in data_rows:
        agent = col(row, "Agent")
        if not agent or agent.upper() == "NOAGENT" or (row and row[0].strip().lower() == "summary"):
            summary_rows += 1
            continue

        report_date = report_date_from_calldate(col(row, "CalLDate"))
        if report_date is None:
            bad_date += 1

        out_rows.append([
            report_date, col(row, "Interval"), agent, col(row, "LoginId"),
            col(row, "Total Calls"), col(row, "Dialer Calls"), col(row, "Outbound Calls"),
            col(row, "Manual Calls"), col(row, "Transfered Calls"), col(row, "Login Time"),
            col(row, "Net LoginTime"), col(row, "Break Count"), col(row, "Tea"), col(row, "Lunch"),
            col(row, "Meeting"), col(row, "BIO Break"), col(row, "Unsolicted"),
            col(row, "Total Break Duration"), col(row, "Handle Duration"),
            col(row, "Average Handle Duration"), col(row, "Idle Duration"),
            col(row, "Average Idle Duration"), col(row, "Idle Block Duration"), col(row, "Ring Duration"),
            col(row, "Average Ring Duration"), col(row, "Talk Duration"), col(row, "Average Talk Duration"),
            col(row, "Hold Duration"), col(row, "Average Hold Duration"), col(row, "Wrapup Duration"),
            col(row, "Average Wrapup Duration"),
        ])

    print(f"  {summary_rows} row(s) skipped (Summary/NOAGENT aggregate row, not a real agent).")
    if bad_date:
        print(f"  WARNING: {bad_date} row(s) had a CalLDate this script could not parse -- report_date left blank for those.")

    print(f"\nWriting {out_path} ...")
    with out_path.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(OUTPUT_HEADER)
        w.writerows(out_rows)
    print(f"Done: {len(out_rows)} row(s) written.")
    print(out_path.resolve())


if __name__ == "__main__":
    main()
