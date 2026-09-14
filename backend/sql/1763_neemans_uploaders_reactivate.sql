-- Found NEEMANS_SALE_RAW_MASMIS, NEEMANS_ALLOCATION_MASMIS and
-- NEEMANS_APR_MASMIS (sql/1746) with active_status=0, the same blocker
-- GNC_ALLOCATION_MASMIS hit (sql/1761) -- /templates filters on
-- active_status=1, so the frontend would show "Could not load the upload
-- template" for all 3. Reactivating so the new Neemans process page (added
-- per explicit user request) can actually use them.
--
-- NOTE: their required_columns still carry the unverified camelCase
-- guesses from sql/1746 ("orderId", "phone", "empName"), not confirmed
-- against a real file the way GNC_APR/GNC_ALLOCATION were. If a real
-- upload rejects a column that's visibly present, that is the same
-- header-mismatch bug already fixed twice this session -- same fix:
-- read the real error, add the real header as an alias. Deliberately not
-- guess-fixing these here without a real sample to check against.
--
-- NEEMANS_CART_MASMIS is left inactive/untouched -- out of scope, same as
-- Bellavita's own "deliberately left out" extras (still reachable from the
-- main Bulk Upload Hub).
UPDATE upload_template_master SET active_status = 1
 WHERE upload_type_code IN ('NEEMANS_SALE_RAW_MASMIS', 'NEEMANS_ALLOCATION_MASMIS', 'NEEMANS_APR_MASMIS');
