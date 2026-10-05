"""
Shared logic for DU Digital's Thailand/Korea uploader scripts: DB config,
duration/date parsing (ported line-for-line from the backend's own
importers so a Python-uploaded row is indistinguishable from one uploaded
through the web Uploader page), and the direct-to-table insert + upload_batch
bookkeeping pattern this repo's other uploader/ scripts already use (see
housing_premium/upload_housing_premium_cdr.py for the original).

Thailand and Korea are NOT separate backend pipelines -- both write to the
same two tables (du_cdr_daily_actual, du_apr_daily_actual) under one shared
"DU Digital" process_master row, split only by a dashboard_label column
('KOREA'/'THAILAND'). This module is parameterized by that label rather than
duplicated per country, mirroring backend/src/modules/bulk-upload/
du-apr-daily-bulk.service.ts and du-cdr-bulk.service.ts exactly.
"""
from __future__ import annotations

import json
import sys
import uuid
from datetime import date, datetime
from pathlib import Path
from typing import Any, Literal

from dotenv import dotenv_values
import pymysql

DashboardLabel = Literal["KOREA", "THAILAND"]

HERE = Path(__file__).resolve().parent
DOWNLOAD_DIR = HERE / "downloads"
LOG_DIR = HERE / "logs"


# --------------------------------- DB config --------------------------------- #

def load_db_config() -> dict[str, Any]:
    """du.env in this folder first (self-contained, copyable to another machine),
    else backend/.env -- same fallback housing_premium's scripts use. Never hardcoded."""
    here_env = HERE / "db.env"
    repo_env = HERE.parent.parent / "backend" / ".env"
    env_path = here_env if here_env.exists() else repo_env
    if not env_path.exists():
        sys.exit(f"Cannot find {here_env} or {repo_env} -- DB credentials must come from one of these.")
    env = dotenv_values(env_path)
    missing = [k for k in ("DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME") if not env.get(k)]
    if missing:
        sys.exit(f"{env_path} is missing: {', '.join(missing)}")
    return {
        "host": env["DB_HOST"], "port": int(env.get("DB_PORT", "3306")),
        "user": env["DB_USER"], "password": env["DB_PASSWORD"], "database": env["DB_NAME"],
        "charset": "utf8mb4", "connect_timeout": 20, "read_timeout": 120, "write_timeout": 120,
    }


def connect(cfg: dict[str, Any]) -> pymysql.connections.Connection:
    return pymysql.connect(**cfg)


def get_process_id(cfg: dict[str, Any]) -> str:
    conn = connect(cfg)
    try:
        with conn.cursor() as cur:
            # process_master lives in mas_hrms, not db_masmis (confirmed 2026-10-05).
            cur.execute("SELECT id FROM mas_hrms.process_master WHERE process_name = 'DU Digital' AND active_status = 1 LIMIT 1")
            row = cur.fetchone()
            if not row:
                sys.exit('No active "DU Digital" row in process_master -- cannot attach rows to it.')
            return row[0]
    finally:
        conn.close()


# ------------------------- parsing (ported from the TS importers) ------------------------- #

def parse_count(raw: Any) -> int:
    v = str(raw if raw is not None else "").strip()
    if not v:
        return 0
    try:
        n = float(v)
    except ValueError:
        return 0
    return round(n) if n >= 0 else 0


def parse_seconds_flexible(raw: Any) -> int:
    """Mirrors du-apr-daily-bulk.service.ts's parseSecondsFlexible exactly: HH:MM:SS
    text, a day-fraction decimal (0 <= n < 1, the source's own native format), or an
    already-converted seconds value (n >= 1 is unambiguously already-seconds)."""
    v = str(raw if raw is not None else "").strip()
    if not v:
        return 0
    if ":" in v:
        parts = v.split(":")
        try:
            nums = [float(p) for p in parts]
        except ValueError:
            nums = []
        if len(nums) == 3:
            return round(nums[0] * 3600 + nums[1] * 60 + nums[2])
        if len(nums) == 2:
            return round(nums[0] * 60 + nums[1])
    try:
        n = float(v)
    except ValueError:
        return 0
    if n < 0:
        return 0
    return round(n * 86400) if n < 1 else round(n)


def parse_utilization_pct(raw: Any) -> float | None:
    """The source's Utilization % is a plain fraction (0.1503 = 15.04%), not pre-multiplied."""
    v = str(raw if raw is not None else "").strip()
    if not v:
        return None
    try:
        n = float(v)
    except ValueError:
        return None
    return n * 100 if n <= 1 else n


def parse_excel_date(raw: Any) -> date | None:
    """Excel/vicidial serial date (days since 1899-12-30) or a plain date string."""
    if isinstance(raw, (int, float)) and raw > 0:
        from datetime import timedelta
        return date(1899, 12, 30) + timedelta(days=round(raw))
    v = str(raw if raw is not None else "").strip()
    if not v:
        return None
    if v.replace(".", "", 1).isdigit():
        return parse_excel_date(float(v))
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y"):
        try:
            return datetime.strptime(v[:10], fmt).date()
        except ValueError:
            continue
    return None


def parse_call_datetime(raw: Any) -> tuple[date | None, str | None, int | None]:
    """Mirrors du-cdr-bulk.service.ts's parseCallDateTime: returns (date, datetime-str,
    hour-of-day). A fractional Excel serial (e.g. 46296.445810) carries a real time of
    day; a whole-number serial or a date-only string does not."""
    if isinstance(raw, (int, float)) and raw > 0:
        from datetime import timedelta
        base = datetime(1899, 12, 30) + timedelta(days=raw)
        has_time = abs(raw % 1) > 1e-9
        d = base.date()
        if has_time:
            dt = base.replace(microsecond=0)
            return d, dt.strftime("%Y-%m-%d %H:%M:%S"), dt.hour
        return d, None, None
    v = str(raw if raw is not None else "").strip()
    if not v:
        return None, None, None
    if v.replace(".", "", 1).isdigit():
        return parse_call_datetime(float(v))
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%m/%d/%Y %H:%M:%S", "%m/%d/%Y %H:%M"):
        try:
            dt = datetime.strptime(v, fmt)
            return dt.date(), dt.strftime("%Y-%m-%d %H:%M:%S"), dt.hour
        except ValueError:
            continue
    d = parse_excel_date(v)
    return d, None, None


# --------------------------------- batch bookkeeping --------------------------------- #

def parse_ascii_table_report(lines: list[str]) -> list[dict[str, str]]:
    """Parses the DU dialer's "Agent Time Detail" <pre>-text report -- confirmed live
    2026-10-01 against the real Korea report: it is an ASCII-bordered table
    (+---+---+ border rows, |-delimited fixed-width columns with padding spaces),
    NOT a clean pipe- or tab-separated file. The original reference script's
    pd.read_csv(sep='|') (falling back to sep='\\t') does not parse this -- every
    preamble/border line lacks a consistent delimiter count, so pandas silently
    produces a single garbage column instead of raising, which went unnoticed until
    inspecting the real downloaded file's content directly.

    Finds the real header row (the first '|'-delimited row containing both "USER NAME"
    and "CALLS"), skips border rows (all '+'/'-' characters) and the trailing TOTALS
    summary row, and returns one dict per real agent row, keyed by the header's own
    column names with values stripped of padding whitespace."""
    header: list[str] | None = None
    out: list[dict[str, str]] = []
    for line in lines:
        s = line.strip()
        if not s or set(s) <= {"+", "-"}:
            continue
        if "|" not in s:
            continue
        cells = [c.strip() for c in s.strip("|").split("|")]
        if header is None:
            if any("USER NAME" in c.upper() for c in cells) and any("CALLS" in c.upper() for c in cells):
                header = cells
            continue
        if not cells or not cells[0] or cells[0].upper().startswith("TOTALS"):
            continue
        out.append({header[i]: cells[i] for i in range(len(header)) if i < len(cells)})
    return out


def write_upload_batch(
    cfg: dict[str, Any], upload_type_code: str, table_name: str, file_name: str, file_size: int,
    total_rows: int, valid_rows: int, imported_rows: int, error_rows: int,
) -> str:
    """Writes upload_batch so this run shows in the Uploader page's Recent Uploads --
    du_apr_daily_actual/du_cdr_daily_actual live in mas_hrms (not db_masmis, unlike every
    other company's uploader/* scripts), and mas_hrms has no upload_log table of its own
    (confirmed live 2026-10-01: ER_NO_SUCH_TABLE), so that secondary bookkeeping insert
    other uploader scripts also do is skipped here -- upload_batch alone is what the
    Uploader page's Recent Uploads list actually reads from, so this still shows up fine."""
    batch_id = str(uuid.uuid4())
    batch_no = f"BATCH-{int(datetime.now().timestamp() * 1000)}"
    conn = connect(cfg)
    try:
        with conn.cursor() as cur:
            now = datetime.now()
            status = (
                "imported" if imported_rows > 0 and error_rows == 0
                else "imported_with_errors" if imported_rows > 0
                else "validation_failed"
            )
            cur.execute(
                """INSERT INTO mas_hrms.upload_batch
                     (id, upload_batch_no, upload_type_code, original_file_name, file_size_bytes,
                      total_rows, valid_rows, error_rows, imported_rows, batch_status,
                      validated_at, imported_at, created_at, updated_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (batch_id, batch_no, upload_type_code, file_name, file_size,
                 total_rows, valid_rows, error_rows, imported_rows, status, now, now, now, now),
            )
        conn.commit()
    finally:
        conn.close()
    return batch_id


def write_staged_rows(cfg: dict[str, Any], batch_id: str, staged: list[tuple[int, dict[str, Any], str, str | None]], chunk_size: int = 1000) -> None:
    if not staged:
        return
    conn = connect(cfg)
    try:
        with conn.cursor() as cur:
            for i in range(0, len(staged), chunk_size):
                chunk = staged[i: i + chunk_size]
                cur.executemany(
                    """INSERT INTO mas_hrms.upload_batch_row
                         (id, upload_batch_id, row_no, raw_data, normalized_data, row_status, error_messages, created_at)
                       VALUES (UUID(), %s, %s, %s, %s, %s, %s, %s)""",
                    [
                        (batch_id, row_no, json.dumps(rec, default=str), json.dumps(rec, default=str),
                         status, json.dumps([err]) if err else None, datetime.now())
                        for row_no, rec, status, err in chunk
                    ],
                )
        conn.commit()
    finally:
        conn.close()
