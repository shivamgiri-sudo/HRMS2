# Bellavita data uploader module

Self-contained: this whole `bellavita/` folder can be copied to any Windows
machine and run there on its own — it does **not** need the rest of the
HRMS2 repo checked out alongside it. It has its own dependency list
(`requirements.txt`) and its own credentials file (`db.env`).

Unlike `housing_owner/`/`housing_premium/`/`lp_feedback/`, this one is
**manual, not scheduled**: Bellavita's Sale/APR/Chat/Cart exports are
downloaded by hand from their own source system, so this just gives you one
command to check a downloaded file against what's already in the database
and import whatever's missing.

## What it does

For each of the four file types, `upload.py` reads the file, figures out
which type it is from its own column headers, and:

| Type | Table | Dedup key | On a match |
|---|---|---|---|
| Sale | `db_masmis.bb_sale` | Bella Vita Order ID | Inserts if new. If the order id already exists, updates only `calling_status`/`current_status` on every matching row — nothing else changes. |
| APR | `db_masmis.bb_apr` | *(none)* | Always inserts. Warns if any row's date isn't strictly after the table's current max date, since `bb_apr` has no unique constraint to fall back on. |
| Chat | `db_masmis.new_bb_chat` | Unique ID | Inserts only rows whose Unique ID isn't already in the table. Never updates existing rows. (The older `db_masmis.bb_chat` is intentionally left untouched — see `lib/chat.py`'s own docstring.) |
| Cart | `db_masmis.bb_cart` | Cart ID (the file's `ID` column) | Inserts only rows whose Cart ID isn't already in the table. Never updates existing rows. |

Every column mapping (and, for Sale/Chat, the date-parsing rules) ports the
app's own uploader services (`backend/src/modules/bulk-upload/bb-*-masmis-bulk.service.ts`)
line for line, so a row this script inserts is identical to one uploaded
through the app's Uploader page. Every run also writes the same
`upload_batch` / `upload_batch_row` / `upload_log` records that page's own
import does, so the batch shows up in its "Recent Uploads" list with working
"Download" / "Download Failed Rows" buttons.

## One-time setup on a new machine

1. **Copy this whole folder** (`bellavita/`) to the target machine.
2. **Install Python 3.11+** (python.org) if not already present.
3. Open a terminal in the folder and install dependencies:
   ```
   py -m pip install -r requirements.txt
   ```
4. Copy `db.env.example` to `db.env` and fill in the real `DB_PASSWORD`
   (host/user/port/db name are already filled in — they're not secret on
   their own). `db.env` is deliberately excluded from git, so a fresh
   `git clone` never has it — only a real folder copy carries it forward.

## Run it

Always dry-run first — it writes nothing until you add `--execute`:

```
py upload.py --file "C:\path\to\file.xlsx"
```

That prints how many rows are new, how many already exist, and (for Sale)
how many existing rows would get their Calling Status / Current Status
refreshed. When the numbers look right:

```
py upload.py --file "C:\path\to\file.xlsx" --execute
```

Type is auto-detected from the file's header row; pass `--type sale|apr|chat|cart`
explicitly if a file's headers are unusual enough that auto-detection guesses
wrong (`py upload.py --file "..." --type sale --execute`).

For a Sale file, `--skip-updates` inserts the new order ids but skips the
`calling_status`/`current_status` refresh pass on ones that already exist —
use this when only the "new rows" half of a file has been approved:
```
py upload.py --file "C:\path\to\sale.xlsx" --execute --skip-updates
```

## Known limitations

- **APR has no dedup key.** A row is only ever inserted, never matched
  against an existing one — the date-overlap warning is your only guard
  against re-running the same file twice. Read it before adding `--execute`.
- **Cart/Chat never update existing rows**, only insert new ones — there is
  no equivalent of Sale's status-refresh pass for these two tables yet (no
  user request for one so far).
- This writes directly to the live production database. There is no
  `--force`/duplicate-refusal guard the way `housing_owner`'s CDR loader has
  for APR/Chat/Cart — the dedup-by-key logic is the safety net instead.
