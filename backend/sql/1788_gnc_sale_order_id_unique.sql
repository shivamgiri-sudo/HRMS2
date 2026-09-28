-- Enforces order_id uniqueness on db_masmis.gnc_sale, per explicit user
-- request. Live table had 543 exact re-upload duplicate rows (same
-- order_id, same amount, same line item, different upload_batch_id/
-- uploaded_at -- confirmed by inspection, not a legitimate multi-line-item
-- pattern: 0 of 543 duplicate groups had differing line_item_name).
--
-- The dedup half of this fix (DELETE keeping the earliest row per
-- order_id) was already run and committed live in this session, 2026-09-16,
-- via this app's own DB connection (shivam_user has SELECT/INSERT/UPDATE/
-- DELETE on db_masmis) -- verified before/after: 2,572 -> 2,029 rows,
-- 2,029 distinct order_id both before and after the affected-row count.
--
-- The ALTER below could NOT be applied by this session: shivam_user has no
-- ALTER/INDEX/CREATE privilege on db_masmis (confirmed live via SHOW GRANTS
-- -- same boundary already documented for gnc_chat's CREATE TABLE in
-- 1774_gnc_chat_new_table.sql). Someone with schema privilege on db_masmis
-- must run this manually.
--
-- Replaces the existing non-unique idx_order_id with a UNIQUE index of the
-- same name, so nothing else that references the index name changes.
-- Safe to run only AFTER the dedup above -- a duplicate-free table is a
-- precondition, otherwise this ALTER fails with ER_DUP_ENTRY.
--
-- CAVEAT flagged to the user: db_masmis.gnc_sale is also written to by a
-- separate tool ("My Dashboards", github.com/tausifansari-mcn/Mydashboards)
-- outside this repo's control. That tool's own inserts are insert-only (no
-- upsert). If it ever re-inserts an order_id already present after this
-- constraint is live, that insert will start failing with a duplicate-key
-- error instead of silently duplicating the row as it did before. This
-- repo's own GNC sale importer was updated to upsert by order_id
-- (gnc-sale-masmis-bulk.service.ts) specifically to avoid that failure mode
-- on our side; the other tool was not and cannot be changed from here.

ALTER TABLE db_masmis.gnc_sale
  DROP INDEX idx_order_id,
  ADD UNIQUE INDEX idx_order_id (order_id);
