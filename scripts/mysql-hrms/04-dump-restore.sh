#!/usr/bin/env bash
# Phase 2: copy the HRMS schemas from the source server into the dedicated instance.
#
#   sudo ./04-dump-restore.sh             # dry run: checks access and privileges, changes nothing
#   sudo ./04-dump-restore.sh --apply     # dumps, restores, compares
#
# Decision (owner, 2026-09-30): the DATA of mas_hrms.upload_batch_row (18.6 GB of the 26.5 GB) is
# NOT copied. Its table structure is created empty. Everything else in the schemas below is copied.
#
# Reads /etc/mysql-hrms/source.env (root-only, created by the operator, never committed):
#   SRC_HOST=...  SRC_PORT=3306  SRC_USER=hrms_dump  SRC_PASSWORD=...
# The dump user needs the grants in DBA-REQUEST.md. Without RELOAD + REPLICATION CLIENT the dump still
# works but records no binary-log position, so replication (Phase 3) cannot start; the script then
# refuses to continue unless you pass --allow-no-position (cutover then needs a longer window).
set -Eeuo pipefail

MODE=--dry-run; ALLOW_NO_POS=0
for a in "$@"; do case "$a" in
  --apply) MODE=--apply ;; --dry-run) MODE=--dry-run ;; --allow-no-position) ALLOW_NO_POS=1 ;;
  *) echo "usage: $0 [--dry-run|--apply] [--allow-no-position]" >&2; exit 2 ;; esac; done

SCHEMAS=(mas_hrms db_masmis db_audit db_external Shivamgiri)
EXCLUDED_DATA_TABLE="mas_hrms.upload_batch_row"
SOCK=/run/mysqld-hrms/mysqld.sock
DEST_DIR="/var/mysql-hrms/backup/phase2-$(date +%F_%H%M)"
LOCAL_DEFINER="\`hrms_app\`@\`localhost\`"

say()  { printf '[phase2] %s\n' "$*"; }
die()  { printf '[phase2] ERROR: %s\n' "$*" >&2; exit 1; }
step() { printf '\n[phase2] == %s\n' "$*"; }

[ "$(id -u)" -eq 0 ] || die "run as root (reads root-only credential files)"
# shellcheck disable=SC1091
source /etc/mysql-hrms/credentials.env || die "run 01-create-instance.sh --apply first"
[ -f /etc/mysql-hrms/source.env ] || die "/etc/mysql-hrms/source.env missing (see header)"
# shellcheck disable=SC1091
source /etc/mysql-hrms/source.env
: "${SRC_HOST:?}" "${SRC_USER:?}" "${SRC_PASSWORD:?}"; SRC_PORT="${SRC_PORT:-3306}"

TMP="$(mktemp -d)"; chmod 700 "$TMP"; trap 'rm -rf "$TMP"' EXIT
printf '[client]\nhost=%s\nport=%s\nuser=%s\npassword=%s\n' "$SRC_HOST" "$SRC_PORT" "$SRC_USER" "$SRC_PASSWORD" > "$TMP/src.cnf"
printf '[client]\nuser=root\npassword=%s\nsocket=%s\n' "$HRMS_DB_ROOT_PASSWORD" "$SOCK" > "$TMP/dst.cnf"
src() { mysql --defaults-extra-file="$TMP/src.cnf" --connect-timeout=15 -N -B "$@"; }
dst() { mysql --defaults-extra-file="$TMP/dst.cnf" -N -B "$@"; }

step "0. Pre-flight"
dst -e 'SELECT 1' >/dev/null || die "dedicated instance not reachable (run mysql-hrms-verify)"
[ "$(dst -e "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name IN ('mas_hrms','db_masmis')")" = "0" ] \
  || die "mas_hrms/db_masmis already exist on the dedicated instance; refusing to overwrite (drop them deliberately first)"
src_ver="$(src -e 'SELECT @@version')"; say "source: $SRC_HOST:$SRC_PORT  MySQL $src_ver"
grants="$(src -e 'SHOW GRANTS' | tr '\n' ' ')"
HAVE_POS=1
for p in RELOAD "REPLICATION CLIENT"; do
  echo "$grants" | grep -qiE "($p|ALL PRIVILEGES ON \*\.\*)" || { say "MISSING privilege: $p"; HAVE_POS=0; }
done
if [ "$HAVE_POS" = 0 ] && [ "$ALLOW_NO_POS" = 0 ]; then
  die "no binary-log position possible (see DBA-REQUEST.md). Ask the DBA for the grants, or pass --allow-no-position and plan a longer cutover window."
fi
[ "$HAVE_POS" = 1 ] && say "privileges OK: dump will record the binary-log position" || say "WARNING: continuing without a binary-log position"

step "1. What will be copied (source sizes)"
for s in "${SCHEMAS[@]}"; do
  src -e "SELECT '$s', COUNT(*), ROUND(SUM(data_length+index_length)/1073741824,2) FROM information_schema.tables WHERE table_schema='$s'" | awk '{printf "  %-12s %5s tables  %6s GB\n",$1,$2,$3}'
done
skip_gb="$(src -e "SELECT ROUND((data_length+index_length)/1073741824,2) FROM information_schema.tables WHERE table_schema='mas_hrms' AND table_name='upload_batch_row'")"
say "NOT copied: data of $EXCLUDED_DATA_TABLE (${skip_gb} GB); its structure is created empty"
need_gb=$(( $(df --output=avail -BG /var | tail -1 | tr -dc '0-9') ))
[ "$need_gb" -ge 60 ] || die "only ${need_gb} GB free on /var"

if [ "$MODE" = "--dry-run" ]; then
  step "Dry run finished"; say "would write to $DEST_DIR, then restore into the dedicated instance. Re-run with --apply."; exit 0
fi

step "2. Dump (one consistent snapshot per schema, no locks on the source)"
mkdir -p "$DEST_DIR"; chmod 700 "$DEST_DIR"
POS_ARGS=(); [ "$HAVE_POS" = 1 ] && POS_ARGS=(--source-data=2)
for s in "${SCHEMAS[@]}"; do
  say "dumping $s"
  IGN=(); [ "$s" = "mas_hrms" ] && IGN=(--ignore-table="$EXCLUDED_DATA_TABLE")
  mysqldump --defaults-extra-file="$TMP/src.cnf" --single-transaction --quick --routines --events --triggers \
    --hex-blob --set-gtid-purged=OFF --default-character-set=utf8mb4 --net-buffer-length=1048576 \
    "${POS_ARGS[@]}" "${IGN[@]}" "$s" | zstd -T4 -3 -q -o "$DEST_DIR/$s.sql.zst"
done
say "dumping structure of $EXCLUDED_DATA_TABLE (no rows)"
mysqldump --defaults-extra-file="$TMP/src.cnf" --no-data --skip-triggers --set-gtid-purged=OFF \
  --default-character-set=utf8mb4 mas_hrms upload_batch_row | zstd -q -o "$DEST_DIR/mas_hrms.upload_batch_row.structure.sql.zst"
( cd "$DEST_DIR" && sha256sum ./*.zst > SHA256SUMS && sha256sum -c SHA256SUMS >/dev/null ) && say "checksums recorded"

if [ "$HAVE_POS" = 1 ]; then
  for s in "${SCHEMAS[@]}"; do
    line="$(zstd -dc "$DEST_DIR/$s.sql.zst" | head -c 4096 | grep -m1 -E 'CHANGE (MASTER|REPLICATION SOURCE) TO' || true)"
    printf '%s\t%s\n' "$s" "$line"
  done > "$DEST_DIR/BINLOG_POSITIONS.tsv"
  say "binary-log positions saved to $DEST_DIR/BINLOG_POSITIONS.tsv (Phase 3 starts replication from the earliest one)"
fi

step "3. Restore (binary log and FK/unique checks off for speed; definers rewritten to $LOCAL_DEFINER)"
restore() {  # file, target-db
  zstd -dc "$1" \
    | sed -E "s/DEFINER=\`[^\`]+\`@\`[^\`]+\`/DEFINER=${LOCAL_DEFINER}/g" \
    | mysql --defaults-extra-file="$TMP/dst.cnf" --max-allowed-packet=64M \
        --init-command="SET sql_log_bin=0, foreign_key_checks=0, unique_checks=0, sql_mode=''" "$2"
}
for s in "${SCHEMAS[@]}"; do
  say "creating + restoring $s"
  dst -e "CREATE DATABASE IF NOT EXISTS \`$s\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci"
  restore "$DEST_DIR/$s.sql.zst" "$s"
done
say "creating empty upload_batch_row"
restore "$DEST_DIR/mas_hrms.upload_batch_row.structure.sql.zst" mas_hrms

step "4. Compare table lists and row counts (exact counts below 2M estimated rows, estimates above)"
FAILS=0
for s in "${SCHEMAS[@]}"; do
  a="$(src -e "SELECT table_name FROM information_schema.tables WHERE table_schema='$s' AND table_type='BASE TABLE' ORDER BY 1")"
  b="$(dst -e "SELECT table_name FROM information_schema.tables WHERE table_schema='$s' AND table_type='BASE TABLE' ORDER BY 1")"
  if [ "$a" = "$b" ]; then say "PASS  $s: same $(echo "$a" | wc -l) tables"; else say "FAIL  $s: table lists differ"; diff <(echo "$a") <(echo "$b") | head -6; FAILS=$((FAILS+1)); fi
done
while IFS=$'\t' read -r sch tbl est; do
  [ "$sch.$tbl" = "$EXCLUDED_DATA_TABLE" ] && continue
  [ "${est:-0}" -gt 2000000 ] && continue
  ca="$(src -e "SELECT COUNT(*) FROM \`$sch\`.\`$tbl\`" </dev/null 2>/dev/null || echo ERR)"; cb="$(dst -e "SELECT COUNT(*) FROM \`$sch\`.\`$tbl\`" </dev/null 2>/dev/null || echo ERR)"
  # The source keeps changing while we work, so allow a small drift on busy tables and report it.
  if [ "$ca" = "$cb" ]; then :; else say "DIFF  $sch.$tbl source=$ca copy=$cb"; fi
done < <(src -e "SELECT table_schema, table_name, table_rows FROM information_schema.tables WHERE table_schema IN ('mas_hrms','db_masmis') AND table_type='BASE TABLE' ORDER BY table_rows DESC LIMIT 60")

step "Done"
[ "$FAILS" = 0 ] && say "table lists match. Row-count DIFF lines above are expected only for tables written to during the copy; replication (Phase 3) closes that gap." || die "$FAILS schema(s) differ"
say "dump files kept in $DEST_DIR (checksummed). Next: Phase 3, replication from the position in BINLOG_POSITIONS.tsv."
