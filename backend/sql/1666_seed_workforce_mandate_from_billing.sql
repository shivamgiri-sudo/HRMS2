-- Migration 1666: seed workforce_mandate from the billing mandate figures
--
-- WHY
-- workforce_mandate is the designed home for sanctioned headcount — mandated_hc plus the
-- buffer/shrinkage/attrition/training percentages, effective-dated, unique per
-- process+branch+role_group. It has held ZERO rows in production since it was created, which is
-- why every consumer reads zero or silently falls back: portal.kpi-engine.service.ts says so in
-- its own comment, 1647_portal_kpi_config.sql refuses to seed the HC-Utilisation KPI for the same
-- reason, /api/manpower-risk/cost-center returns an empty array, process-pnl.service.ts's
-- getWorkforceMap() returns an empty map, and hc-gap-alert.cron.ts runs nightly against nothing.
--
-- The figure DOES exist, in billing. cost_center_billing_config (synced from db_bill) carries
-- current_mandate and buffer_pct per cost centre. Verified live 2026-09-03: 258 rows, 38 with
-- current_mandate > 0 (896 seats in total), buffer_pct = 10.00 on all 258, every one of the 38
-- matching cost_centre_master.cost_centre_code. That is the owner's chosen source of truth — it
-- is what the client is actually billed against — and the same rows now feed both the HR
-- Headcount & Shortage view and the process P&L workforce map.
--
-- MANDATE -> PROCESS RESOLUTION (the only judgement in this file)
-- Mandate is stored per COST CENTRE; every consumer keys on process+branch. Resolution ladder,
-- each rung measured against production before being included:
--   1. cost_centre_master.process_id where set                             672 of 896 seats
--   2. else the DOMINANT process of that cost centre's active staff          2 seats
--      (of the 20 staffed mandate centres, 13 map to exactly one process; the 7 that split
--      across two are heavily skewed — Onfido 221 vs BACK OFFICE 5, Housing.com 110 vs 6,
--      IDAM 91 vs Bella-Vita 17 — so the dominant process is unambiguous in practice)
--   3. else another cost centre of the SAME BILLING CLIENT in the same branch that did resolve
--                                                                          133 seats
--      (this is cost centre BSS/OB/AHMH-JD/474, Godfrey Philips: 133 seats on a cost-centre row
--      flagged inactive, with no process_id and no staff, while its sibling BSS/OB/AHMH-JD/465
--      carries the process and 148 people work on it. Dropping it would have understated that
--      process by 133 seats.)
--   4. else an exact process_name match against process_master              10 seats
--   5. else NOT SEEDED — 17 cost centres, 89 seats, each 25 or fewer. No process can be honestly
--      derived for these, so they are left out rather than parked on a guess. The API surfaces
--      them separately as unmapped mandate: a data-quality task for HR, not a number to invent.
--
-- cost_centre_master.active_status is deliberately NOT filtered on. 219 of the 896 seats sit on
-- cost-centre rows flagged inactive while their billing row is active and their people are at
-- work (Godfrey above is the clearest case). Billing is the chosen source of truth, so the
-- billing row's own active_status is what gates a seat.
--
-- EFFECTIVE DATING
-- effective_from is the FIRST OF THE CURRENT FINANCIAL YEAR, not today, because P&L reads this
-- table with effective_from <= period_end (process-pnl.service.ts getWorkforceMap) — dating it
-- today would leave every month already closed this year with no mandate. This asserts the
-- CURRENT contracted seat count applied from the FY start; if month-by-month accuracy is ever
-- needed, mandate_seat_history already holds the real per-period seats (339 rows) and should be
-- the source for that, not this file.
--
-- IDEMPOTENCE
-- A fixed effective_from is load-bearing: the unique key includes it, so a CURDATE()-derived
-- value would insert a second active row per process on the next run and every consumer would
-- then double-count. ON DUPLICATE KEY UPDATE deliberately refreshes mandated_hc ONLY and never
-- buffer_pct — HR edits the buffer per process from the Headcount & Shortage tab, and a re-run
-- must not discard that edit.
--
-- SIDE EFFECT, ACCEPTED KNOWINGLY
-- Populating this table makes consumers that currently show zero start showing numbers: the
-- process P&L workforce map (intended — the owner asked for the same table to drive P&L), the CEO
-- HC-gap panel, two report-suite reports and the HEADCOUNT metric's required fallback. Four
-- mutually inconsistent required-HC formulas read this table (hc-formula.service.ts,
-- workforce.mandate.service.ts, management.service.ts, dashboard-metric.service.ts); they will now
-- disagree visibly instead of agreeing on zero. Reconciling them is out of scope here.
-- revenue-risk.service.ts also reads it, but revenueRiskRouter is not mounted in app.ts, so its
-- process_revenue_daily write cannot fire — verified before writing this file.
--
-- Purely additive: one INSERT … SELECT into a table that is empty in production. No ALTER, no
-- DROP, no DELETE, no existing row touched, no FOREIGN KEY.
--
-- ROLLBACK:
--   DELETE FROM workforce_mandate WHERE created_by = 'seed-1666-billing-mandate';

INSERT INTO workforce_mandate
  (id, process_id, branch_id, role_group, hc_type, mandated_hc, buffer_pct,
   shrinkage_pct, attrition_buffer_pct, training_buffer_pct,
   effective_from, effective_to, active_status, created_by)
WITH dominant_process AS (
  -- One row per cost centre: the process most of its active staff belong to.
  SELECT cost_centre_id, process_id
  FROM (
    SELECT
      e.cost_centre_id,
      e.process_id,
      ROW_NUMBER() OVER (PARTITION BY e.cost_centre_id
                         ORDER BY COUNT(*) DESC, e.process_id) AS rn
    FROM employees e
    -- active_status = 1 alone: the canonical headcount definition (ruling 2026-08-07), so the
    -- people who decide a cost centre's process are the same people the board counts on it.
    WHERE e.active_status = 1
      AND e.cost_centre_id IS NOT NULL AND e.cost_centre_id <> ''
      AND e.process_id     IS NOT NULL AND e.process_id     <> ''
    GROUP BY e.cost_centre_id, e.process_id
  ) ranked
  WHERE ranked.rn = 1
),
billed_mandate AS (
  SELECT
    cc.branch_id                                          AS branch_id,
    NULLIF(cc.process_id, '')                             AS cc_process,
    dp.process_id                                         AS dominant_staff_process,
    TRIM(LOWER(ccbc.client_name))                         AS bill_client,
    TRIM(LOWER(ccbc.process_name))                        AS bill_process,
    ccbc.current_mandate                                  AS mandated_hc,
    ccbc.buffer_pct                                       AS buffer_pct
  FROM cost_center_billing_config ccbc
  JOIN cost_centre_master cc
    ON cc.cost_centre_code = ccbc.cost_center
  LEFT JOIN dominant_process dp
    ON dp.cost_centre_id = cc.id
  WHERE ccbc.active_status   = 1
    AND ccbc.current_mandate > 0
    AND cc.branch_id IS NOT NULL AND cc.branch_id <> ''
),
client_sibling AS (
  -- Rung 3: a cost centre of the same billing client, in the same branch, that did resolve.
  SELECT branch_id, bill_client, MIN(COALESCE(cc_process, dominant_staff_process)) AS sibling_process
  FROM billed_mandate
  WHERE COALESCE(cc_process, dominant_staff_process) IS NOT NULL
    AND bill_client IS NOT NULL AND bill_client <> ''
  GROUP BY branch_id, bill_client
)
SELECT
  UUID(),
  t.process_id,
  t.branch_id,
  'all'                        COLLATE utf8mb4_unicode_ci,
  'production',
  SUM(t.mandated_hc),
  MAX(t.buffer_pct),
  15.00, 5.00, 5.00,
  -- First of the current financial year (April in India), so this year's closed P&L months see it.
  MAKEDATE(YEAR(CURDATE()) - IF(MONTH(CURDATE()) < 4, 1, 0), 1) + INTERVAL 3 MONTH,
  NULL,
  1,
  'seed-1666-billing-mandate'  COLLATE utf8mb4_unicode_ci
FROM (
  SELECT
    bm.branch_id,
    COALESCE(bm.cc_process, bm.dominant_staff_process, cs.sibling_process, pm.id) AS process_id,
    bm.mandated_hc,
    bm.buffer_pct
  FROM billed_mandate bm
  LEFT JOIN client_sibling cs
    ON cs.branch_id = bm.branch_id AND cs.bill_client = bm.bill_client
  LEFT JOIN process_master pm
    ON TRIM(LOWER(pm.process_name)) = bm.bill_process
) t
WHERE t.process_id IS NOT NULL
GROUP BY t.branch_id, t.process_id
ON DUPLICATE KEY UPDATE
  mandated_hc   = VALUES(mandated_hc),
  active_status = 1;
