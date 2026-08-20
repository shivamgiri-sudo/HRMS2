-- 1080_itc_blocked_sub_heads.sql
-- Mark sub-heads where Input Tax Credit is blocked under GST Act Section 17(5).
-- Setting default_recoverable_tax_pct = 0 means: if a vendor raises a GST invoice
-- against one of these budget lines, the full gross amount (base + tax) is treated
-- as P&L cost instead of just the base. No process is blocked; the number is honest.
--
-- Blocked categories (Section 17(5) CGST Act):
--   - Food, beverages, outdoor catering (Cafeteria / Office Maintenance - food items)
--   - Gifts to non-employees, free samples (R&R, Business Promotion - gift component)
--   - Club memberships, health & fitness
--
-- Applies only to sub-heads where ITC is categorically blocked.
-- Sub-heads where ITC is mixed (partly claimable) are left at 100% — Finance can
-- override at the individual budget line level if needed.

UPDATE finance_expense_sub_head_master sm
  JOIN finance_expense_head_master hm ON hm.id = sm.head_id
   SET sm.default_recoverable_tax_pct = 0,
       sm.updated_at = NOW()
 WHERE (
   -- Cafeteria, food & beverages — categorically blocked
   (hm.head_code = 'OFFICE_MAINTENANCE'
    AND sm.sub_head_code IN ('CAFETERIA', 'CAFETERIA_OTHER_MAINTENANCE'))

   -- R&R — rewards & recognition, gift-based, blocked
   OR (hm.head_code IN ('REWARDS_RECOGNITION', 'STAFF_WELFARE')
       AND sm.sub_head_code IN ('RR_EXPENSES', 'R_R_EXPENSES', 'REWARDS_RECOGNITION',
                                 'STAFF_WELFARE', 'STAFF_ENTERTAINMENT'))

   -- Business Promotion — gift / free sample component
   OR (hm.head_code = 'BUSINESS_PROMOTION'
       AND sm.sub_head_code IN ('GIFTS', 'FREE_SAMPLES', 'PROMOTIONAL_GIFTS'))
 );

-- Confirm what was updated (run manually to verify):
-- SELECT hm.head_code, sm.sub_head_code, sm.sub_head_name, sm.default_recoverable_tax_pct
--   FROM finance_expense_sub_head_master sm
--   JOIN finance_expense_head_master hm ON hm.id = sm.head_id
--  WHERE sm.default_recoverable_tax_pct = 0
--  ORDER BY hm.head_code, sm.sub_head_code;