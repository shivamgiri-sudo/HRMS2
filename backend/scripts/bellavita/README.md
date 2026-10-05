# Bellavita uploader

One command for Sale / APR / Chat / Cart files. Give it a path, it figures out
which of the four it is from the column headers, checks what's already in the
database, and reports what it *would* do -- nothing is written until you add
`--execute`.

## Run it

```
cd backend
npx tsx scripts/bellavita/upload.ts --file "C:\path\to\file.xlsx"
```

That's a dry run: it prints how many rows are new, how many already exist,
and (for Sale) how many existing rows would get their Calling Status /
Current Status refreshed. Nothing is written.

When the numbers look right, run it again with `--execute`:

```
npx tsx scripts/bellavita/upload.ts --file "C:\path\to\file.xlsx" --execute
```

## What each type does

| Type | Table | Dedup key | On a match |
|---|---|---|---|
| `sale` | `db_masmis.bb_sale` | Bella Vita Order ID | Inserts if new. If the order id already exists, updates only `calling_status`/`current_status` on every matching row -- nothing else changes. |
| `apr` | `db_masmis.bb_apr` | *(none)* | Always inserts. Warns if any row's date isn't strictly after the table's current max date, since bb_apr has no unique constraint to fall back on. |
| `chat` | `db_masmis.new_bb_chat` | Unique ID | Inserts only rows whose Unique ID isn't already in the table. Never updates existing rows. |
| `cart` | `db_masmis.bb_cart` | Cart ID (the file's `ID` column) | Inserts only rows whose Cart ID isn't already in the table. Never updates existing rows. |

Type is auto-detected from the file's header row; pass `--type sale|apr|chat|cart`
explicitly if a file's headers are unusual enough that auto-detection guesses wrong.

For a Sale file, `--skip-updates` inserts the new order ids but skips the
calling_status/current_status refresh pass on ones that already exist -- use
this when only the "new rows" half of a file has been approved.

## Notes

- Every insert reuses the exact column mapping (and, for Sale/Chat, the exact
  parsing helpers) the app's own browser-upload pipeline uses, so a row this
  script inserts is identical to one uploaded through the UI.
- Cart's Created At / Updated At / Dates / Call Date are converted from raw
  Excel serial numbers to the table's existing `D-Mon-YY` text format.
- Every successful run adds one `db_masmis.upload_log` row, same as a normal
  upload.
- This writes directly to the live production database. Always run the dry
  run first and read the numbers before adding `--execute`.
