"""Bellavita Chat (db_masmis.new_bb_chat) check-and-insert.

The older db_masmis.bb_chat is intentionally left untouched (per
bb-chat-masmis-bulk.service.ts's own doc comment -- the Bellavita Chat
dashboard, Sales Upload module and the separate My Dashboards tool still read
it); new_bb_chat is the live table for new chat file uploads.

IMPORTANT -- Unique ID is NOT a per-row key, it repeats on purpose. Confirmed
live 2026-09-29: the same Unique ID appears more than once when a customer
contacts again -- the first row has Repeat Status "Unique", the follow-up has
"Repeat", with a genuinely different FRT/Resolution Time/Hour/agent etc. An
earlier version of this script deduped by Unique ID alone (keep the last
occurrence), which silently discarded every first-contact row of a repeat
pair -- 500 real rows out of one 3,636-row file. The fix: a row only counts
as "already imported" when (unique_id, frt, resolution_time_in_min) all
match an existing row -- frt/resolution_time_in_min are decimal(12,2) in the
table, so the file's own values are rounded to 2dp before comparing (verified
collision-free: only 7 of 3,636 real rows in that same file happen to round
to the same key as another row -- an accepted, tiny, explained gap, not a
sign the key is unreliable).

Ports mapBbChatRow/NEW_BB_CHAT_COLUMNS from bb-chat-masmis-bulk.service.ts
exactly, including the Fraud/Froud and Disposition/Dispostion header-typo
aliases fixed 2026-09-28, so a row inserted here is identical to one a
browser upload through the app would produce.
"""
import math
import os
import re
import pandas as pd

from .dates import parse_chat_date
from .staging import new_batch_id, write_upload_batch, write_staged_rows

UPLOAD_TYPE_CODE = "BB_CHAT_MASMIS"
NEW_BB_CHAT_TABLE = "db_masmis.new_bb_chat"
NEW_BB_CHAT_COLUMNS = [
    "repeat_status", "repeat_status_on_assign_time", "frt", "resolution_time_in_min", "frt_tat", "resolution_tat",
    "phone_number1", "current_agent", "email", "chat_date", "emp_id", "lob", "week", "count_1", "time_slot",
    "hour", "tl_name", "disposition", "day_shift_night_shift", "unique_id", "fraud", "frt_2", "user_type",
    "repeat_chat",
]


def _normalize_key(k: str) -> str:
    return re.sub(r"[^a-z0-9]", "", k.lower())


def _pick(normalized: dict, *names: str) -> str:
    for name in names:
        v = normalized.get(_normalize_key(name))
        if v is None:
            continue
        if isinstance(v, float) and math.isnan(v):
            continue
        s = str(v).strip()
        if s:
            return s
    return ""


def _or_none(v: str):
    return v or None


def _nullable_int(v: str):
    return int(v) if re.match(r"^-?\d+$", v) else None


def _nullable_decimal(v: str):
    return float(v) if re.match(r"^-?\d+(\.\d+)?$", v) else None


def map_bb_chat_row(data: dict, row_no: int):
    h = {_normalize_key(k): v for k, v in data.items()}

    unique_id = _pick(h, "Unique ID")
    if not unique_id:
        return {"ok": False, "error": f'Row {row_no}: "Unique ID" is required'}

    date_raw = _pick(h, "Date", "Chat Date")
    chat_date = None
    if date_raw:
        chat_date = parse_chat_date(date_raw)
        if not chat_date:
            return {"ok": False, "error": f'Row {row_no}: "Date" value "{date_raw}" is not a recognised date'}

    values = [
        _or_none(_pick(h, "Repeat Status")),
        _or_none(_pick(h, "Repeat Status on Assign Time", "Repeat Status On Assign")),
        _nullable_decimal(_pick(h, "FRT")),
        _nullable_decimal(_pick(h, "Resolution Time (In Min)", "Resolution Time In Minutes")),
        _or_none(_pick(h, "FRT TAT")),
        _or_none(_pick(h, "Resolution TAT")),
        _or_none(_pick(h, "Phone Number1", "Phone Number 1")),
        _or_none(_pick(h, "Current Agent")),
        _or_none(_pick(h, "Email")),
        chat_date,
        _or_none(_pick(h, "ID", "Emp ID")),
        _or_none(_pick(h, "LOB")),
        _or_none(_pick(h, "Week")),
        _nullable_decimal(_pick(h, "Count 1", "Count")),
        _or_none(_pick(h, "Time Slot")),
        _nullable_int(_pick(h, "Hour")),
        _or_none(_pick(h, "TL Name")),
        _or_none(_pick(h, "Disposition", "Dispostion")),
        _or_none(_pick(h, "Day Shift/Night Shift")),
        unique_id,
        _or_none(_pick(h, "Fraud", "Froud")),
        _or_none(_pick(h, "FRT_1", "FRT 2", "FRT2")),
        _or_none(_pick(h, "User Type")),
        _or_none(_pick(h, "Repeat/Chat")),
    ]
    return {"ok": True, "values": values}


def run_chat_upload(conn, file_path: str, execute: bool) -> dict:
    df = pd.read_excel(file_path, sheet_name=0)
    rows = df.to_dict(orient="records")
    print(f"[chat] Read {len(rows)} rows from {file_path}")

    mapped = [{"row_no": i + 2, "row": r, "result": map_bb_chat_row(r, i + 2)} for i, r in enumerate(rows)]
    bad_rows = [m for m in mapped if not m["result"]["ok"]]
    good_rows = [m for m in mapped if m["result"]["ok"]]
    print(f"[chat] Rows that mapped cleanly: {len(good_rows)} (mapping errors: {len(bad_rows)})")
    if bad_rows:
        print("[chat] Sample errors:", [m["result"]["error"] for m in bad_rows[:5]])

    unique_id_idx = NEW_BB_CHAT_COLUMNS.index("unique_id")
    frt_idx = NEW_BB_CHAT_COLUMNS.index("frt")
    res_idx = NEW_BB_CHAT_COLUMNS.index("resolution_time_in_min")

    def round2(v) -> str:
        try:
            return f"{float(v):.2f}"
        except (TypeError, ValueError):
            return ""

    def composite_key(values) -> str:
        return f"{values[unique_id_idx]}|{round2(values[frt_idx])}|{round2(values[res_idx])}"

    # Within-file de-dup is by the FULL composite key (unique_id + rounded frt + rounded
    # resolution time), not by unique_id alone -- two rows sharing a unique_id are almost
    # always two real, different interactions (see module docstring), so only an exact
    # composite match (an actual re-exported duplicate row) collapses to one.
    by_key: dict[str, dict] = {}
    for m in good_rows:
        by_key[composite_key(m["result"]["values"])] = m
    deduped = list(by_key.values())
    print(f"[chat] Distinct (unique_id, frt, resolution_time) rows in file: {len(deduped)} (exact re-exported dupes collapsed: {len(good_rows) - len(deduped)})")

    id_arr = list({str(m["result"]["values"][unique_id_idx]) for m in deduped})
    existing_keys: set[str] = set()
    with conn.cursor() as cur:
        CHUNK = 500
        for i in range(0, len(id_arr), CHUNK):
            chunk = id_arr[i:i + CHUNK]
            placeholders = ",".join(["%s"] * len(chunk))
            cur.execute(f"SELECT unique_id, frt, resolution_time_in_min FROM {NEW_BB_CHAT_TABLE} WHERE unique_id IN ({placeholders})", chunk)
            for r in cur.fetchall():
                existing_keys.add(f"{r['unique_id']}|{round2(r['frt'])}|{round2(r['resolution_time_in_min'])}")
    new_rows = [m for m in deduped if composite_key(m["result"]["values"]) not in existing_keys]
    print(f"[chat] Of file's rows, already in new_bb_chat (same unique_id + frt + resolution time): {len(deduped) - len(new_rows)}")
    print(f"[chat] NEW (not yet imported): {len(new_rows)}")

    if not execute:
        print("[chat] DRY RUN -- no writes made.")
        return {"total_rows": len(rows), "mapping_errors": len(bad_rows), "distinct_in_file": len(deduped), "already_in_db": len(deduped) - len(new_rows), "inserted": 0, "errors": 0}

    columns = NEW_BB_CHAT_COLUMNS + ["uploaded_by", "upload_batch_id"]
    placeholders = f"({','.join(['%s'] * len(columns))})"
    inserted = 0
    errors = 0
    staged: list[tuple[int, dict, str, str | None]] = [(m["row_no"], m["row"], "error", m["result"]["error"]) for m in bad_rows]
    batch_id = new_batch_id()
    CHUNK_INSERT = 200
    with conn.cursor() as cur:
        for i in range(0, len(new_rows), CHUNK_INSERT):
            chunk = new_rows[i:i + CHUNK_INSERT]
            try:
                sql = f"INSERT INTO {NEW_BB_CHAT_TABLE} ({', '.join(columns)}) VALUES {', '.join([placeholders] * len(chunk))}"
                flat_values = []
                for m in chunk:
                    flat_values.extend(list(m["result"]["values"]) + [None, batch_id])
                cur.execute(sql, flat_values)
                inserted += len(chunk)
                staged.extend((m["row_no"], m["row"], "imported", None) for m in chunk)
            except Exception as e:  # noqa: BLE001
                print(f"[chat] Chunk insert failed (rows {i}-{i + len(chunk)}): {e}")
                errors += len(chunk)
                staged.extend((m["row_no"], m["row"], "error", str(e)) for m in chunk)

    batch_no = write_upload_batch(
        conn, batch_id=batch_id, upload_type_code=UPLOAD_TYPE_CODE, file_name=os.path.basename(file_path),
        file_size_bytes=os.path.getsize(file_path) if os.path.exists(file_path) else 0,
        total_rows=len(rows), valid_rows=len(new_rows), imported_rows=inserted,
        batch_status="imported" if errors == 0 else ("imported_with_errors" if inserted > 0 else "validation_failed"),
    )
    write_staged_rows(conn, batch_id, staged)
    print(f"[chat] Recorded upload_batch {batch_no} ({batch_id}) -- shows in the Uploader page's Recent Uploads.")

    if inserted > 0:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO db_masmis.upload_log (batch_id, table_name, file_name, row_count, uploaded_by) VALUES (%s, 'new_bb_chat', %s, %s, NULL)",
                [batch_id, file_path, inserted],
            )

    print(f"[chat] Done. Inserted {inserted} rows ({errors} errors).")
    return {"total_rows": len(rows), "mapping_errors": len(bad_rows), "distinct_in_file": len(deduped), "already_in_db": len(deduped) - len(new_rows), "inserted": inserted, "errors": errors}
