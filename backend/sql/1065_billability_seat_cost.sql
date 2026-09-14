-- Billability, seat cost, and multi-cost-centre attribution.
--
-- WHY
-- ---
-- The P&L can say what each employee COSTS but not what the client PAYS for them,
-- and it cannot attribute a support person who serves several cost centres to more
-- than one of them.
--
-- Two columns already claim to answer the first question and neither can:
--
--   employees.is_billable       1 on all 58,626 rows -- a column default, never populated
--   employees.billable_status   'No' on 936 of 1,125 active, 'Yes' on exactly 1
--
-- They contradict each other on essentially every row. Checked at source, the second
-- is no better: db_bill.masjclrentry.Billable_Status is 'No' on 1,218 of 1,219 active
-- rows. It is not a competing answer, it is a null one. Neither is read by the P&L.
--
-- WHY BILLABILITY IS NOT A PROPERTY OF A PERSON
-- --------------------------------------------
-- The client pays for Executives on every process. On SOME processes it also pays for
-- the Team Leader or the Quality Auditor; on others we absorb those roles ourselves.
-- So billability is a property of (process x designation), which nothing in the schema
-- modelled. Live shape: 126 distinct combinations over 52 staffed processes.
--
-- These tables are deliberately NOT an extension of pnl_cost_classification_rule:
--   - its pnl_bucket is NOT NULL, so a billability-only rule cannot be written there
--     without also asserting a cost bucket you do not mean;
--   - it matches scope_key as free text against a designation NAME, so a rename would
--     silently move money;
--   - it has no unique key, and already holds 5 duplicate rules at identical priority.
--
-- SEAT RATE PRECEDENCE (most specific wins)
-- -----------------------------------------
--   1 employee_seat_rate_override        this person, whatever their role
--   2 cost_centre_seat_rate (cc, desig)  a role priced differently on this cost centre
--   3 cost_centre_seat_rate (cc, NULL)   the flat cost-centre rate
--   4 finance_cost_centre_monthly_driver.revenue_rate_per_head   existing fallback
--   5 nothing -> 'missing', counted and surfaced, NEVER silently zero
--
-- SEAT COST DOES NOT APPLY EVERYWHERE
-- -----------------------------------
-- Reconciled against actually-invoiced revenue: where a cost centre is seat-billed the
-- model holds (Onfido, +2% against June invoicing), and where it is not the model is
-- simply wrong (BTM Ventures -17%, Finnable +174% -- their invoices are several
-- outcome-based components, not seats times a rate). db_bill.cost_master.Billing marks
-- the difference: 171 of 579 active cost centres are seat-billed, 408 are not. Hence
-- cost_centre_seat_rate.billing_model -- seat revenue is computed only where it applies,
-- and elsewhere the P&L must say "not seat-billed" rather than publish a confident
-- wrong number.
--
-- SAFE TO APPLY
-- -------------
-- Additive only. Creates three empty tables and touches no existing row. Nothing reads
-- them until the resolver ships, so applying this changes no reported figure.

-- ---------------------------------------------------------------------------
-- 1. Billability: the (process x designation) matrix, with employee override
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS process_role_billability (
  id                CHAR(36)      NOT NULL,
  rule_name         VARCHAR(255)  NOT NULL,
  -- NULL means "any". Specificity is DERIVED at read time from which of these are set,
  -- never stored as a hand-set priority integer: an editable priority column is exactly
  -- what left pnl_cost_classification_rule with ties it cannot break.
  process_id        CHAR(36)      NULL,
  designation_id    CHAR(36)      NULL,
  employee_id       CHAR(36)      NULL,
  is_billable       TINYINT(1)    NOT NULL,
  -- NULL = inherit the cost-centre rate. Set only where the client prices this role
  -- differently from the rest of the seats on that process.
  seat_rate_monthly DECIMAL(14,2) NULL,
  source            ENUM('seeded','manual') NOT NULL DEFAULT 'manual',
  effective_from    DATE          NOT NULL,
  effective_to      DATE          NULL,
  status            ENUM('draft','approved','inactive') NOT NULL DEFAULT 'draft',
  change_reason     VARCHAR(500)  NOT NULL,
  created_by        CHAR(36)      NULL,
  approved_by       CHAR(36)      NULL,
  approved_at       DATETIME      NULL,
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_prb_lookup   (status, effective_from, effective_to),
  KEY idx_prb_scope    (process_id, designation_id),
  KEY idx_prb_employee (employee_id),
  CONSTRAINT fk_prb_process     FOREIGN KEY (process_id)     REFERENCES process_master(id),
  CONSTRAINT fk_prb_designation FOREIGN KEY (designation_id) REFERENCES designation_master(id),
  CONSTRAINT fk_prb_employee    FOREIGN KEY (employee_id)    REFERENCES employees(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 2. Seat rate per cost centre, optionally per designation
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cost_centre_seat_rate (
  id                CHAR(36)      NOT NULL,
  cost_centre_id    CHAR(36)      NOT NULL,
  -- NULL = the flat rate for every billable seat on this cost centre.
  designation_id    CHAR(36)      NULL,
  seat_rate_monthly DECIMAL(18,2) NOT NULL,
  -- Whether seats x rate is the right model here at all. 'not_seat_billed' means the
  -- client pays on outcome/transaction terms and seat revenue must NOT be published
  -- for this cost centre.
  billing_model     ENUM('per_seat','not_seat_billed','unknown') NOT NULL DEFAULT 'per_seat',
  -- payable_days makes revenue and cost both earned-to-date, so a mid-month joiner does
  -- not bill a full seat and mid-month margin means something.
  proration_method  ENUM('payable_days','full_month') NOT NULL DEFAULT 'payable_days',
  contract_reference VARCHAR(255) NULL,
  effective_from    DATE          NOT NULL,
  effective_to      DATE          NULL,
  status            ENUM('draft','approved','inactive') NOT NULL DEFAULT 'draft',
  change_reason     VARCHAR(500)  NOT NULL,
  created_by        CHAR(36)      NULL,
  approved_by       CHAR(36)      NULL,
  approved_at       DATETIME      NULL,
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ccsr_lookup (cost_centre_id, designation_id, status, effective_from, effective_to),
  CONSTRAINT fk_ccsr_cost_centre FOREIGN KEY (cost_centre_id) REFERENCES cost_centre_master(id),
  CONSTRAINT fk_ccsr_designation FOREIGN KEY (designation_id) REFERENCES designation_master(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 3. Per-employee seat rate override
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employee_seat_rate_override (
  id                CHAR(36)      NOT NULL,
  employee_id       CHAR(36)      NOT NULL,
  seat_rate_monthly DECIMAL(18,2) NOT NULL,
  proration_method  ENUM('payable_days','full_month') NOT NULL DEFAULT 'payable_days',
  effective_from    DATE          NOT NULL,
  effective_to      DATE          NULL,
  status            ENUM('draft','approved','inactive') NOT NULL DEFAULT 'draft',
  change_reason     VARCHAR(500)  NOT NULL,
  created_by        CHAR(36)      NULL,
  approved_by       CHAR(36)      NULL,
  approved_at       DATETIME      NULL,
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_esro_lookup (employee_id, status, effective_from, effective_to),
  CONSTRAINT fk_esro_employee FOREIGN KEY (employee_id) REFERENCES employees(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 4. Support-staff cost split across cost centres
-- ---------------------------------------------------------------------------
-- NOT a reuse of employee_lob_assignment. That table keys on process_lob_id (a LOB
-- within a process, not a cost centre), its cost_bucket enum cannot express bmc_people
-- -- precisely the class of person that needs splitting -- and it is read live by
-- kpi/attribution.service.ts as the date-accurate process attribution source, so
-- writing support staff into it would silently change KPI attribution.
--
-- The "must total 100%" rule cannot be a CHECK constraint: MySQL CHECK cannot aggregate
-- over sibling rows. It is enforced transactionally on approval, re-verified nightly,
-- and any imbalance that still reaches the P&L is surfaced as an explicit unallocated
-- residual rather than silently renormalised.
CREATE TABLE IF NOT EXISTS employee_cost_centre_allocation (
  id                CHAR(36)      NOT NULL,
  employee_id       CHAR(36)      NOT NULL,
  cost_centre_id    CHAR(36)      NOT NULL,
  allocation_pct    DECIMAL(7,4)  NOT NULL,
  allocation_basis  ENUM('manual','headcount_served','time_study','system') NOT NULL DEFAULT 'manual',
  effective_from    DATE          NOT NULL,
  effective_to      DATE          NULL,
  status            ENUM('draft','approved','inactive') NOT NULL DEFAULT 'draft',
  change_reason     VARCHAR(500)  NOT NULL,
  created_by        CHAR(36)      NULL,
  approved_by       CHAR(36)      NULL,
  approved_at       DATETIME      NULL,
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ecca (employee_id, cost_centre_id, effective_from),
  KEY idx_ecca_emp (employee_id, status, effective_from, effective_to),
  KEY idx_ecca_cc  (cost_centre_id, status, effective_from, effective_to),
  CONSTRAINT fk_ecca_employee    FOREIGN KEY (employee_id)    REFERENCES employees(id),
  CONSTRAINT fk_ecca_cost_centre FOREIGN KEY (cost_centre_id) REFERENCES cost_centre_master(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
