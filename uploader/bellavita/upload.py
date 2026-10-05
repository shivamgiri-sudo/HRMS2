#!/usr/bin/env python3
"""Bellavita uploader CLI -- one command for Sale / APR / Chat / Cart.

Usage:
    python upload.py --file "C:\\path\\to\\file.xlsx"
    python upload.py --file "C:\\path\\to\\file.xlsx" --execute
    python upload.py --file "C:\\path\\to\\file.xlsx" --type sale --execute
    python upload.py --file "C:\\path\\to\\file.xlsx" --type sale --execute --skip-updates

By default this is always a DRY RUN (reports what it would do, writes
nothing). Pass --execute to actually write to the database.

--type is optional -- the file's own column headers are enough to tell
Sale/APR/Chat/Cart apart automatically. Pass --type explicitly only if a
file's headers are too far off the usual shape to auto-detect.

--skip-updates only applies to --type sale: inserts new order ids but skips
the calling_status/current_status update pass on ones that already exist
(used when only the "new rows" half of a Sale file has been approved).

Setup (once, on any PC): `pip install -r requirements.txt`, then copy
.env.example to .env in this folder and fill in the real DB_HOST/DB_USER/
DB_PASSWORD values.
"""
import argparse
import sys

import pandas as pd

from lib.db import connect
from lib.sale import run_sale_upload
from lib.apr import run_apr_upload
from lib.chat import run_chat_upload
from lib.cart import run_cart_upload


def _normalize(h: str) -> str:
    return "".join(c for c in h.lower() if c.isalnum())


def detect_type(file_path: str) -> str | None:
    """Sniffs the sheet's header row to tell the four uploaders apart."""
    df = pd.read_excel(file_path, sheet_name=0, nrows=0)
    headers = {_normalize(str(c)) for c in df.columns}

    def has(*names: str) -> bool:
        return any(_normalize(n) in headers for n in names)

    if has("Bella Vita Order ID"):
        return "sale"
    if has("NOIID") and has("ACHT"):
        return "apr"
    if has("Repeat Status") and (has("Unique ID") or has("Unique Id")):
        return "chat"
    if has("Abandoned Cart Link") or (has("Cart ID") and has("Drop Stage")):
        return "cart"
    return None


def main() -> None:
    parser = argparse.ArgumentParser(description="Bellavita uploader -- Sale / APR / Chat / Cart, one command.")
    parser.add_argument("--file", required=True, help="Path to the .xlsx file")
    parser.add_argument("--type", choices=["sale", "apr", "chat", "cart"], default=None, help="Override auto-detection")
    parser.add_argument("--execute", action="store_true", help="Actually write to the database (default: dry run)")
    parser.add_argument("--skip-updates", action="store_true", help="Sale only: insert new rows, skip the status-update pass on existing ones")
    args = parser.parse_args()

    file_type = args.type or detect_type(args.file)
    if not file_type:
        print(f"Could not auto-detect the file type from its columns. Pass --type sale|apr|chat|cart explicitly.\nFile: {args.file}", file=sys.stderr)
        sys.exit(1)
    print(f"Detected/selected type: {file_type}" + (" (explicit)" if args.type else " (auto-detected from headers)"))
    print("Mode: EXECUTE -- this will write to the database." if args.execute else "Mode: DRY RUN -- no writes will be made.")

    conn = connect()
    try:
        if file_type == "sale":
            run_sale_upload(conn, args.file, execute=args.execute, skip_updates=args.skip_updates)
        elif file_type == "apr":
            run_apr_upload(conn, args.file, execute=args.execute)
        elif file_type == "chat":
            run_chat_upload(conn, args.file, execute=args.execute)
        elif file_type == "cart":
            run_cart_upload(conn, args.file, execute=args.execute)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
