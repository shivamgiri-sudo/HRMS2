#!/usr/bin/env bash
# Nightly logical backup of every user schema on the dedicated HRMS instance.
# Installed by 01-create-instance.sh as /usr/local/sbin/mysql-hrms-backup. Cron is NOT installed
# until there is real data (Phase 3). Suggested /etc/cron.d/mysql-hrms-backup:
#   30 4 * * * root /usr/local/sbin/mysql-hrms-backup >> /var/log/mysql-hrms-backup.log 2>&1
#
# One consistent snapshot per schema (--single-transaction, no table locks), with routines,
# events and triggers, compressed with zstd. Each file records its binary-log position in its
# header (--source-data=2), so a restore can be rolled forward with the retained binlogs.
#
# Env: KEEP_DAYS (default 7), OFFSITE_TARGET (optional rsync destination, e.g. backup@host:/srv/hrms).
# A backup on the same disk is not a disaster backup. Set OFFSITE_TARGET before relying on this.
set -Eeuo pipefail
umask 077

BASE=/var/mysql-hrms
SOCK=/run/mysqld-hrms/mysqld.sock
KEEP_DAYS="${KEEP_DAYS:-7}"
DAY="$(date +%F)"
OUT="$BASE/backup/$DAY"

# shellcheck disable=SC1091
source /etc/mysql-hrms/credentials.env
[[ "$OUT" == /var/mysql-hrms/backup/* ]] || { echo "refusing unexpected path $OUT" >&2; exit 1; }

CNF="$(mktemp)"
cleanup() { rm -f "$CNF"; if [ -n "${FAILED:-}" ]; then rm -rf "$OUT.partial"; fi; }
trap cleanup EXIT
printf '[client]\nuser=%s\npassword=%s\nsocket=%s\n' "$HRMS_DB_BACKUP_USER" "$HRMS_DB_BACKUP_PASSWORD" "$SOCK" > "$CNF"

FAILED=1
rm -rf "$OUT.partial"; mkdir -p "$OUT.partial"
echo "$(date '+%F %T') backup start -> $OUT"

mapfile -t DBS < <(mysql --defaults-extra-file="$CNF" -N -e \
  "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('mysql','sys','information_schema','performance_schema')")
[ "${#DBS[@]}" -gt 0 ] || { echo "no user schemas found" >&2; exit 1; }

for db in "${DBS[@]}"; do
  echo "  dumping $db"
  mysqldump --defaults-extra-file="$CNF" \
    --single-transaction --quick --routines --events --triggers --hex-blob \
    --source-data=2 --set-gtid-purged=OFF --default-character-set=utf8mb4 \
    "$db" | zstd -T2 -3 -q -o "$OUT.partial/$db.sql.zst"
done

( cd "$OUT.partial" && sha256sum ./*.zst > SHA256SUMS )
rm -rf "$OUT"; mv "$OUT.partial" "$OUT"; FAILED=""
echo "$(date '+%F %T') backup done: $(du -sh "$OUT" | cut -f1)"

if [ -n "${OFFSITE_TARGET:-}" ]; then
  rsync -a --partial "$OUT/" "$OFFSITE_TARGET/$DAY/"
  echo "$(date '+%F %T') copied offsite to $OFFSITE_TARGET/$DAY/"
fi

# Retention: only dated folders inside our own backup directory.
find "$BASE/backup" -mindepth 1 -maxdepth 1 -type d -name '20??-??-??' -mtime "+$KEEP_DAYS" -exec rm -rf {} +
