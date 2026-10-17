-- Migration 2226: bring two new tables onto the schema's standard collation.
-- 2220 and 2221 declared DEFAULT CHARSET=utf8mb4 with no COLLATE, so on MySQL 8 they came out utf8mb4_0900_ai_ci while
-- auth_user, employees and the rest of the schema are utf8mb4_unicode_ci. Any join or comparison between the two throws
-- "Illegal mix of collations" (this 500'd GET /api/finance/pnl/corrections in production on 2026-10-16).
-- Both tables were created on 2026-10-16, are small, and are not on a hot path (no ALTER on branch_master/employees/etc.).
-- Idempotent: converting a table that is already utf8mb4_unicode_ci changes nothing.
ALTER TABLE pnl_monthly_correction CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE grn_expense_master_snapshot CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
