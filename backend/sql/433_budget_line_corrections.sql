-- 433_budget_line_corrections.sql
-- Branch Budget review: per head/sub-head correction notes raised when a reviewer sends a budget
-- back to the branch admin, so "what needs fixing, and where" is explicit rather than a single
-- free-text remark against the whole budget.
--
-- Anchoring: deliberately NOT a foreign key to finance_budget_line. saveDraft() replaces the line
-- set wholesale (DELETE ... then INSERT with fresh UUIDs), so an FK with ON DELETE CASCADE would
-- destroy every correction the moment the branch admin saved the very edit the note asked for.
-- Corrections are therefore anchored on the semantic identity the reviewer actually pointed at —
-- head + sub_head + item_name — and keep line_id only as a soft, best-effort pointer for the UI.
--
-- Additive and backward-compatible: new table only, no changes to existing tables or columns.

CREATE TABLE IF NOT EXISTS finance_budget_line_correction (
  id CHAR(36) NOT NULL PRIMARY KEY,
  budget_id CHAR(36) NOT NULL,
  -- Soft pointer to the line as it existed when the note was raised. Not an FK; goes stale (and is
  -- allowed to go stale) once the branch admin re-saves. Match on head/sub_head/item_name instead.
  line_id CHAR(36) NULL,
  head VARCHAR(255) NOT NULL,
  sub_head VARCHAR(255) NULL,
  item_name VARCHAR(255) NULL,
  correction_note TEXT NOT NULL,
  -- Which review stage raised it, so the branch admin can see whether this came from the branch
  -- head, finance head or accounts head.
  raised_by_role VARCHAR(64) NOT NULL,
  raised_by CHAR(36) NOT NULL,
  raised_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Revision the budget was on when the note was raised, so history survives repeated round trips.
  revision_no INT NOT NULL DEFAULT 0,
  resolved_at DATETIME NULL,
  resolved_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_fblc_budget (budget_id),
  KEY idx_fblc_budget_open (budget_id, resolved_at),
  KEY idx_fblc_anchor (budget_id, head, sub_head),
  CONSTRAINT fk_fblc_budget FOREIGN KEY (budget_id)
    REFERENCES finance_budget_header (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
