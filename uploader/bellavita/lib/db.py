"""MySQL connection helper.

Reads DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME from environment
variables, or from a "db.env" file next to upload.py if one exists (same
filename convention as this repo's other uploader/ scripts, e.g.
housing_owner/db.env). Business tables this toolkit writes to are always
qualified as db_masmis.<table> regardless of which database DB_NAME selects.
"""
import os
import pymysql
import pymysql.cursors


def _load_dotenv(path: str) -> None:
    if not os.path.isfile(path):
        return
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            os.environ.setdefault(key, value)


_ENV_LOADED = False


def connect():
    global _ENV_LOADED
    if not _ENV_LOADED:
        here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        _load_dotenv(os.path.join(here, "db.env"))
        _ENV_LOADED = True

    host = os.environ.get("DB_HOST")
    user = os.environ.get("DB_USER")
    password = os.environ.get("DB_PASSWORD")
    port = int(os.environ.get("DB_PORT", "3306"))
    # mas_hrms holds upload_batch/upload_batch_row (referenced unqualified below,
    # same as every other script in this repo's uploader/ folder); every business
    # table this toolkit writes to is still always qualified as db_masmis.<table>.
    database = os.environ.get("DB_NAME", "mas_hrms")
    if not host or not user or password is None:
        raise SystemExit(
            "DB_HOST / DB_USER / DB_PASSWORD are not set. Copy db.env.example to db.env "
            "in this folder and fill in the real values, or set them as environment variables."
        )
    return pymysql.connect(
        host=host,
        port=port,
        user=user,
        password=password,
        database=database,
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=True,
    )
