#!/usr/bin/env python3
"""
Recurring near-real-time sync: imports newly-appended rows of the "Sale raw"
Google Sheet into db_masmis.pre_sale. Meant to run every 15 minutes via
Windows Task Scheduler (same always-on machine as daily_housing_premium_cdr.py).

Checkpoint-based, NOT date- or order_id-based: sheet row *position* is
tracked in sale_sheet_checkpoint.json (next line: how many data rows have
been processed so far). Each run reads the sheet's current data-row count;
if it grew, only the NEW rows (beyond the checkpoint) are fetched, converted
and inserted, then the checkpoint advances. This assumes the sheet only ever
grows by appending new rows at the bottom -- true for how this raw sale log
is used today (confirmed live: row order is chronological, newest at the
end) -- not by inserting/reordering historical rows; if that assumption
ever breaks, this script will silently miss whatever was inserted above the
checkpoint, so re-run backfill_google_sheet_sale.py for the affected dates
if the sheet's own historical rows are ever edited in place.

Order-id/date dedup was deliberately NOT used for this check: every existing
pre_sale row's order_id predates this pipeline and is stored in corrupted
scientific-notation form (see google_sheet_sale_common.py's docstring), so
comparing against them would never match anyway. The row-count checkpoint
sidesteps that entirely.

First run after backfill_google_sheet_sale.py: with no checkpoint file yet,
this initializes the checkpoint to the sheet's CURRENT size and imports
nothing on that first run (nothing to catch up on, since the 25-27 Sep gap
was just closed by the backfill script). Every run after that imports
whatever rows were appended since the last run.

Usage:
    py sync_google_sheet_sale.py             # normal run (for Task Scheduler)
    py sync_google_sheet_sale.py --dry-run    # preview without writing
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from google_sheet_sale_common import (  # noqa: E402
    convert_row, fetch_all_rows, filter_already_inserted, header_index, insert_rows, sheets_service,
)

HERE = Path(__file__).parent
CHECKPOINT_PATH = HERE / "sale_sheet_checkpoint.json"
LOG_DIR = HERE / "logs"


def load_checkpoint() -> int | None:
    if not CHECKPOINT_PATH.exists():
        return None
    return json.loads(CHECKPOINT_PATH.read_text(encoding="utf-8"))["last_data_row"]


def save_checkpoint(n: int) -> None:
    CHECKPOINT_PATH.write_text(json.dumps({"last_data_row": n, "updated_at": datetime.now().isoformat()}), encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    LOG_DIR.mkdir(exist_ok=True)
    lines: list[str] = []

    def log(msg: str) -> None:
        stamped = f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
        print(stamped)
        lines.append(stamped)

    log("=== Sale raw sheet sync ===")
    svc = sheets_service()
    all_rows = fetch_all_rows(svc)
    header, data_rows = all_rows[0], all_rows[1:]
    idx = header_index(header)
    current_count = len(data_rows)

    checkpoint = load_checkpoint()
    if checkpoint is None:
        log(f"No checkpoint yet -- initializing to current sheet size ({current_count} data rows). Nothing to import this run.")
        if not args.dry_run:
            save_checkpoint(current_count)
        return

    if current_count <= checkpoint:
        log(f"No new rows (checkpoint {checkpoint}, sheet has {current_count}).")
        return

    new_rows = data_rows[checkpoint:current_count]
    log(f"{len(new_rows)} new row(s) since last run (rows {checkpoint + 2}..{current_count + 1} in the sheet).")

    matched: list[dict] = []
    skipped: list[str] = []
    for i, row in enumerate(new_rows, start=checkpoint + 2):
        parsed, skip_reason = convert_row(row, idx)
        if skip_reason:
            skipped.append(f"row {i}: {skip_reason}")
            continue
        matched.append(parsed)

    if skipped:
        log(f"{len(skipped)} row(s) skipped: {skipped}")

    if not matched:
        log("Nothing importable in the new rows.")
        if not args.dry_run:
            save_checkpoint(current_count)
        log_path = LOG_DIR / f"sale_sync_{int(time.time())}.log"
        log_path.write_text("\n".join(lines), encoding="utf-8")
        return

    unmatched_tl = sorted({r["agent_name"] for r in matched if r["agent_name"] and not r["tl_name"]})
    if unmatched_tl:
        log(f"{len(unmatched_tl)} agent(s) with blank TL_Name in the sheet itself (left blank, not guessed): {unmatched_tl}")

    to_insert, duplicates = filter_already_inserted(matched)
    if duplicates:
        log(f"{len(duplicates)} row(s) already exist in pre_sale by order_id -- skipped, not re-inserted: {duplicates}")

    if args.dry_run:
        log(f"DRY RUN -- would insert {len(to_insert)} row(s) ({len(duplicates)} already present, skipped). No changes made, checkpoint not advanced.")
    else:
        if to_insert:
            batch_id = insert_rows(to_insert, f"Google Sheet sync {datetime.now().isoformat()}")
            log(f"Inserted {len(to_insert)} row(s). Batch id: {batch_id}")
        else:
            log("Nothing new to insert (all already present).")
        save_checkpoint(current_count)
        log(f"Checkpoint advanced to {current_count}.")

    log_path = LOG_DIR / f"sale_sync_{int(time.time())}.log"
    log_path.write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    main()
