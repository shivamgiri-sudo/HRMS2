-- 1129_org_chart_access_log.sql
--
-- Creates the table behind org-chart access auditing, which has never existed,
-- so not one org chart view, search, node lookup or EXPORT has ever been
-- recorded.
--
-- WHY IT WENT UNNOTICED
--
-- logOrgChartAccess() wraps its INSERT in try/catch and logs to console with the
-- comment "audit failure should not break the feature". That is the right call
-- for an audit write - a failed log should not deny a user their page - but it
-- means a table that does not exist produces a working feature with no audit
-- trail at all, and nothing surfaces the difference. The org chart itself is
-- fine; only the record of who looked at it is missing.
--
-- WHY IT IS WORTH CREATING
--
-- The org chart exposes the reporting hierarchy for the whole company, and the
-- module already logs four action types against it: view, search, node_detail
-- and export. The charter requires that every sensitive export be auditable,
-- and an export of the org tree is exactly that. The code to record it is
-- complete and is already called on every one of those paths - only the table
-- was missing.
--
-- SHAPE
--
-- Columns are taken directly from the INSERT in org-chart.audit.ts, which names
-- all eleven and supplies id implicitly. Append-only, so there is no unique key
-- to get wrong: an audit row is never updated or deduplicated. filters_applied
-- is JSON.stringify'd by the caller, hence TEXT rather than a typed column.
--
-- COLLATE is explicit. MySQL 8 otherwise applies the server default
-- utf8mb4_0900_ai_ci while mas_hrms is overwhelmingly utf8mb4_unicode_ci, and a
-- table that cannot be text-joined to employees is how every reimbursements
-- endpoint 500'd until migration 1038.
--
-- Idempotent and additive: a new empty table, nothing else touched.

CREATE TABLE IF NOT EXISTS org_chart_access_log (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id          VARCHAR(36)  NOT NULL,
  employee_id      VARCHAR(36)  NULL,
  scope_type       VARCHAR(50)  NULL,
  scope_id         VARCHAR(36)  NULL,
  action_type      VARCHAR(30)  NOT NULL,
  filters_applied  TEXT         NULL,
  search_query     VARCHAR(255) NULL,
  export_format    VARCHAR(20)  NULL,
  ip_address       VARCHAR(45)  NULL,
  user_agent       TEXT         NULL,
  accessed_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ocal_user     (user_id),
  KEY idx_ocal_employee (employee_id),
  KEY idx_ocal_action   (action_type),
  KEY idx_ocal_when     (accessed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
