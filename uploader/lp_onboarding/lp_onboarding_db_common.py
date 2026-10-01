"""
Shared DB helpers for the LP Onboarding uploader scripts (upload_lp_onboarding_apr.py,
upload_lp_onboarding_cdr.py) -- same conventions as housing_owner/upload_owner_cdr.py's
load_db_config()/connect()/write_staged_rows(), duplicated here rather than imported
across company folders so lp_onboarding/ stays self-contained and copyable on its own.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

from dotenv import dotenv_values
import pymysql


def load_db_config() -> dict[str, Any]:
    here_env = Path(__file__).resolve().parent / "db.env"
    repo_env = Path(__file__).resolve().parent.parent.parent / "backend" / ".env"
    env_path = here_env if here_env.exists() else repo_env
    if not env_path.exists():
        sys.exit(f"Cannot find {here_env} or {repo_env} -- credentials must come from one of these, not be hardcoded.")
    env = dotenv_values(env_path)
    missing = [k for k in ("DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME") if not env.get(k)]
    if missing:
        sys.exit(f"{env_path} is missing: {', '.join(missing)}")
    return {
        "host": env["DB_HOST"],
        "port": int(env.get("DB_PORT", "3306")),
        "user": env["DB_USER"],
        "password": env["DB_PASSWORD"],
        "database": env["DB_NAME"],
        "charset": "utf8mb4",
        "connect_timeout": 20,
        "read_timeout": 120,
        "write_timeout": 120,
    }


def connect(cfg: dict[str, Any]) -> pymysql.connections.Connection:
    return pymysql.connect(**cfg)


def write_staged_rows(
    cfg: dict[str, Any],
    batch_id: str,
    staged: list[tuple[int, dict[str, Any], str, str | None]],
    chunk_size: int = 1000,
) -> None:
    """Writes one upload_batch_row per source row -- raw_data/normalized_data
    are the record exactly as read from the file, so the Uploader page's
    "Download"/"Download Failed Rows" buttons work for this batch from day
    one (see housing_owner/upload_owner_cdr.py's docstring for the earlier
    bug this avoids: skipping this step silently breaks both buttons)."""
    if not staged:
        return
    conn = connect(cfg)
    try:
        with conn.cursor() as cur:
            for i in range(0, len(staged), chunk_size):
                chunk = staged[i : i + chunk_size]
                cur.executemany(
                    """INSERT INTO upload_batch_row
                         (id, upload_batch_id, row_no, raw_data, normalized_data, row_status, error_messages, created_at)
                       VALUES (UUID(), %s, %s, %s, %s, %s, %s, %s)""",
                    [
                        (
                            batch_id, row_no, json.dumps(rec, default=str), json.dumps(rec, default=str),
                            status, json.dumps([err]) if err else None, datetime.now(),
                        )
                        for row_no, rec, status, err in chunk
                    ],
                )
        conn.commit()
    finally:
        conn.close()
