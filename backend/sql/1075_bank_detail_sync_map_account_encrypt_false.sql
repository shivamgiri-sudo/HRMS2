-- ============================================================
-- Migration: 1075_bank_detail_sync_map_account_encrypt_false.sql
-- Purpose  : legacy_sync_map row a1000000-0000-0000-0000-000000000002
--            (bank_detail, db_bill.masjclrentry -> employee_bank_detail) has
--            transform_rules_json declaring 'account_encrypt': true. Nothing
--            in backend/src/workers/domains/bank-detail-sync-handler.ts (or
--            anywhere else) reads that key — confirmed by grep, zero matches.
--            It has always been inert, and it was actively misleading: the
--            column it describes is 100% unencrypted plaintext bytes for
--            every one of 12,768 live rows (confirmed live 2026-08).
--            Correcting the flag to false so the config stops asserting
--            something the sync has never done. Zero behavioral change —
--            nothing reads this key either way.
-- Safe to re-run: idempotent UPDATE, matches on the row's fixed id.
-- ============================================================

USE mas_hrms;

UPDATE legacy_sync_map
   SET transform_rules_json = JSON_SET(transform_rules_json, '$.account_encrypt', CAST('false' AS JSON))
 WHERE id = 'a1000000-0000-0000-0000-000000000002'
   AND JSON_EXTRACT(transform_rules_json, '$.account_encrypt') = true;
