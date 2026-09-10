-- 1696_noc_certificate_exit_clearance.sql
--
-- The NOC Certificate (Exit Clearance) workflow: the paper form Mas Callnet circulates for a
-- leaving employee, turned into a system-driven process, and the record that makes
-- "no NOC, no salary release" enforceable.
--
-- WHAT EXISTED BEFORE, AND WHY IT WAS NOT THIS
--
-- 337_noc_workflow.sql created payroll_noc: one uploaded file, one validator. That models a
-- SCAN of the completed paper NOC — Branch Payroll uploads a PDF, Head Payroll marks it
-- validated. It has no representation of the eight signatories the form actually carries, so
-- who verified what was invisible; Head Payroll was validating a JPEG.
--
-- It also gated nothing it claimed to gate. nocValidated() had exactly one caller in the whole
-- backend (finalExitBlockers() in exit.secure.routes.ts) and NOTHING in payroll read payroll_noc
-- before paying — not updateRunStatus's locked/disbursed branch, not the NEFT payable query, not
-- run validation, not F&F approval. The message on PATCH /api/payroll/noc/:id/validate reads
-- "Salary/FNF processing unblocked", which was untrue: an inactive employee with a positive
-- salary_prep_line went straight into the bank file.
--
-- payroll_noc is NOT replaced. It stays as the attachment record for the signed physical form
-- (see payroll_noc.noc_case_id at the end of this file), because the wet-ink copy is still filed.
--
-- WHY NOT exit_clearance_task
--
-- It cannot express this: no sequence column, no branch on the row, no enforcement that the
-- owning department is the one clearing (declared out of scope at exit.routes.ts:108-113), no
-- Branch Manager or Accounts or Finance stage, and its 8 rows come from a hardcoded TypeScript
-- array rather than a template table. Decisively, 20+ read sites — the F&F approval guard, the
-- exit FSM blocker, work-inbox routing, the clearance-status register, notifications — treat it
-- as a flat COUNT of open items. Adding ordering and per-stage authority would silently change
-- the meaning of the table underneath every one of them. It remains the coarse readiness signal
-- those sites consume; the NOC lives here.
--
-- ANCHORED ON THE EMPLOYEE, NOT THE EXIT REQUEST
--
-- exit_request_id is NULLABLE deliberately. The release rule is "an inactive employee who is
-- owed money needs a NOC", and employment_status goes non-active for people who never filed a
-- formal resignation — nocRequired() keys on employment_status alone, and there are ~28,425
-- non-active employee rows. Hanging the case off exit_request would leave precisely the
-- population the gate exists for ungated.
--
-- TIER ORDER vs THE NUMBERS PRINTED ON THE FORM
--
-- The form lists signatories 1-8 as TL, Process Manager, HR, Branch Manager, IT, Admin,
-- Accounts, Finance. The escalation hierarchy is a different order: TL -> Process Manager ->
-- Branch Manager -> HR (central verification) -> IT / Admin / Accounts / Finance in parallel.
-- Both are true, and they are two different things, so they get two columns: display_no
-- reproduces the certificate, tier drives who may act when. Collapsing them into one number is
-- how the printed document and the workflow would drift apart.
--
-- DECLINE IS A LOCK, NOT A STATE TO CARRY ON FROM
--
-- Any signatory selecting Declined freezes the case (noc_case.status='declined') and routes it
-- to HR for manual resolution. There is no automatic path onward: the workflow must not
-- silently continue past a refusal. Reopening is an explicit HR act, recorded in noc_case_event.
--
-- Additive and idempotent: seven new tables, one seeded role, one nullable column on
-- payroll_noc. No existing row is read or written and no payroll figure is touched.

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. The Accounts role.
-- ─────────────────────────────────────────────────────────────────────────────
-- Signatory 7 is "Accounts", and there is no `accounts` role_key anywhere in this codebase —
-- verified against every workforce_role_catalog seed (003, 045, 170, 179, 181, 198, 268, 269,
-- 270, 276, 295, 432, 537, 1004, 1137, 1689). The Finance family holds finance, finance_head,
-- payroll, payroll_head, payroll_hr, payroll_admin, payroll_branch and branch_finance, none of
-- which means Accounts.
--
-- Seeded here rather than mapped onto `finance`, because collapsing the two would make one
-- team's sign-off satisfy the other's and the form deliberately asks for both. Until Accounts
-- users are actually granted this role, the stage's fallback_role_key ('finance') keeps it
-- actionable — so this cannot strand a live case, but it does need an access grant to be
-- meaningful. INSERT IGNORE, so an installation that already has the role keeps its own row.
INSERT IGNORE INTO workforce_role_catalog (role_key, role_name, description, active_status)
VALUES ('accounts', 'Accounts', 'Accounts team — vendor, reimbursement and dues clearance', 1);

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Signatory template — the eight roles.
-- ─────────────────────────────────────────────────────────────────────────────
-- role_key holds the LITERAL user_roles.role_key. hasScopedAccess() reads user_roles directly
-- and performs no alias expansion (scopeAccess.ts getUserRoleKeys), so an alias here would
-- silently deny every holder of the real role.
--
-- fallback_role_key exists because several of these roles have compat aliases whose mirroring
-- cannot be assumed to have run: 045_role_compat.sql mirrors tl -> team_leader and
-- manager -> process_manager, and installations differ on which one a given user holds.
-- Accepting both is cheaper than betting on the mirror.
CREATE TABLE IF NOT EXISTS noc_signatory_template (
  id                       CHAR(36)     NOT NULL,
  -- Position on the printed certificate (1-8, matching the paper form).
  display_no               TINYINT UNSIGNED NOT NULL,
  -- Approval order. Equal tiers act in parallel; a tier opens only when every
  -- signatory in every lower tier has accepted or acknowledged.
  tier                     TINYINT UNSIGNED NOT NULL,
  stage_key                VARCHAR(40)  NOT NULL,
  stage_label              VARCHAR(120) NOT NULL,
  role_key                 VARCHAR(80)  NOT NULL,
  fallback_role_key        VARCHAR(80)  NULL,
  -- Finance only. Blocks the sign-off while any mandatory asset is unreturned and unwaived,
  -- carrying over the declaration printed on the paper form.
  requires_asset_clearance TINYINT(1)   NOT NULL DEFAULT 0,
  -- Hours before this signatory's pending sign-off is treated as an SLA breach and the
  -- reminder/escalation worker acts on it.
  sla_hours                SMALLINT UNSIGNED NOT NULL DEFAULT 48,
  -- Shown to the signatory so they are told what they are certifying rather than
  -- presented with a bare Accept button.
  verify_hint              VARCHAR(400) NULL,
  active_status            TINYINT(1)   NOT NULL DEFAULT 1,
  created_at               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_noc_sig_tpl_stage (stage_key),
  UNIQUE KEY uq_noc_sig_tpl_display (display_no),
  KEY idx_noc_sig_tpl_tier (tier, active_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO noc_signatory_template
  (id, display_no, tier, stage_key, stage_label, role_key, fallback_role_key,
   requires_asset_clearance, sla_hours, verify_hint)
VALUES
  (UUID(), 1, 1, 'team_leader',     'Team Leader',      'tl',              'team_leader',   0, 48,
   'Confirm shift handover, pending work and that no queue or roster dependency remains open.'),
  (UUID(), 2, 2, 'process_manager', 'Process Manager',  'process_manager', 'manager',       0, 48,
   'Confirm knowledge transfer, client dependency closure and process-level handover.'),
  (UUID(), 4, 3, 'branch_manager',  'Branch Manager',   'branch_head',     NULL,            0, 48,
   'Confirm branch-level release: attendance, discipline and that operations can absorb the exit.'),
  (UUID(), 3, 4, 'hr',              'HR',               'hr',              'branch_hr',     0, 48,
   'Central verification: resignation acceptance, notice period or waiver, Last Working Day and exit interview.'),
  (UUID(), 5, 5, 'it',              'IT',               'branch_it',       'it',            0, 48,
   'Confirm every assigned asset is accounted for and email, VPN and application access is closed.'),
  (UUID(), 6, 5, 'admin',           'Admin',            'branch_admin',    'admin',         0, 48,
   'Confirm ID card, access card and branch-issued property have been handed over.'),
  (UUID(), 7, 5, 'accounts',        'Accounts',         'accounts',        'finance',        0, 48,
   'Confirm advances, reimbursements, vendor dues and any recoverable balance are settled.'),
  (UUID(), 8, 5, 'finance',         'Finance',          'finance',         'finance_head',  1, 48,
   'Final financial clearance. Blocked until every mandatory company asset is Returned or explicitly waived by Admin/IT.');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Asset item template — the form's six rows plus the declaration's four.
-- ─────────────────────────────────────────────────────────────────────────────
-- The printed table lists six items (ID Card, Laptop/Computer, SIM Card, Mobile, Storage
-- Devices, Others). The employee declaration beneath it names a DIFFERENT set as the
-- precondition for FNF/NOC — "Desktop (TFT), Keyboard, CPU, Mouse, ID Card" — and only ID Card
-- appears in both. Enforcing only the six would let the declaration's items through unchecked,
-- so all ten are tracked and is_mandatory_for_finance marks exactly the five the declaration
-- names. shown_on_form keeps the certificate printing the original six.
CREATE TABLE IF NOT EXISTS noc_asset_item_template (
  id                       CHAR(36)     NOT NULL,
  item_no                  TINYINT UNSIGNED NOT NULL,
  item_code                VARCHAR(40)  NOT NULL,
  item_label               VARCHAR(120) NOT NULL,
  default_qty              SMALLINT UNSIGNED NULL,
  is_mandatory_for_finance TINYINT(1)   NOT NULL DEFAULT 0,
  shown_on_form            TINYINT(1)   NOT NULL DEFAULT 1,
  active_status            TINYINT(1)   NOT NULL DEFAULT 1,
  created_at               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_noc_asset_tpl_code (item_code),
  KEY idx_noc_asset_tpl_no (item_no, active_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO noc_asset_item_template
  (id, item_no, item_code, item_label, default_qty, is_mandatory_for_finance, shown_on_form)
VALUES
  -- The six rows printed on the certificate.
  (UUID(),  1, 'ID_CARD',        'ID Card',            1,    1, 1),
  (UUID(),  2, 'LAPTOP',         'Laptop / Computer',  NULL, 0, 1),
  (UUID(),  3, 'SIM_CARD',       'SIM Card',           NULL, 0, 1),
  (UUID(),  4, 'MOBILE',         'Mobile',             NULL, 0, 1),
  (UUID(),  5, 'STORAGE_DEVICE', 'Storage Devices',    NULL, 0, 1),
  (UUID(),  6, 'OTHERS',         'Others',             NULL, 0, 1),
  -- Named by the employee declaration as blocking FNF/NOC, but absent from the table above.
  (UUID(),  7, 'DESKTOP_TFT',    'Desktop (TFT)',      NULL, 1, 0),
  (UUID(),  8, 'KEYBOARD',       'Keyboard',           NULL, 1, 0),
  (UUID(),  9, 'CPU',            'CPU',                NULL, 1, 0),
  (UUID(), 10, 'MOUSE',          'Mouse',              NULL, 1, 0);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. The case — one NOC certificate per leaver.
-- ─────────────────────────────────────────────────────────────────────────────
-- The employee_* / location / portfolio / designation columns are a SNAPSHOT taken when the
-- form is opened, not a join. The certificate is a document about a moment; a later transfer,
-- promotion or branch correction must not silently rewrite a clearance somebody already signed.
-- This is the same reasoning that freezes branch_id/cost_centre_id onto salary_prep_line.
--
-- branch_id/process_id are likewise captured at open time, because signatory authority is
-- resolved per branch — an employee whose branch is corrected mid-chain must not transfer
-- authority to a different branch's Admin and IT halfway through their own clearance.
--
-- No FOREIGN KEYs, matching payroll_noc (337) and exit_clearance_task (1506): this project has
-- hit the collation-mismatch trap on FK-to-employees before, and neither neighbour carries them.
CREATE TABLE IF NOT EXISTS noc_case (
  id                     CHAR(36)     NOT NULL,
  employee_id            CHAR(36)     NOT NULL,
  exit_request_id        CHAR(36)     NULL,
  branch_id              CHAR(36)     NULL,
  process_id             CHAR(36)     NULL,

  -- ── Identity snapshot: auto-filled, read-only on the form ──
  employee_code          VARCHAR(50)  NULL,
  employee_name          VARCHAR(200) NULL,
  location               VARCHAR(150) NULL,   -- branch_master.branch_name at open time
  portfolio              VARCHAR(150) NULL,   -- process_master.process_name at open time
  designation            VARCHAR(150) NULL,

  -- ── Who started it, and therefore who gets copied ──
  -- The escalation matrix notifies the levels ABOVE the initiator and never below, so the
  -- initiating role has to be recorded rather than inferred from the actor's current roles
  -- (a user can hold several, and the matrix would then be ambiguous).
  initiator_role         VARCHAR(40)  NULL,
  initiated_by_user_id   CHAR(36)     NULL,
  initiated_at           DATETIME     NULL,

  -- ── Employee-entered ──
  resignation_date       DATE         NULL,
  reason_for_leaving     TEXT         NULL,
  employee_submitted_at  DATETIME     NULL,
  -- Captured on the public submit so the employee's declaration carries the same evidentiary
  -- weight as a signatory action. actor_type='public_token' is the established convention.
  employee_ip_address    VARCHAR(64)  NULL,
  employee_user_agent    VARCHAR(512) NULL,

  -- ── HR-entered ──
  -- Nullable and separate from resignation_date because it is only known once notice period or
  -- waiver is settled, which is after the employee has already submitted the form.
  last_working_day       DATE         NULL,
  lwd_set_by             CHAR(36)     NULL,
  lwd_set_at             DATETIME     NULL,

  -- ── Salary / FNF processing route ──
  -- suggested_* is what the system computed from clearance completion vs Last Working Day and
  -- the payroll cut-off; the plain column is what Finance actually chose. Kept apart so an
  -- override is visible as an override instead of overwriting the recommendation that was made.
  fnf_option_suggested   ENUM('current_payroll','45_days','both') NULL,
  fnf_option             ENUM('current_payroll','45_days','both') NULL,
  fnf_option_set_by      CHAR(36)     NULL,
  fnf_option_set_at      DATETIME     NULL,

  -- ── Lifecycle ──
  -- 'declined' is terminal until HR explicitly reopens: the workflow must never continue past
  -- a refusal. 'completed' is the only state (absent an override) that releases salary.
  status                 ENUM('invited','employee_submitted','in_progress','declined','completed','cancelled')
                                      NOT NULL DEFAULT 'invited',
  declined_stage_key     VARCHAR(40)  NULL,
  declined_by            CHAR(36)     NULL,
  declined_at            DATETIME     NULL,
  decline_reason         VARCHAR(700) NULL,
  completed_at           DATETIME     NULL,

  -- ── Payroll Head salary-release override ──
  -- Deliberately NOT a status value: an overridden case must never be indistinguishable from
  -- one the signatories actually cleared, so status stays as it was and the release predicate
  -- tests these columns separately. Restricted to payroll_head and super_admin in the service.
  override_by            CHAR(36)     NULL,
  override_at            DATETIME     NULL,
  override_reason        TEXT         NULL,

  created_at             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- One NOC per leaver. A second exit for a rehired employee reopens this case rather than
  -- racing a duplicate: two open cases would each satisfy the release gate independently.
  UNIQUE KEY uq_noc_case_employee (employee_id),
  KEY idx_noc_case_status (status),
  KEY idx_noc_case_branch (branch_id, status),
  KEY idx_noc_case_exit (exit_request_id),
  KEY idx_noc_case_lwd (last_working_day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. The eight signatories of one case.
-- ─────────────────────────────────────────────────────────────────────────────
-- stage_label / role_key / tier / display_no are COPIED from the template rather than joined at
-- read time. Retitling a stage or repointing it to a different role must not rewrite what
-- somebody already signed.
--
-- acted_by_name is stored as text alongside acted_by_user_id: the certificate reproduces the
-- signatory's NAME, and resolving it by join at print time would change a historical document
-- when someone's record is edited or their employee row is deactivated.
--
-- ip_address / user_agent are what substitute for a wet signature's evidentiary weight. Without
-- them the "digital signature" is a row anyone with database access could have written.
CREATE TABLE IF NOT EXISTS noc_signatory (
  id                       CHAR(36)     NOT NULL,
  noc_case_id              CHAR(36)     NOT NULL,
  display_no               TINYINT UNSIGNED NOT NULL,
  tier                     TINYINT UNSIGNED NOT NULL,
  stage_key                VARCHAR(40)  NOT NULL,
  stage_label              VARCHAR(120) NOT NULL,
  role_key                 VARCHAR(80)  NOT NULL,
  fallback_role_key        VARCHAR(80)  NULL,
  requires_asset_clearance TINYINT(1)   NOT NULL DEFAULT 0,

  status                   ENUM('pending','accepted','acknowledged','declined') NOT NULL DEFAULT 'pending',
  acted_by_user_id         CHAR(36)     NULL,
  acted_by_employee_id     CHAR(36)     NULL,
  acted_by_name            VARCHAR(200) NULL,
  acted_by_role            VARCHAR(80)  NULL,
  acted_at                 DATETIME     NULL,
  remarks                  VARCHAR(700) NULL,
  ip_address               VARCHAR(64)  NULL,
  user_agent               VARCHAR(512) NULL,

  -- ── SLA ──
  -- sla_due_at is set when the stage becomes actionable, not when the case opens: a tier-5
  -- signatory who cannot act until HR clears must not accrue a breach while blocked.
  notified_at              DATETIME     NULL,
  sla_due_at               DATETIME     NULL,
  reminder_count           SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  last_reminder_at         DATETIME     NULL,
  escalated_at             DATETIME     NULL,

  created_at               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_noc_signatory (noc_case_id, stage_key),
  KEY idx_noc_signatory_status (noc_case_id, status),
  KEY idx_noc_signatory_role (role_key, status),
  -- Drives the reminder worker's "pending and overdue" sweep.
  KEY idx_noc_signatory_sla (status, sla_due_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Asset return rows for one case.
-- ─────────────────────────────────────────────────────────────────────────────
-- status defaults to 'na' rather than 'not_returned'. 'not_returned' is an assertion that the
-- employee is holding company property, and defaulting to it would put every case into
-- apparent breach before anyone had looked — which is how a mandatory gate becomes a formality
-- people click past. 'na' means "nothing recorded yet" and does NOT satisfy the Finance gate;
-- only 'returned' or an explicit waiver does.
--
-- The waiver is the escape valve the paper declaration already allows ("or an explicit waiver
-- recorded by Admin/IT"). It is per item, needs a reason, and names its author.
CREATE TABLE IF NOT EXISTS noc_asset_return (
  id                       CHAR(36)     NOT NULL,
  noc_case_id              CHAR(36)     NOT NULL,
  item_no                  TINYINT UNSIGNED NOT NULL,
  item_code                VARCHAR(40)  NOT NULL,
  item_label               VARCHAR(120) NOT NULL,
  is_mandatory_for_finance TINYINT(1)   NOT NULL DEFAULT 0,
  shown_on_form            TINYINT(1)   NOT NULL DEFAULT 1,
  quantity                 SMALLINT UNSIGNED NULL,
  status                   ENUM('returned','not_returned','na') NOT NULL DEFAULT 'na',
  remarks                  VARCHAR(400) NULL,
  updated_by               CHAR(36)     NULL,
  updated_by_role          VARCHAR(80)  NULL,
  status_updated_at        DATETIME     NULL,
  waived_by                CHAR(36)     NULL,
  waived_at                DATETIME     NULL,
  waiver_reason            VARCHAR(700) NULL,
  created_at               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_noc_asset_return (noc_case_id, item_code),
  KEY idx_noc_asset_return_case (noc_case_id, status),
  -- The Finance gate's own query: mandatory items not yet returned and not waived.
  KEY idx_noc_asset_return_gate (noc_case_id, is_mandatory_for_finance, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Invite tokens for the employee-facing form.
-- ─────────────────────────────────────────────────────────────────────────────
-- Hash-only storage, copying employee_joining_document_public_token as amended by migration 350:
-- the plaintext token is never persisted, so a leaked database dump cannot be turned into a
-- working form link. The consequence, and it is deliberate, is that a "resend" cannot reproduce
-- the original URL — it must mint a new token and supersede the old one.
--
-- Exactly one token per case may be 'active'. The reminder worker joins on that, and two active
-- rows would make it send twice — the same failure mintFreshKitSigningLink() guards against.
CREATE TABLE IF NOT EXISTS noc_invite (
  id             CHAR(36)     NOT NULL,
  noc_case_id    CHAR(36)     NOT NULL,
  employee_id    CHAR(36)     NOT NULL,
  token_hash     VARCHAR(64)  NOT NULL,
  token_status   ENUM('active','consumed','superseded','expired') NOT NULL DEFAULT 'active',
  -- Which channels this invite was actually pushed through. Email is the only channel with a
  -- delivery history in this system (SMS 0 sent / 901 failed, WhatsApp 0 sent / 903 failed as
  -- at 2026-08), so a NULL or email-only value is the expected case, not a fault.
  channels_sent  VARCHAR(120) NULL,
  sent_to_email  VARCHAR(200) NULL,
  sent_to_mobile VARCHAR(30)  NULL,
  expires_at     DATETIME     NOT NULL,
  sent_at        DATETIME     NULL,
  opened_at      DATETIME     NULL,
  consumed_at    DATETIME     NULL,
  created_by     CHAR(36)     NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_noc_invite_token_hash (token_hash),
  KEY idx_noc_invite_case (noc_case_id, token_status),
  KEY idx_noc_invite_employee (employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Visible timeline.
-- ─────────────────────────────────────────────────────────────────────────────
-- sensitive_action_log already records these mutations for audit, but it is not readable by the
-- people who need them: HR tracking an SLA breach, and a branch user asking "who declined this
-- and why", both work from the case screen. Append-only, so there is no unique key to get wrong.
CREATE TABLE IF NOT EXISTS noc_case_event (
  id             CHAR(36)     NOT NULL,
  noc_case_id    CHAR(36)     NOT NULL,
  stage_key      VARCHAR(40)  NULL,
  action         VARCHAR(48)  NOT NULL,
  actor_user_id  CHAR(36)     NULL,
  actor_role     VARCHAR(80)  NULL,
  actor_name     VARCHAR(200) NULL,
  -- 'public_token' for the employee's own submission, matching the convention in
  -- employee_joining_document_audit_log.
  actor_type     VARCHAR(30)  NOT NULL DEFAULT 'user',
  reason         VARCHAR(700) NULL,
  ip_address     VARCHAR(64)  NULL,
  user_agent     VARCHAR(512) NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_noc_case_event_case (noc_case_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Link the scanned paper NOC to its case.
-- ─────────────────────────────────────────────────────────────────────────────
-- The signed physical form is kept as an attachment alongside the digital signatories rather
-- than replaced by them. Nullable with no default, so every existing payroll_noc row and both
-- existing upload/validate routes keep working untouched.
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'payroll_noc'
     AND column_name = 'noc_case_id'
);

SET @ddl = IF(@col_exists = 0,
  'ALTER TABLE payroll_noc ADD COLUMN noc_case_id CHAR(36) NULL AFTER ff_calculation_id',
  'SELECT 1'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists = (
  SELECT COUNT(*) FROM information_schema.statistics
   WHERE table_schema = DATABASE()
     AND table_name = 'payroll_noc'
     AND index_name = 'idx_payroll_noc_case_id'
);

SET @ddl = IF(@idx_exists = 0,
  'ALTER TABLE payroll_noc ADD INDEX idx_payroll_noc_case_id (noc_case_id)',
  'SELECT 1'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
