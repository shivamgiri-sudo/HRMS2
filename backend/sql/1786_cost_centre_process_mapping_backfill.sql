-- 1786_cost_centre_process_mapping_backfill.sql
--
-- Owner directive, 2026-09-16 ("you have cost center id and each cost center id has process
-- id mapping then do it"): backfill cost_centre_master.process_id from data already on file,
-- so GRNs raised against these cost centres get a Process instead of leaving it blank (see
-- grn.service.ts's createUnbudgetedDraft()/createDraft(), which now fall back to
-- cost_centre_master.process_id when the budget line doesn't carry one — 1786's companion
-- code change, same date).
--
-- Two independent, both-conservative passes. Neither ever overwrites an existing
-- cost_centre_master.process_id, and neither guesses: a cost centre is left untouched rather
-- than assigned a process it cannot be confidently tied to.
--
-- Pass 1 — legacy billing name match. cost_centre_master.process_name_bill carries the
-- process/client name from the old billing system for cost centres that predate this HRMS's
-- own process_id column. Where that name matches a process_master.process_name exactly
-- (case/whitespace-insensitive), scoped to the same branch (or an org-wide process with
-- branch_id NULL), the match is applied. Live-checked 2026-09-16: this resolves only 2 rows —
-- most legacy names ("Hero Fin Corp", "SNAP DEAL", "PAYTM MONEY LIMITED", ...) do not exist in
-- process_master at all, so there is nothing here for the other ~540 to match against.
--
-- Pass 2 — employee-derived mapping. employees carries its own cost_centre_id and process_id
-- (21,577 rows have both). Where every employee currently assigned to a cost centre agrees on
-- exactly one process_id, that process is the cost centre's. Live-checked 2026-09-16: 192 of
-- the still-unmapped cost centres have any employees at all, of which 54 are unanimous — those
-- 54 are backfilled here. The other 138 have employees split across several processes (that
-- cost centre is shared/back-office, not process-exclusive) and 430 have no employees at all
-- (dormant/historical cost centres) — both are deliberately left NULL rather than guessed at,
-- since a wrong Process here would misattribute real cost/P&L data.
--
-- Idempotent: both UPDATEs are scoped to `process_id IS NULL OR process_id = ''`, so a re-run
-- changes nothing once applied. Verification query at the bottom.

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- Pass 1: legacy billing name match
-- ---------------------------------------------------------------------------
UPDATE cost_centre_master cc
  JOIN process_master pm
    ON LOWER(TRIM(pm.process_name)) = LOWER(TRIM(cc.process_name_bill))
   AND (pm.branch_id = cc.branch_id OR pm.branch_id IS NULL)
   SET cc.process_id = pm.id
 WHERE (cc.process_id IS NULL OR cc.process_id = '')
   AND cc.process_name_bill IS NOT NULL AND cc.process_name_bill <> '';

-- ---------------------------------------------------------------------------
-- Pass 2: unambiguous employee-derived mapping
-- ---------------------------------------------------------------------------
UPDATE cost_centre_master cc
  JOIN (
    SELECT cost_centre_id, MIN(process_id) AS process_id
      FROM employees
     WHERE cost_centre_id IS NOT NULL AND process_id IS NOT NULL
     GROUP BY cost_centre_id
    HAVING COUNT(DISTINCT process_id) = 1
  ) x ON x.cost_centre_id = cc.id
   SET cc.process_id = x.process_id
 WHERE (cc.process_id IS NULL OR cc.process_id = '');

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- SELECT COUNT(*) AS with_process_id FROM cost_centre_master WHERE process_id IS NOT NULL AND process_id <> '';
--   -- expect ~120 (44 pre-existing + 2 from Pass 1 + 54 from Pass 2, plus any that gained
--   -- employees/name matches since the 2026-09-16 live check above)
