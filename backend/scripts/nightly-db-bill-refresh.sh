#!/usr/bin/env bash
#
# Nightly db_bill -> mas_hrms mirror refresh, then proof that it worked.
#
# WHY THIS RUNS EVERY NIGHT
# -------------------------
# The mirror is what the Process P&L reads its revenue from. Billing keeps being entered in
# db_bill after any given sync, so the mirror decays continuously — measured 2026-08-05, two days
# after a full sync: Jul-26 held Rs 76.75 L of a real Rs 172.33 L, 55% of the month missing, while
# Apr/May/Jun still matched to the rupee. Old months always match because nobody edits them, so
# spot checks pass while the current month is wrong.
#
# A stale mirror does not fail loudly. The CEO Overview rendered a confident, precise -984.9%
# operating margin on it, and -84.2% once the sync was re-run, with no code change in between.
# Running nightly bounds the error to one day instead of however long since someone last noticed.
#
# The reconcile step is the point. A sync that "succeeded" proves nothing — it happily compiles
# whatever it managed to read. Only the row-and-rupee comparison against db_bill proves the mirror
# is true, and it exits non-zero when it is not.
#
# Install:
#   chmod +x backend/scripts/nightly-db-bill-refresh.sh
#   crontab -e   ->   15 2 * * * /var/www/HRMS2/backend/scripts/nightly-db-bill-refresh.sh
#
# Reads hosts and credentials from backend/.env, so it needs no arguments on the server (both
# databases are on the office LAN there). Off-LAN, pass --hrms-host / --bill-host.

set -uo pipefail

APP_DIR=/var/www/HRMS2
LOG_DIR="$APP_DIR/logs"
LOG="$LOG_DIR/db-bill-refresh.log"

cd "$APP_DIR" || exit 1
mkdir -p "$LOG_DIR"

# Keep the log from growing without bound — a month of nightly runs is plenty of history.
if [ -f "$LOG" ] && [ "$(stat -c %s "$LOG" 2>/dev/null || echo 0)" -gt 5242880 ]; then
  mv "$LOG" "$LOG.1"
fi

{
  echo "════════ $(date -Is) refresh starting ════════"

  node backend/scripts/sync-db-bill-snapshot.mjs "$@"
  SYNC_RC=$?
  echo "-------- sync exit=$SYNC_RC --------"

  # Reconcile even if the sync reported a failure: a partial sync is exactly the case where you
  # most want to know how far off the mirror now is.
  node backend/scripts/reconcile-db-bill-snapshot.mjs "$@"
  RECON_RC=$?
  echo "-------- reconcile exit=$RECON_RC --------"

  if [ "$RECON_RC" -ne 0 ]; then
    echo "!!! MIRROR DOES NOT MATCH db_bill EVEN AFTER SYNCING."
    echo "!!! Every revenue figure on Process P&L is suspect until this is resolved."
  else
    echo "Mirror verified against db_bill."
  fi

  echo "════════ $(date -Is) finished (sync=$SYNC_RC reconcile=$RECON_RC) ════════"
  echo

  exit "$RECON_RC"
} >> "$LOG" 2>&1
