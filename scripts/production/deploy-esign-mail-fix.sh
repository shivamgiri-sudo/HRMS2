#!/usr/bin/env bash
#
# Deploys cc1d03f4 (esign mail-storm fix + worker consolidation) to production.
#
# Run ON THE SERVER:
#   ssh masadmin@192.168.11.225
#   bash /var/www/HRMS2/scripts/production/deploy-esign-mail-fix.sh
#
# Or from Windows in one shot:
#   $env:SSHPASS='...'; sshpass -e ssh masadmin@192.168.11.225 \
#     "cd /var/www/HRMS2 && git fetch origin main -q && git checkout cc1d03f4 -- scripts/production/deploy-esign-mail-fix.sh && bash scripts/production/deploy-esign-mail-fix.sh"
#
# ALREADY DONE (2026-08-08 13:12 IST), do not repeat:
#   - cc1d03f4 pushed to origin/main and verified present by content
#   - backend/dist and dist backed up to
#     /home/masadmin/hrms2-deploy-backups/{backend,frontend}-dist-20260808-131159.tgz
#     plus the 10 pre-existing source files under src-20260808-131159/
#   - `git fetch origin main` run on the server; cc1d03f4 is available locally
#   - confirmed NONE of the 12 target files has server-side modifications
#
# WHY THIS IS TARGETED RATHER THAN `git pull`:
# The server working tree has 1,071 dirty files. 249 of them differ in real
# content (all backend/sql/*), not just CRLF, so a pull/reset would overwrite
# server-side state. This touches only the 12 paths the fix owns.

set -u
cd /var/www/HRMS2 || exit 1

SHA=cc1d03f4
PATHS="backend/sql/1109_esign_notification_cooldown.sql \
backend/src/app.ts \
backend/src/db/runPendingMigrations.ts \
backend/src/modules/communication/builtin-templates.ts \
backend/src/modules/communication/notification-event.service.ts \
backend/src/server.ts \
backend/src/workers/all-workers.ts \
backend/src/workers/esign-compliance.worker.ts \
src/lib/publicJson.ts \
src/pages/EmployeeJoiningKitEsignPage.tsx \
src/pages/EmployeeDocumentEsignReviewPage.tsx \
src/pages/EmployeeEpfComplianceReviewPage.tsx"

echo "=== 1. apply the 12 paths from $SHA ==="
git fetch origin main -q
git checkout "$SHA" -- $PATHS || { echo "CHECKOUT FAILED — nothing changed"; exit 1; }

echo "    builtin-templates boundTo : $(grep -c boundTo backend/src/modules/communication/builtin-templates.ts)"
echo "    worker cooldown table     : $(grep -c esign_notification_cooldown backend/src/workers/esign-compliance.worker.ts)"
echo "    all-workers mcnmeet entry : $(grep -c 'name: "mcnmeet"' backend/src/workers/all-workers.ts)"
echo "    migration 1109 present    : $(test -f backend/sql/1109_esign_notification_cooldown.sql && echo yes || echo NO)"
echo "    app.ts module-scope crons : $(grep -cE '^start[A-Za-z]*\(' backend/src/app.ts)  (must be 0)"

echo "=== 2. backend build ==="
# backend/package.json build is `tsc --noEmitOnError false`, so a FAILED build
# still overwrites dist/. The exit code is the only trustworthy signal — never
# restart pm2 without checking it.
( cd backend && npm run build ) > /tmp/be-build.log 2>&1
BE=$?
echo "    BACKEND_EXIT=$BE   TS_ERRORS=$(grep -cE 'error TS' /tmp/be-build.log)"
if [ "$BE" -ne 0 ]; then
  echo "BACKEND BUILD FAILED — dist is now suspect. Restore and stop:"
  echo "  tar -xzf /home/masadmin/hrms2-deploy-backups/backend-dist-20260808-131159.tgz -C /var/www/HRMS2"
  tail -30 /tmp/be-build.log
  exit 1
fi

echo "=== 3. frontend build (nginx serves /var/www/HRMS2/dist) ==="
npm run build > /tmp/fe-build.log 2>&1
FE=$?
echo "    FRONTEND_EXIT=$FE"
if [ "$FE" -ne 0 ]; then
  echo "FRONTEND BUILD FAILED — backend is built but not restarted. Restore frontend:"
  echo "  tar -xzf /home/masadmin/hrms2-deploy-backups/frontend-dist-20260808-131159.tgz -C /var/www/HRMS2"
  tail -30 /tmp/fe-build.log
  exit 1
fi

echo "=== 4. restart (this also applies migration 1109 at boot) ==="
pm2 restart hrms2-backend hrms2-workers --update-env
sleep 20
pm2 list

echo "=== 5. verify ==="
echo "-- migration 1109 applied? --"
grep -iE "1109|esign_notification_cooldown" /tmp/be-build.log >/dev/null 2>&1
pm2 logs hrms2-backend --lines 80 --nostream 2>/dev/null | grep -iE "1109|migration|health" | tail -10

echo "-- health --"
curl -s -o /dev/null -w "api health: %{http_code}\n" http://localhost:5055/api/health

echo "-- the storm should now be OFF: worker_config must show enabled=0 --"
echo "   mysql> SELECT worker_name, enabled FROM worker_config WHERE worker_name='esign-compliance';"
echo "   mysql> SELECT COUNT(*) FROM dispatch_log WHERE created_at >= NOW() - INTERVAL 15 MINUTE;"
echo
echo "Re-enable ONLY after esign_notification_cooldown is seen filling:"
echo "   UPDATE worker_config SET enabled = 1 WHERE worker_name = 'esign-compliance';"
