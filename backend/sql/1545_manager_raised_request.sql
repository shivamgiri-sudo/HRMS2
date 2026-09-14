-- 1545_manager_raised_request.sql
-- A generic "someone raised this on my behalf, and I have to consent before it becomes
-- real" wrapper. Built for the Team Attendance page's new "raise leave for my report"
-- action, but request_type is deliberately not a leave-only column: the same table and
-- consent flow are meant to be reused for other on-behalf request kinds later (e.g. a
-- correction that changes what the employee's own record says, as opposed to
-- attendance_regularization, which is already manager/WFM-initiated and needs no
-- employee consent because it does not spend the employee's leave balance or speak in
-- their voice).
--
-- Deliberately NOT columns bolted onto leave_request itself: leave_request's own status
-- machine (pending/pending_branch_head/approved/... — see leave.service.ts) is untouched.
-- A row here exists ONLY until the employee decides; on consent it materializes a real
-- leave_request via the exact same leaveService.submitRequest() every self-service leave
-- application uses (same balance/eligibility/gender/half-day validation, no duplicated
-- logic), and resulting_request_id points at it. Declined or still-pending rows never
-- touch leave_request at all.
--
-- Scope is enforced at the API layer (direct reporting-manager chain only, same predicate
-- team-attendance-month.routes.ts already uses), not by a column here.

CREATE TABLE IF NOT EXISTS manager_raised_request (
  id                     CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  request_type           VARCHAR(30)  NOT NULL,                 -- 'leave' today; extensible
  employee_id            CHAR(36)     NOT NULL,                 -- who the request is FOR
  raised_by_user_id      CHAR(36)     NOT NULL,                 -- auth_user.id of the manager/TL
  raised_by_employee_id  CHAR(36)     NULL,
  raised_by_role         VARCHAR(50)  NOT NULL,
  payload                JSON         NOT NULL,                 -- request_type-specific fields
  consent_status         VARCHAR(30)  NOT NULL DEFAULT 'pending_employee_consent',
                                                                  -- pending_employee_consent | consented | declined
  consent_decided_at     DATETIME     NULL,
  decline_reason         TEXT         NULL,
  resulting_request_id   CHAR(36)     NULL,                     -- leave_request.id once materialized
  created_at             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_mrr_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  INDEX idx_mrr_employee_status (employee_id, consent_status),
  INDEX idx_mrr_raised_by (raised_by_user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT '1545_manager_raised_request.sql applied' AS migration_status;

-- Rollback:
--   DROP TABLE IF EXISTS manager_raised_request;
