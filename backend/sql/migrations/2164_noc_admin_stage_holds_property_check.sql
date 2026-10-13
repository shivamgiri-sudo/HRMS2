-- Migration 2164: the company-property check moves from Finance to Admin
--
-- The property-return gate (mandatory items Returned or explicitly waived) was carried by the Finance
-- stage's requires_asset_clearance flag. Finance is no longer a stage (2163), and dropping it would
-- silently drop the check. Admin now carries it: the Admin sign-off is refused while mandatory
-- property is outstanding, until each item is Returned or waived by Admin/IT. Applies to new cases
-- (template) and to still-pending Admin rows on open cases. Idempotent.

UPDATE noc_signatory_template SET requires_asset_clearance = 1
 WHERE stage_key = 'admin' AND requires_asset_clearance = 0;

UPDATE noc_signatory ns
  JOIN noc_case c ON c.id = ns.noc_case_id
   SET ns.requires_asset_clearance = 1
 WHERE ns.stage_key = 'admin' AND ns.status = 'pending' AND ns.requires_asset_clearance = 0
   AND c.status NOT IN ('completed', 'cancelled');
