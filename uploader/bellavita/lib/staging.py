"""Writes the mas_hrms.upload_batch / upload_batch_row staging rows every
import in this app produces, so a python-driven import shows up in the
Uploader page's "Recent Uploads" list AND its "Download"/"Download Failed
Rows" buttons both work -- confirmed by uploader/housing_owner's own
upload_owner_cdr.py that skipping this silently breaks those buttons
("No rows are stored for this upload").
"""
import json
import math
import uuid
from datetime import datetime


def _json_safe(value):
    """MySQL's JSON column rejects NaN/Infinity (json.dumps's default, non-standard
    output for them) -- pandas hands back NaN for a blank Excel cell in almost every
    row, so this recursively swaps those (and anything else json.dumps can't natively
    handle, e.g. a pandas Timestamp) for None/str before serialising."""
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    return value


def new_batch_id() -> str:
    """Reserves a batch id up front, so it can be embedded as every inserted
    row's own upload_batch_id column *before* the upload_batch header row
    that describes the batch is written (which needs final counts, only
    known after the insert loop finishes)."""
    return str(uuid.uuid4())


def write_upload_batch(conn, *, batch_id: str, upload_type_code: str, file_name: str, file_size_bytes: int,
                        total_rows: int, valid_rows: int, imported_rows: int, batch_status: str) -> str:
    batch_no = f"BATCH-{int(datetime.now().timestamp() * 1000)}"
    now = datetime.now()
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO upload_batch
                 (id, upload_batch_no, upload_type_code, original_file_name, file_size_bytes,
                  total_rows, valid_rows, error_rows, imported_rows, batch_status,
                  validated_at, imported_at, created_at, updated_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            [batch_id, batch_no, upload_type_code, file_name, file_size_bytes,
             total_rows, valid_rows, total_rows - valid_rows, imported_rows, batch_status,
             now, now, now, now],
        )
    return batch_no


def write_staged_rows(conn, batch_id: str, staged: list[tuple[int, dict, str, str | None]], chunk_size: int = 1000) -> None:
    """`staged` is (row_no, record, row_status, error_message_or_None) per source row --
    row_status is 'imported' or 'error', matching this app's own convention."""
    if not staged:
        return
    with conn.cursor() as cur:
        for i in range(0, len(staged), chunk_size):
            chunk = staged[i:i + chunk_size]
            cur.executemany(
                """INSERT INTO upload_batch_row
                     (id, upload_batch_id, row_no, raw_data, normalized_data, row_status, error_messages, created_at)
                   VALUES (UUID(), %s, %s, %s, %s, %s, %s, %s)""",
                [
                    (
                        batch_id, row_no, json.dumps(_json_safe(rec), default=str), json.dumps(_json_safe(rec), default=str),
                        status, json.dumps([err]) if err else None, datetime.now(),
                    )
                    for row_no, rec, status, err in chunk
                ],
            )
