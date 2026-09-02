#!/usr/bin/env bash
# Brings up the two disposable MySQL 8 instances the KPI Studio / Client Portal UAT runs against.
#
#   uat-hrms-mysql      127.0.0.1:13306  database mas_hrms_test   <- the HRMS schema, built by
#                                                                    `migrate:fresh:test` from the
#                                                                    real migration manifest
#   uat-external-mysql  127.0.0.1:13307  database dialer_uat      <- stands in for a SEPARATE
#                                                                    system, so the
#                                                                    integration_connector source
#                                                                    type crosses a real process
#                                                                    and connection boundary rather
#                                                                    than being faked in-process
#
# Both are started with --collation-server=utf8mb4_0900_ai_ci, which is the live server default on
# this project's production host. That matters: a table created without an explicit COLLATE picks the
# server default, and joining it to a utf8mb4_unicode_ci table is a hard errno 1267 rather than a
# warning. Running UAT on the permissive utf8mb4_unicode_ci default would hide exactly the class of
# defect migration 1627 had to repair across 49 tables.
#
# Non-default ports (13306/13307) so this never collides with a local dev MySQL on 3306.
set -euo pipefail

docker rm -f uat-hrms-mysql uat-external-mysql >/dev/null 2>&1 || true

docker run -d --name uat-hrms-mysql -p 13306:3306 \
  -e MYSQL_ROOT_PASSWORD=uatroot \
  -e MYSQL_DATABASE=mas_hrms_test \
  mysql:8.0 \
  --collation-server=utf8mb4_0900_ai_ci \
  --character-set-server=utf8mb4 \
  --sql-mode="ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION" >/dev/null

docker run -d --name uat-external-mysql -p 13307:3306 \
  -e MYSQL_ROOT_PASSWORD=uatroot \
  -e MYSQL_DATABASE=dialer_uat \
  mysql:8.0 \
  --collation-server=utf8mb4_0900_ai_ci \
  --character-set-server=utf8mb4 >/dev/null

# Readiness is an AUTHENTICATED SELECT, not `mysqladmin ping`. During MySQL's own init phase the
# server answers ping while still rejecting logins, so a ping-based wait returns "ready" and the
# next statement dies with ER_ACCESS_DENIED (1045).
for container in uat-hrms-mysql uat-external-mysql; do
  printf '%s: waiting for authenticated connection' "$container"
  for _ in $(seq 1 90); do
    if docker exec "$container" mysql -uroot -puatroot -e 'SELECT 1' >/dev/null 2>&1; then
      echo " ready"
      break
    fi
    printf '.'
    sleep 2
  done
  docker exec "$container" mysql -uroot -puatroot -e 'SELECT 1' >/dev/null 2>&1 \
    || { echo " FAILED"; docker logs --tail 30 "$container"; exit 1; }
done

docker ps --filter name=uat- --format '  {{.Names}}  {{.Status}}  {{.Ports}}'
