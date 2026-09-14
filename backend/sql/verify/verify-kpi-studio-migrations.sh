#!/usr/bin/env bash
#
# Executes 1644_kpi_studio_foundation.sql and 1645_kpi_studio_resolution.sql against a
# throwaway MySQL 8 container and asserts the outcome, rather than reading the SQL and hoping.
#
# This exists because reading a migration is not verifying it. The comment block in
# kpi-master.service.ts's effectiveDatingPredicate() records what happens otherwise: two
# effective-dating columns already existed on production, NULL on all 372 rows, so a support
# check found them, switched a filter on, `NULL <= CURDATE()` was never true, and every
# employee would have resolved to zero KPIs. That was caught by executing the migration against
# a throwaway schema. This script is that step, kept runnable.
#
# The container is deliberately started with --collation-server=utf8mb4_0900_ai_ci to match the
# production server default. A COLLATE clause missing from a migration then reproduces the real
# drift (errno 1267 on a later join, the defect migration 1627 had to repair across 49 tables)
# instead of being masked by a conveniently matching server default. Assertion C fails if any
# column lands on anything other than utf8mb4_unicode_ci.
#
# Usage:  bash backend/sql/verify/verify-kpi-studio-migrations.sh
# Requires: a working docker daemon. Exits non-zero on the first failed assertion.

set -euo pipefail

CONTAINER="kpi-studio-migtest-$$"
SQL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
METRIC='11111111-1111-1111-1111-111111111111'
EMPLOYEE='22222222-2222-2222-2222-222222222222'
FAILURES=0

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

mysql_exec() { docker exec -i "$CONTAINER" mysql -uroot -pthrowaway mig_test "$@" 2>&1 | grep -v "Using a password" || true; }
mysql_file() {
  if docker exec -i "$CONTAINER" mysql -uroot -pthrowaway mig_test < "$1" 2>/tmp/kpi-mig-err.$$; then
    return 0
  fi
  echo "  FAILED applying $1:"
  grep -v "Using a password" /tmp/kpi-mig-err.$$ | sed 's/^/    /'
  return 1
}

# Asserts a single-value query returns the expected string.
assert_eq() {
  local label="$1" query="$2" expected="$3"
  local actual
  actual="$(docker exec -i "$CONTAINER" mysql -uroot -pthrowaway -N -B mig_test -e "$query" 2>/dev/null | tr -d '\r')"
  if [[ "$actual" == "$expected" ]]; then
    echo "  PASS  $label"
  else
    echo "  FAIL  $label"
    echo "        expected: $expected"
    echo "        actual:   $actual"
    FAILURES=$((FAILURES + 1))
  fi
}

echo "Starting throwaway MySQL 8 (server collation utf8mb4_0900_ai_ci, as production)..."
docker run -d --rm --name "$CONTAINER" \
  -e MYSQL_ROOT_PASSWORD=throwaway -e MYSQL_DATABASE=mig_test \
  mysql:8.0 --collation-server=utf8mb4_0900_ai_ci --character-set-server=utf8mb4 >/dev/null

for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" mysqladmin ping -uroot -pthrowaway --silent >/dev/null 2>&1; then break; fi
  sleep 2
done

echo "Applying fixture and migrations..."
mysql_file "$SQL_DIR/verify/kpi_studio_migration_fixture.sql"
mysql_file "$SQL_DIR/1644_kpi_studio_foundation.sql"
mysql_file "$SQL_DIR/1645_kpi_studio_resolution.sql"

echo
echo "Schema assertions:"

assert_eq "resolved_from gained exactly one value, keeping the original four" \
  "SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='mig_test' AND TABLE_NAME='kpi_employee_resolved' AND COLUMN_NAME='resolved_from'" \
  "enum('process','cost_centre','designation','department','kpi_studio')"

# A MODIFY that dropped the original values would have truncated this pre-existing row to ''.
assert_eq "the pre-existing resolved row was not truncated by the enum MODIFY" \
  "SELECT resolved_from FROM kpi_employee_resolved WHERE target_value = 240.0000" \
  "process"

assert_eq "all six Studio tables exist" \
  "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='mig_test' AND TABLE_NAME LIKE 'kpi_studio%'" \
  "6"

assert_eq "all six new columns exist on kpi_employee_resolved" \
  "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='mig_test' AND TABLE_NAME='kpi_employee_resolved' AND COLUMN_NAME IN ('studio_definition_id','formula_expression','data_source_id','aggregation_method','scoring_type','resolved_scope')" \
  "6"

# The drift trap. Any non-zero count here is a missing COLLATE clause.
assert_eq "NO column drifted to the server default collation" \
  "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='mig_test' AND COLLATION_NAME IS NOT NULL AND COLLATION_NAME <> 'utf8mb4_unicode_ci'" \
  "0"

# Must match MAX_EXPRESSION_LENGTH in kpi-formula.engine.ts, or the builder can validate a
# formula it then cannot save.
assert_eq "formula_expression is wide enough for the engine's limit" \
  "SELECT CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='mig_test' AND TABLE_NAME='kpi_employee_resolved' AND COLUMN_NAME='formula_expression'" \
  "2000"

# NULL must mean "inherit the metric's own", so a NOT NULL DEFAULT would be wrong here.
assert_eq "aggregation_method is nullable so it can mean 'inherit'" \
  "SELECT IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='mig_test' AND TABLE_NAME='kpi_employee_resolved' AND COLUMN_NAME='aggregation_method'" \
  "YES"

echo
echo "Idempotency (replay both files against the migrated schema):"
mysql_file "$SQL_DIR/1644_kpi_studio_foundation.sql" && echo "  PASS  1644 replays cleanly"
mysql_file "$SQL_DIR/1645_kpi_studio_resolution.sql" && echo "  PASS  1645 replays cleanly"

assert_eq "the replay did not duplicate the seeded data sources" \
  "SELECT COUNT(*) FROM kpi_studio_data_source" "2"

echo
echo "Behaviour assertions:"

assert_eq "resolved_from accepts 'kpi_studio' under STRICT_TRANS_TABLES" \
  "INSERT INTO kpi_employee_resolved (employee_id, metric_id, target_value, resolved_from, resolved_scope)
     VALUES ('$EMPLOYEE','$METRIC',300,'kpi_studio','process+designation')
   ON DUPLICATE KEY UPDATE resolved_from=VALUES(resolved_from);
   SELECT resolved_from FROM kpi_employee_resolved WHERE employee_id='$EMPLOYEE'" \
  "kpi_studio"

mysql_exec -e "INSERT INTO kpi_studio_definition (metric_id, process_id, designation_id, target_value, effective_from)
                 VALUES ('$METRIC','proc-A','desig-X', 240, '2026-01-01')" >/dev/null

# NULL never equals NULL in SQL, so without the generated column a unique index could not stop
# the same scope being defined twice.
assert_eq "scope_key renders an absent scope part as '~' rather than NULL" \
  "SELECT scope_key FROM kpi_studio_definition WHERE designation_id='desig-X' AND effective_from='2026-01-01'" \
  "~|proc-A|desig-X|~"

DUPLICATE_ERROR="$(mysql_exec -e "INSERT INTO kpi_studio_definition (metric_id, process_id, designation_id, target_value, effective_from)
                                    VALUES ('$METRIC','proc-A','desig-X', 999, '2026-01-01')" || true)"
if grep -q "Duplicate entry" <<<"$DUPLICATE_ERROR"; then
  echo "  PASS  defining the same scope twice for one metric and date is rejected"
else
  echo "  FAIL  a duplicate scope was accepted — the unique index is not doing its job"
  FAILURES=$((FAILURES + 1))
fi

mysql_exec -e "INSERT INTO kpi_studio_definition (metric_id, process_id, designation_id, target_value, effective_from)
                 VALUES ('$METRIC','proc-A','desig-X', 220, '2026-07-01')" >/dev/null
assert_eq "a superseding row on a later date IS allowed (effective dating)" \
  "SELECT COUNT(*) FROM kpi_studio_definition WHERE designation_id='desig-X'" "2"

mysql_exec -e "INSERT INTO kpi_studio_manual_value (employee_id, field_name, value_date, field_value)
                 VALUES ('$EMPLOYEE','audited_calls','2026-08-01', 40)
               ON DUPLICATE KEY UPDATE field_value=VALUES(field_value);
               INSERT INTO kpi_studio_manual_value (employee_id, field_name, value_date, field_value)
                 VALUES ('$EMPLOYEE','audited_calls','2026-08-01', 55)
               ON DUPLICATE KEY UPDATE field_value=VALUES(field_value)" >/dev/null
assert_eq "a corrected re-upload replaces the figure instead of double-counting it" \
  "SELECT CONCAT(COUNT(*), ':', MAX(field_value)) FROM kpi_studio_manual_value" \
  "1:55.0000"

mysql_exec -e "INSERT INTO kpi_studio_computation_log
                 (metric_id, employee_id, score_date, formula_expression, inputs_json, computed_value, status, null_reason)
               VALUES ('$METRIC','$EMPLOYEE','2026-08-01','(talk_seconds + dispo_seconds) / calls',
                       JSON_OBJECT('talk_seconds',1200,'dispo_seconds',300,'calls',0), NULL, 'no_data', 'Division by zero')" >/dev/null
assert_eq "the computation log keeps the inputs a null result was produced from" \
  "SELECT CONCAT(status, ':', JSON_EXTRACT(inputs_json,'\$.calls')) FROM kpi_studio_computation_log" \
  "no_data:0"

echo
if [[ "$FAILURES" -eq 0 ]]; then
  echo "All assertions passed."
else
  echo "$FAILURES assertion(s) FAILED."
  exit 1
fi
