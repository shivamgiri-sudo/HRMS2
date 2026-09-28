-- 1698_noc_worker_and_release_gate_flag.sql
--
-- Operational switches for the NOC Certificate workflow: the SLA reminder worker's kill switch,
-- and the kill switch for the salary-release gate itself.
--
-- Data-only. No schema, no column, no row deleted.
--
-- Depends on: 533_worker_distributed_safety.sql (worker_config), 1696/1697.

-- ---------------------------------------------------------------------------
-- 1. SLA reminder worker
-- ---------------------------------------------------------------------------
-- worker_name MUST match the WORKER_NAME constant in
-- src/workers/noc-sla-reminder.worker.ts exactly. isWorkerEnabled() fails OPEN on a missing row,
-- so a mismatch here does not disable the worker — it makes the kill switch silently
-- unusable, which is worse. The same trap is documented in sla-breach-worker.ts and
-- interview-delay-alert.worker.ts.
--
-- Seeded ENABLED, unlike tat-escalation and auto-roster-scheduler which ship off. Those two
-- carry a backlog that would fire on first run; this one cannot. It only ever selects stages that
-- are pending, past SLA, unblocked by their tier, and belong to a case whose employee has already
-- submitted the form — and no such row can exist until the tables created in 1696 start being
-- written after this deploy. Its first sweep on a fresh install finds nothing by construction.
INSERT IGNORE INTO worker_config (worker_name, enabled, description)
VALUES (
  'noc-sla-reminder',
  1,
  'NOC clearance SLA reminders and Branch Head escalation. Sweeps hourly for signatory stages past their SLA that are actionable and still pending. Never signs on a signatory''s behalf — an overdue clearance is a prompt to a human, not authority to clear it. Set enabled=0 to stop reminders; this does NOT affect the salary-release gate, which is governed by payroll_config_flags.noc_salary_release_gate_enabled.'
);

-- ---------------------------------------------------------------------------
-- 2. Salary-release gate kill switch
-- ---------------------------------------------------------------------------
-- A gate that withholds salary needs an off switch that does not require a deploy. Same mechanism
-- and same reasoning as payroll_head_review_gate_enabled, read in payrollCalculate.service.ts.
--
-- Seeded 'true' because the ruling is that the gate is mandatory. isNocReleaseGateEnabled() also
-- defaults to ON for a MISSING row, so this seed is belt-and-braces — its real purpose is to make
-- the switch DISCOVERABLE on the Config Flags screen, so whoever needs it in an emergency can find
-- it without reading source.
--
-- Note the asymmetry, which is deliberate: the function treats an unreadable flag as DISABLED
-- (fails open) while a missing flag is ENABLED (fails closed). A missing row is a normal
-- pre-migration state and must not weaken the control; an unreadable one is a database fault, and
-- refusing to pay a whole workforce because of a config read error would be a worse outcome than
-- the gap it leaves. Every withheld employee is reported by name at run validation either way, so
-- a gate that is off is visible rather than assumed.
--
-- branch_id / process_id are NULL: this is a company-wide policy, not a per-branch setting.
INSERT IGNORE INTO payroll_config_flags (id, branch_id, process_id, config_key, config_value, description)
VALUES (
  UUID(),
  NULL,
  NULL,
  'noc_salary_release_gate_enabled',
  'true',
  'When true (default), an inactive employee is excluded from the NEFT payment file until their NOC clearance is complete or Payroll Head records an override. Set to ''false'' to release salary without the NOC check — an emergency switch only; withheld employees are listed by name at run validation regardless.'
);

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- SELECT worker_name, enabled FROM worker_config WHERE worker_name = 'noc-sla-reminder';
--   -- expect 1 row, enabled=1
-- SELECT config_key, config_value FROM payroll_config_flags
--  WHERE config_key = 'noc_salary_release_gate_enabled';
--   -- expect 1 row, 'true'
