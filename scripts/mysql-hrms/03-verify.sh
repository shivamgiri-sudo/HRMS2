#!/usr/bin/env bash
# Read-only health and parity report for the dedicated HRMS instance.
# Installed as /usr/local/sbin/mysql-hrms-verify. Changes nothing. Exit code 1 if any check FAILs.
set -uo pipefail

SOCK=/run/mysqld-hrms/mysqld.sock
PORT=3307
FAILS=0
pass() { printf 'PASS  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*"; FAILS=$((FAILS + 1)); }
warn() { printf 'WARN  %s\n' "$*"; }

# shellcheck disable=SC1091
source /etc/mysql-hrms/credentials.env 2>/dev/null || { echo "need root to read credentials.env"; exit 1; }
CNF="$(mktemp)"; trap 'rm -f "$CNF"' EXIT; chmod 600 "$CNF"
printf '[client]\nuser=root\npassword=%s\nsocket=%s\n' "$HRMS_DB_ROOT_PASSWORD" "$SOCK" > "$CNF"
q() { mysql --defaults-extra-file="$CNF" -N -B -e "$1" 2>/dev/null; }

systemctl is-active --quiet mysql-hrms && pass "service mysql-hrms is active" || fail "service mysql-hrms is not active"
[ "$(q 'SELECT 1')" = "1" ] && pass "accepts queries on the socket" || { fail "cannot query the instance"; exit 1; }

listen="$(ss -ltn "( sport = :$PORT )" | awk 'NR>1 {print $4}' | sort -u | tr '\n' ' ')"
[ "$listen" = "127.0.0.1:$PORT " ] && pass "listens on 127.0.0.1:$PORT only" || fail "unexpected listeners: ${listen:-none}"

expect() {  # name, actual, expected
  if [ "$2" = "$3" ]; then pass "$1 = $2"; else fail "$1 = '$2' (expected '$3')"; fi
}
expect "version >= 8.0.42"         "$(printf '%s\n8.0.42\n' "$(q 'SELECT @@version' | cut -d- -f1)" | sort -V | head -1)" "8.0.42"
expect "collation_server"          "$(q 'SELECT @@collation_server')"        "utf8mb4_0900_ai_ci"
expect "lower_case_table_names"    "$(q 'SELECT @@lower_case_table_names')"  "0"
expect "time_zone"                 "$(q 'SELECT @@global.time_zone')"        "+05:30"
expect "sql_mode"                  "$(q 'SELECT @@global.sql_mode')"         "ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION"
expect "transaction_isolation"     "$(q 'SELECT @@transaction_isolation')"   "REPEATABLE-READ"
expect "innodb_lock_wait_timeout"  "$(q 'SELECT @@innodb_lock_wait_timeout')" "60"
expect "max_allowed_packet"        "$(q 'SELECT @@max_allowed_packet')"      "67108864"
expect "log_bin"                   "$(q 'SELECT @@log_bin')"                 "1"
expect "binlog_format"             "$(q 'SELECT @@binlog_format')"           "ROW"
expect "gtid_mode"                 "$(q 'SELECT @@gtid_mode')"               "OFF"
expect "innodb_flush_log_at_trx_commit" "$(q 'SELECT @@innodb_flush_log_at_trx_commit')" "1"
expect "buffer pool (bytes)"       "$(q 'SELECT @@innodb_buffer_pool_size')" "6442450944"
expect "performance_schema"        "$(q 'SELECT @@performance_schema')"      "1"

es="$(q 'SELECT @@event_scheduler')"
if [ "$es" = "OFF" ]; then pass "event_scheduler OFF (correct until cutover)"; else warn "event_scheduler=$es (must be OFF before cutover, ON only after)"; fi
ro="$(q 'SELECT @@read_only')"; say_ro="read_only=$ro"
if [ "$ro" = "1" ]; then pass "$say_ro (replica mode)"; else warn "$say_ro (expected 1 once replication is running, 0 after cutover)"; fi

hrms_grants="$(q "SHOW GRANTS FOR 'hrms_app'@'127.0.0.1'" | grep -c 'mas_hrms')"
[ "$hrms_grants" -ge 1 ] && pass "hrms_app has mas_hrms grants" || fail "hrms_app missing mas_hrms grants"
[ "$(q "SELECT COUNT(*) FROM mysql.user WHERE user='' OR (user='root' AND host<>'localhost')")" = "0" ] \
  && pass "no anonymous or remote root accounts" || fail "anonymous or remote root account exists"

free_gb="$(df --output=avail -BG /var | tail -1 | tr -dc '0-9')"
[ "$free_gb" -ge 60 ] && pass "/var free: ${free_gb} GB" || warn "/var free: ${free_gb} GB"
avail_gb=$(( $(awk '/MemAvailable/ {print $2}' /proc/meminfo) / 1024 / 1024 ))
[ "$avail_gb" -ge 2 ] && pass "memory available: ${avail_gb} GB" || warn "memory available: ${avail_gb} GB (risk of swapping)"

echo "--- schemas"
q "SELECT table_schema, COUNT(*) tables, ROUND(SUM(data_length+index_length)/1073741824,2) GB FROM information_schema.tables WHERE table_schema NOT IN ('mysql','sys','information_schema','performance_schema') GROUP BY table_schema" | sed 's/^/  /'
echo "--- last error-log lines"
tail -n 5 /var/mysql-hrms/mysqld-error.log 2>/dev/null | sed 's/^/  /'

echo; [ "$FAILS" -eq 0 ] && echo "RESULT: all checks passed" || echo "RESULT: $FAILS check(s) FAILED"
exit $(( FAILS > 0 ))
