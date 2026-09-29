#!/usr/bin/env bash
# Phase 1: build a dedicated, EMPTY MySQL instance for HRMS on the app server.
#
#   sudo ./01-create-instance.sh             # dry run: checks + prints every step, changes nothing
#   sudo ./01-create-instance.sh --apply     # does it
#
# What it creates (nothing existing is modified except the AppArmor profile reload, see step 4):
#   /var/mysql-hrms/{data,binlog,tmp,backup}   data lives on /var (285 GB free), not /var/lib (31 GB free)
#   /etc/mysql-hrms/hrms.cnf                   instance config (port 3307, 127.0.0.1 only)
#   /etc/mysql-hrms/credentials.env            generated passwords, root-only (mode 600), never printed
#   /etc/systemd/system/mysql-hrms.service     separate unit; the LMS MySQL on 3306 is not touched
#
# It does NOT copy data, does NOT touch the app's .env and does NOT start replication.
# The running application keeps using the remote database until Phase 5.
set -Eeuo pipefail

MODE="${1:---dry-run}"
case "$MODE" in --apply|--dry-run) ;; *) echo "usage: $0 [--dry-run|--apply]" >&2; exit 2 ;; esac

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE=/var/mysql-hrms
CONF_DIR=/etc/mysql-hrms
SOCK=/run/mysqld-hrms/mysqld.sock
PORT=3307
MIN_FREE_GB=120
MIN_AVAIL_MEM_GB=8

say()  { printf '[mysql-hrms] %s\n' "$*"; }
warn() { printf '[mysql-hrms] WARN: %s\n' "$*" >&2; }
die()  { printf '[mysql-hrms] ERROR: %s\n' "$*" >&2; exit 1; }
step() { printf '\n[mysql-hrms] == %s\n' "$*"; }
run()  { if [ "$MODE" = "--apply" ]; then "$@"; else printf '  [dry-run]'; printf ' %q' "$@"; printf '\n'; fi; }

# ------------------------------------------------------------------------------------------------
step "0. Pre-flight checks (read-only)"
if [ "$MODE" = "--apply" ] && [ "$(id -u)" -ne 0 ]; then die "--apply needs root (sudo)"; fi
[ -x /usr/sbin/mysqld ] || die "/usr/sbin/mysqld not found; install mysql-server first"
[ -f "$HERE/hrms.cnf" ] && [ -f "$HERE/mysql-hrms.service" ] || die "hrms.cnf / mysql-hrms.service missing next to this script"

ver="$(/usr/sbin/mysqld --version | grep -oE 'Ver [0-9]+\.[0-9]+\.[0-9]+' | cut -d' ' -f2)"
say "mysqld version: $ver (source server is 8.0.42; restoring a dump into a newer 8.0.x is supported)"
[ "$(printf '%s\n8.0.42\n' "$ver" | sort -V | head -1)" = "8.0.42" ] || die "mysqld $ver is older than the source 8.0.42"

if ss -ltn "( sport = :$PORT )" 2>/dev/null | grep -q LISTEN; then die "port $PORT is already in use"; fi
[ ! -e "$BASE/data" ] || die "$BASE/data already exists; refusing to overwrite"
if systemctl list-unit-files 2>/dev/null | grep -q '^mysql-hrms\.service'; then die "mysql-hrms.service already exists"; fi

free_gb="$(df --output=avail -BG /var | tail -1 | tr -dc '0-9')"
[ "$free_gb" -ge "$MIN_FREE_GB" ] || die "/var has ${free_gb} GB free, need >= ${MIN_FREE_GB} GB (data + binlogs + backups)"
say "/var free: ${free_gb} GB"

avail_gb=$(( $(awk '/MemAvailable/ {print $2}' /proc/meminfo) / 1024 / 1024 ))
[ "$avail_gb" -ge "$MIN_AVAIL_MEM_GB" ] || die "only ${avail_gb} GB memory available, need >= ${MIN_AVAIL_MEM_GB} GB for a 6 GB buffer pool; add RAM or lower innodb_buffer_pool_size"
say "memory available: ${avail_gb} GB"

tz="$(timedatectl show -p Timezone --value 2>/dev/null || true)"
[ "$tz" = "Asia/Kolkata" ] || warn "OS timezone is '${tz:-unknown}', app expects IST; hrms.cnf pins +05:30 anyway"

# ------------------------------------------------------------------------------------------------
step "1. Kernel: lower swappiness so the buffer pool is not swapped out (sysctl.d, reversible)"
run bash -c "echo 'vm.swappiness = 10' > /etc/sysctl.d/99-mysql-hrms.conf"
run sysctl -w vm.swappiness=10

step "2. Directories"
run install -d -o mysql -g mysql -m 750 "$BASE" "$BASE/data" "$BASE/binlog" "$BASE/tmp"
run install -d -o root -g root -m 700 "$BASE/backup"
run install -d -o root -g root -m 755 "$CONF_DIR"

step "3. Config and systemd unit"
run install -o root -g root -m 644 "$HERE/hrms.cnf" "$CONF_DIR/hrms.cnf"
run install -o root -g root -m 644 "$HERE/mysql-hrms.service" /etc/systemd/system/mysql-hrms.service
run systemctl daemon-reload

step "4. AppArmor (Ubuntu confines /usr/sbin/mysqld to /var/lib/mysql; allow the new paths)"
if command -v aa-status >/dev/null 2>&1 && aa-status --enabled 2>/dev/null; then
  LOCAL=/etc/apparmor.d/local/usr.sbin.mysqld
  if ! grep -q 'mysql-hrms' "$LOCAL" 2>/dev/null; then
    say "appending rules to $LOCAL and reloading the profile (does not restart the LMS MySQL)"
    if [ "$MODE" = "--apply" ]; then
      cat >> "$LOCAL" <<'EOF'
# mysql-hrms dedicated instance
/var/mysql-hrms/ r,
/var/mysql-hrms/** rwk,
/etc/mysql-hrms/ r,
/etc/mysql-hrms/** r,
/run/mysqld-hrms/ rw,
/run/mysqld-hrms/** rwk,
EOF
      apparmor_parser -r /etc/apparmor.d/usr.sbin.mysqld
    else
      echo "  [dry-run] append 6 path rules to $LOCAL and: apparmor_parser -r /etc/apparmor.d/usr.sbin.mysqld"
    fi
  else
    say "rules already present"
  fi
else
  say "AppArmor not enforcing; nothing to do"
fi

step "5. Initialise the data directory (empty, no data copied)"
run sudo -u mysql /usr/sbin/mysqld --defaults-file="$CONF_DIR/hrms.cnf" --initialize-insecure

step "6. Start"
run systemctl enable --now mysql-hrms
if [ "$MODE" = "--apply" ]; then
  for _ in $(seq 1 120); do
    mysqladmin --socket="$SOCK" -uroot ping >/dev/null 2>&1 && break
    sleep 1
  done
  mysqladmin --socket="$SOCK" -uroot ping >/dev/null 2>&1 || die "instance did not come up; see $BASE/mysqld-error.log"
  say "instance is up on 127.0.0.1:$PORT"
fi

step "7. Accounts (created with sql_log_bin=0 so they never replicate anywhere)"
if [ "$MODE" = "--apply" ]; then
  # cut (not head) reads its whole input, so pipefail cannot trip on SIGPIPE.
  gen() { openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | cut -c1-28; }
  ROOT_PW="$(gen)"; APP_PW="$(gen)"; BK_PW="$(gen)"
  umask 077
  cat > "$CONF_DIR/credentials.env" <<EOF
HRMS_DB_ROOT_PASSWORD=$ROOT_PW
HRMS_DB_APP_USER=hrms_app
HRMS_DB_APP_PASSWORD=$APP_PW
HRMS_DB_BACKUP_USER=hrms_backup
HRMS_DB_BACKUP_PASSWORD=$BK_PW
EOF
  chmod 600 "$CONF_DIR/credentials.env"; chown root:root "$CONF_DIR/credentials.env"
  mysql --socket="$SOCK" -uroot <<SQL
SET sql_log_bin = 0;
ALTER USER 'root'@'localhost' IDENTIFIED BY '$ROOT_PW';

-- Application. Grants mirror the source login (shivam_user) so behaviour is identical, with one
-- deliberate addition: CREATE/ALTER/INDEX on db_masmis, so a migration such as 449 can run
-- instead of blocking startup ("CREATE command denied", 2026-09-30).
CREATE USER 'hrms_app'@'127.0.0.1' IDENTIFIED BY '$APP_PW';
CREATE USER 'hrms_app'@'localhost' IDENTIFIED BY '$APP_PW';
GRANT ALL PRIVILEGES ON mas_hrms.* TO 'hrms_app'@'127.0.0.1', 'hrms_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, CREATE TEMPORARY TABLES, LOCK TABLES
  ON db_masmis.* TO 'hrms_app'@'127.0.0.1', 'hrms_app'@'localhost';
GRANT ALL PRIVILEGES ON Shivamgiri.* TO 'hrms_app'@'127.0.0.1', 'hrms_app'@'localhost';
GRANT SELECT ON db_audit.*    TO 'hrms_app'@'127.0.0.1', 'hrms_app'@'localhost';
GRANT SELECT ON db_external.* TO 'hrms_app'@'127.0.0.1', 'hrms_app'@'localhost';

-- Backups (mysqldump --single-transaction --source-data needs RELOAD and REPLICATION CLIENT).
CREATE USER 'hrms_backup'@'localhost' IDENTIFIED BY '$BK_PW';
GRANT SELECT, SHOW VIEW, TRIGGER, EVENT, LOCK TABLES, RELOAD, PROCESS, REPLICATION CLIENT
  ON *.* TO 'hrms_backup'@'localhost';
SQL
  say "accounts created; passwords are in $CONF_DIR/credentials.env (root only)"
else
  echo "  [dry-run] would set the root password and create hrms_app (mas_hrms ALL; db_masmis DML+CREATE/ALTER/INDEX;"
  echo "            Shivamgiri ALL; db_audit/db_external SELECT) and hrms_backup, passwords generated into $CONF_DIR/credentials.env"
fi

step "8. Install the backup and verify helpers (cron is enabled later, in Phase 3, once there is data)"
run install -o root -g root -m 750 "$HERE/02-backup.sh" /usr/local/sbin/mysql-hrms-backup
run install -o root -g root -m 755 "$HERE/03-verify.sh" /usr/local/sbin/mysql-hrms-verify

step "Done"
if [ "$MODE" = "--apply" ]; then
  say "next: sudo mysql-hrms-verify        (read-only health and parity report)"
else
  say "dry run finished; nothing was changed. Review the steps above, then re-run with --apply."
fi
