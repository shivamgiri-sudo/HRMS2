-- Seeds expense_categories, which has existed and been empty since migration 099 half-applied.
--
-- backend/sql/migrations/099_create_expense_tables.sql created this table as its first statement,
-- then died on its second: expense_claims declares employee_id INT with a foreign key to
-- employees(id), which is char(36), and MySQL rejects a foreign key whose type does not match the
-- referenced key (errno 3780). So the master was created and never populated, and everything after
-- it in that file was never created at all. That migration is annotated SUPERSEDED - DO NOT RUN.
--
-- Without these rows the expenses module cannot accept a line: addExpenseItem validates
-- category_id against this table, so an empty master rejects every attempt, and the category
-- dropdown has nothing to show.
--
-- The seven names are not arbitrary. expenseService.toCategoryEnum() lowercases the category name
-- and matches it against expense_claim.category
-- ENUM('travel','accommodation','meals','transport','communication','office','other'); a name
-- outside that set silently falls back to 'other'. These seven map one-to-one, so every category a
-- user can pick is stored as itself.
--
-- Idempotent by name rather than INSERT IGNORE, because expense_categories has no unique key on
-- name (only PRIMARY on id and an index on is_active), so IGNORE would not deduplicate. Re-running
-- this is a no-op; it will not create a second copy and will not resurrect a row an admin has
-- deactivated, because it only inserts names that are absent entirely.
--
-- Applied to mas_hrms on 2026-08-08 ahead of this file: 7 rows, ids 1-7. Verified afterwards that
-- expense_claim was untouched (5,634 rows, 100 employee_claim) and the CEO P&L for 2026-07 was
-- unchanged (revenue 11,550,589, people cost 16,209,964.05, 1,464 staff paid) - a LEFT JOIN to
-- this table supplies a name and can never add a row or change a sum.

INSERT INTO expense_categories (name, description, is_active)
SELECT 'Travel', 'Fares and travel between locations', 1 FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM expense_categories WHERE name = 'Travel');

INSERT INTO expense_categories (name, description, is_active)
SELECT 'Accommodation', 'Hotel and lodging', 1 FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM expense_categories WHERE name = 'Accommodation');

INSERT INTO expense_categories (name, description, is_active)
SELECT 'Meals', 'Meals and refreshments', 1 FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM expense_categories WHERE name = 'Meals');

INSERT INTO expense_categories (name, description, is_active)
SELECT 'Transport', 'Local transport, cabs and fuel', 1 FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM expense_categories WHERE name = 'Transport');

INSERT INTO expense_categories (name, description, is_active)
SELECT 'Communication', 'Phone, internet and data', 1 FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM expense_categories WHERE name = 'Communication');

INSERT INTO expense_categories (name, description, is_active)
SELECT 'Office', 'Stationery and office supplies', 1 FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM expense_categories WHERE name = 'Office');

INSERT INTO expense_categories (name, description, is_active)
SELECT 'Other', 'Anything not covered above', 1 FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM expense_categories WHERE name = 'Other');
