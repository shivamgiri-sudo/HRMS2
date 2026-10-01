#!/usr/bin/env python3
"""
Converts a raw IDCloud "Call Register" CSV export (as downloaded by
download_lp_onboarding_report.py --report cdr) into the column shape
upload_lp_onboarding_cdr.py expects for db_masmis.lp_onboarding_cdr.

Real export header (confirmed live, 2026-09-28):
    S. No., Date, Interval, Call Number, Service, Agent, Login Id,
    Start Time, End Time, Extension, Remarks, Customer Name, Dni, Cli,
    Desposition, Lead Id, Batch, Dialer Type, Duration, Ivr Duration,
    Ring Duration, Talk Duration, Wrapup Duration, Hold Duration,
    Call Status, Hangup By, Child CallNumbr, Ivr Terminal
"Customer Name" has no home in lp_onboarding_cdr and is dropped. Everything
else normalizes onto the app's own expected headers the same
normalize-and-strip way every bulk-upload service in this app already
matches headers (e.g. "Child CallNumbr" and "Child_CallNumbr" both reduce to
"childcallnumbr").

NOTE: this export does NOT include 4 columns the table has room for --
Unque (unique_flag), "Disposition Status" (disposition_status), Attempt
(attempt), Service_1 (service_2) -- confirmed absent from a real download,
even though existing historical rows (imported before this pipeline
existed) have real values there. upload_lp_onboarding_cdr.py's importer
already treats every column as optional except Call_Number, so a blank one
degrades gracefully (a less detailed row, not a rejected one). One of the
four is now filled in here (2026-09-29, mirroring the same fix applied to
lp_feedback_cdr):

    Disposition Status = looked up from Desposition via
                 lp_disposition_map.py's Desposition -> Connectivity table
                 for THIS process (LP Onboarding uses a completely
                 different disposition vocabulary from LP Feedback --
                 confirmed live, only "SESSION TERMINATED" overlaps between
                 the two -- so this is a separate map, not a copy). A
                 Desposition text not in that table is left blank, not
                 guessed -- reported at the end of the run.

Attempt is deliberately NOT computed -- see lp_feedback/convert_lp_feedback_cdr.py's
docstring for why: a per-lead-per-day running-count assumption was tried
there and disproved against real data, so it isn't attempted here either
without the real source/formula confirmed first.
Unque (unique_flag) and Service_1 (service_2) are still left blank.

Date -> report_date is derived the same way as
convert_lp_onboarding_apr.py's CalLDate handling: the export always writes a
"<date> - <date>" range even for one day (e.g.
"2026-09-26 - 2026-09-26") -- reformatted to "D-Mon-YY" (e.g. "26-Sep-26")
to match every existing lp_onboarding_cdr row's own report_date convention.

Usage:
    py convert_lp_onboarding_cdr.py <raw_export.csv> [--out PATH]
"""
from __future__ import annotations

import argparse
import csv
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from lp_disposition_map import get_disposition_status  # noqa: E402

OUTPUT_HEADER = [
    "S_No", "Date", "Interval", "Call_Number", "Service", "Agent", "Login_Id", "Start_Time", "End_Time",
    "Extension", "Remarks", "Dni", "Cli", "Desposition", "Lead_Id", "Batch", "Dialer_Type", "Duration",
    "Ivr_Duration", "Ring_Duration", "Talk_Duration", "Wrapup_Duration", "Hold_Duration", "Call_Status",
    "Hangup_By", "Child_CallNumbr", "Ivr_Terminal", "Disposition_Status",
]

MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def normalize_key(k: str) -> str:
    return re.sub(r"[^a-z0-9]", "", k.lower())


def report_date_from_range(raw: str) -> str | None:
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", raw.strip())
    if not m:
        return None
    year, month, day = m.groups()
    return f"{int(day)}-{MONTH_ABBR[int(month) - 1]}-{year[2:]}"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("file", type=Path, help="Raw IDCloud Call Register export (.csv)")
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

    blank_call_number = 0
    bad_date = 0
    unmapped_dispositions: dict[str, int] = defaultdict(int)
    out_rows: list[list[str]] = []
    for row in data_rows:
        call_number = col(row, "Call Number")
        if not call_number:
            blank_call_number += 1
            continue

        report_date = report_date_from_range(col(row, "Date"))
        if report_date is None:
            bad_date += 1

        disposition = col(row, "Desposition")
        disposition_status = get_disposition_status(disposition)
        if disposition and disposition_status is None:
            unmapped_dispositions[disposition] += 1

        out_rows.append([
            col(row, "S. No."), report_date, col(row, "Interval"), call_number, col(row, "Service"),
            col(row, "Agent"), col(row, "Login Id"), col(row, "Start Time"), col(row, "End Time"),
            col(row, "Extension"), col(row, "Remarks"), col(row, "Dni"), col(row, "Cli"),
            disposition, col(row, "Lead Id"), col(row, "Batch"), col(row, "Dialer Type"),
            col(row, "Duration"), col(row, "Ivr Duration"), col(row, "Ring Duration"),
            col(row, "Talk Duration"), col(row, "Wrapup Duration"), col(row, "Hold Duration"),
            col(row, "Call Status"), col(row, "Hangup By"), col(row, "Child CallNumbr"),
            col(row, "Ivr Terminal"), disposition_status,
        ])

    if blank_call_number:
        print(f"  {blank_call_number} row(s) skipped (blank Call Number).")
    if bad_date:
        print(f"  WARNING: {bad_date} row(s) had a Date this script could not parse -- report_date left blank for those.")
    if unmapped_dispositions:
        print(f"  WARNING: {sum(unmapped_dispositions.values())} row(s) had a Desposition not in lp_disposition_map.py "
              f"-- Disposition Status left blank for those:")
        for disp, count in sorted(unmapped_dispositions.items(), key=lambda kv: -kv[1]):
            print(f"    {count:>4}x  {disp!r}")

    print(f"\nWriting {out_path} ...")
    with out_path.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(OUTPUT_HEADER)
        w.writerows(out_rows)
    print(f"Done: {len(out_rows)} row(s) written.")
    print(out_path.resolve())


if __name__ == "__main__":
    main()
