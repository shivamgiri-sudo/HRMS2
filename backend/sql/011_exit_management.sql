-- 011_exit_management.sql
-- Exit Management: resignation, involuntary exit, approval chain, revoke, clearance, attrition trends
USE mas_hrms;

-- ─────────────────────────────────────────────
-- MAIN EXIT REQUEST
-- Covers voluntary (employee-initiated) and involuntary (manager/HR-initiated)
--
-- VOLUNTARY flow:
--   Employee: draft → submitted
--   Reporting Manager: manager_review → approved/rejected + discussion remarks
--   HR: hr_review → approved/rejected + confirms LWD + internal notes
--   Status: accepted → notice_serving
--   HR (execution): stamps exit_confirmed_at, sets employees.employment_status = Exited
--
-- INVOLUNTARY flow (manager raises for termination / absconding):
--   Manager: manager_initiated (raises the request)
--   HR: hr_review (reviews, adds internal notes)
--   Admin: admin_review → DECISION: approved or rejected  ← final decision authority
--   Status: accepted → notice_serving (or immediate exit)
--   HR (execution): after Admin approval, HR performs system action —
--     sets employees.employment_status = Exited, confirms LWD, triggers clearance
--     Admin approves. HR executes. These are sequential, not the same action.
--
-- Revoke: allowed at any stage before status = 'accepted'. Employee, Manager, or HR can revoke.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS exit_request (
  id                      CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id             CHAR(36)     NOT NULL,

  -- Who started this request
  initiated_by            VARCHAR(50)  NOT NULL DEFAULT 'employee',    -- employee, manager, hr
  initiated_by_user_id    CHAR(36),

  -- Exit classification
  exit_type               VARCHAR(50)  NOT NULL DEFAULT 'voluntary',   -- voluntary, involuntary
  exit_sub_type           VARCHAR(100) NOT NULL DEFAULT 'resignation',
    -- voluntary:   resignation, retirement, mutual_separation
    -- involuntary: termination, absconding, contract_end, abandonment

  exit_reason_category    VARCHAR(100),
    -- better_opportunity, personal_reasons, health, relocation,
    -- higher_studies, dissatisfaction_management, dissatisfaction_compensation,
    -- family_reasons, entrepreneurship, termination_performance,
    -- termination_misconduct, absconding, contract_end, retirement, other

  resignation_reason      TEXT,        -- free-text detail from employee (required for voluntary)

  -- Notice period
  last_working_day_proposed  DATE,     -- employee-proposed in resignation letter
  last_working_day_confirmed DATE,     -- confirmed by HR after approval
  notice_period_days         INT       NOT NULL DEFAULT 0,
  notice_start_date          DATE,
  notice_end_date            DATE,

  -- Current stage
  status                  VARCHAR(50)  NOT NULL DEFAULT 'draft',
    -- draft, submitted, manager_review, hr_review, admin_review,
    -- accepted, rejected, revoked, notice_serving, exited

  -- Revoke (employee retained — any actor can revoke before 'accepted')
  revoked_at              DATETIME,
  revoke_reason           TEXT,
  revoked_by              CHAR(36),

  -- Audit timestamps per stage
  submitted_at            DATETIME,
  manager_actioned_at     DATETIME,
  hr_actioned_at          DATETIME,
  admin_actioned_at       DATETIME,
  exit_confirmed_at       DATETIME,    -- HR stamps this when employee.employment_status → Exited

  created_at              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  INDEX idx_exit_employee (employee_id),
  INDEX idx_exit_status   (status),
  INDEX idx_exit_type     (exit_type),
  INDEX idx_exit_lwd      (last_working_day_confirmed)
);

-- ─────────────────────────────────────────────
-- APPROVAL / DISCUSSION LOG
-- Every action at every stage — approved, rejected, discussed, revoked
-- Manager discussion remarks and HR discussion remarks stored here per action
-- Internal HR notes (internal_notes) visible to HR only at API layer
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS exit_approval_log (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  exit_request_id  CHAR(36)     NOT NULL,

  stage            VARCHAR(50)  NOT NULL,
    -- manager_review, hr_review, admin_review, employee_revoke, hr_revoke

  action           VARCHAR(50)  NOT NULL,
    -- approved, rejected, discussed, revoked, escalated, info_requested, notice_confirmed

  action_by        CHAR(36)     NOT NULL,  -- user_id
  action_by_role   VARCHAR(100),           -- role_key at time of action (manager, hr, admin, employee)

  discussion_remarks TEXT,                 -- visible in timeline to employee + manager + HR
  internal_notes     TEXT,                 -- HR-only internal notes, not shown to employee

  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (exit_request_id) REFERENCES exit_request(id) ON DELETE CASCADE,
  INDEX idx_exit_log_req (exit_request_id),
  INDEX idx_exit_log_stage (stage)
);

-- ─────────────────────────────────────────────
-- EXIT CLEARANCE CHECKLIST
-- Department-wise clearance required before final exit
-- HR creates checklist on acceptance, assigns each item, tracks completion
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS exit_clearance_checklist (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  exit_request_id  CHAR(36)     NOT NULL,
  department       VARCHAR(100) NOT NULL,
    -- IT, Finance, Admin, HR, Reporting Manager, Security, Training, Accounts
  assigned_to      CHAR(36),              -- user_id responsible for this clearance
  status           VARCHAR(50)  NOT NULL DEFAULT 'pending',
    -- pending, cleared, waived, failed
  remarks          TEXT,
  cleared_at       DATETIME,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_exit_dept (exit_request_id, department),
  FOREIGN KEY (exit_request_id) REFERENCES exit_request(id) ON DELETE CASCADE,
  INDEX idx_clearance_req (exit_request_id),
  INDEX idx_clearance_status (status)
);

-- ─────────────────────────────────────────────
-- ATTRITION SNAPSHOT
-- Computed and stored monthly per branch + process for fast dashboard reads
-- Populated by a scheduled job or triggered on each HR exit confirmation
-- Query for notice-serving count: SELECT COUNT(*) FROM exit_request
--   WHERE status = 'notice_serving' AND last_working_day_confirmed >= CURDATE()
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attrition_snapshot (
  id                CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  snapshot_month    VARCHAR(7)    NOT NULL,   -- YYYY-MM
  branch_id         CHAR(36),
  process_id        CHAR(36),
  opening_headcount INT           NOT NULL DEFAULT 0,
  closing_headcount INT           NOT NULL DEFAULT 0,
  voluntary_exits   INT           NOT NULL DEFAULT 0,
  involuntary_exits INT           NOT NULL DEFAULT 0,
  total_exits       INT           NOT NULL DEFAULT 0,  -- voluntary + involuntary
  new_joiners       INT           NOT NULL DEFAULT 0,
  attrition_rate    DECIMAL(6,2)  NOT NULL DEFAULT 0,  -- (total_exits / avg_headcount) * 100
  computed_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_snap_month_branch_process (snapshot_month, branch_id, process_id),
  INDEX idx_snap_month (snapshot_month),
  FOREIGN KEY (branch_id)  REFERENCES branch_master(id)  ON DELETE SET NULL,
  FOREIGN KEY (process_id) REFERENCES process_master(id) ON DELETE SET NULL
);
