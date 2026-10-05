#!/usr/bin/env python3
"""
One-off fixup: stages upload_batch_row records for Owner CDR batches that
were imported directly into db_masmis.Owner_cdr by an EARLIER version of
upload_owner_cdr.py, before it wrote upload_batch_row entries at all. Without
those rows, the Uploader page's "Download"/"Download Failed Rows" buttons
find nothing to build a file from and report "No rows are stored for this
upload" -- confirmed live, 2026-09-28, for the two batches this closes:
    b73ea130-5395-48fe-97c4-385838d8b8c6  (converted_yesterday.xlsx, 27-Sep-26)
    66255120-3e52-42c6-9a9b-f2f225b84025  (converted_26sep_only.xlsx, 26-Sep-26)

Reconstructs each staged row's raw_data straight from Owner_cdr itself (via
its own upload_batch_id column), mapping DB columns back to the same source
header names upload_owner_cdr.py's COLUMN_MAP already defines, so the
downloaded file looks exactly like the file that was actually uploaded.
Every row gets row_status='imported' -- these all landed successfully in
Owner_cdr; there is nothing to mark as an error here.

Only touches upload_batch_row; never re-touches Owner_cdr itself.

Usage:
    py backfill_upload_batch_rows.py <batch_id> [<batch_id> ...]
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent))
from upload_owner_cdr import COLUMN_MAP, connect, load_db_config, write_staged_rows  # noqa: E402

DB_COLS = [c[0] for c in COLUMN_MAP]


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit("Usage: py backfill_upload_batch_rows.py <batch_id> [<batch_id> ...]")
    batch_ids = sys.argv[1:]

    cfg = load_db_config()
    conn = connect(cfg)
    try:
        for batch_id in batch_ids:
            with conn.cursor() as cur:
                cur.execute(
                    f"SELECT {', '.join(DB_COLS)} FROM db_masmis.Owner_cdr WHERE upload_batch_id = %s ORDER BY id",
                    [batch_id],
                )
                db_rows = cur.fetchall()
            if not db_rows:
                print(f"{batch_id}: no rows found in Owner_cdr for this batch_id (already deleted, or wrong id?) -- skipping.")
                continue

            staged: list[tuple[int, dict[str, Any], str, None]] = []
            for row_no, db_row in enumerate(db_rows, start=2):
                record = {source_header: db_row[i] for i, (_db_col, source_header) in enumerate(COLUMN_MAP)}
                staged.append((row_no, record, "imported", None))

            print(f"{batch_id}: staging {len(staged)} row(s)...")
            write_staged_rows(cfg, batch_id, staged)
            print(f"{batch_id}: done.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
