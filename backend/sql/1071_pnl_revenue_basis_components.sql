-- 1071: publish the revenue-basis and seat-revenue lines on the P&L statement.
--
-- getStatement renders only the components listed in finance_pnl_component_master. Four fields
-- were added to the statement payload — plannedRevenue, invoicedRevenue, seatRevenueEarned and
-- seatShortfall — and without a row here every one of them is computed on every request and
-- then dropped before it reaches a reader. This migration is what makes them visible; it is not
-- cosmetic.
--
-- Placed between recognized_revenue (170) and the next section (200) so they read directly under
-- the revenue they explain. Additive and re-runnable: existing rows are left untouched.

INSERT INTO finance_pnl_component_master
  (component_key, display_name, section_key, parent_component_key, display_order,
   component_type, source_field, format_type, sign_convention, is_subtotal, active_status)
VALUES
  -- What the client was actually billed. For a closed month this IS recognised revenue; it is
  -- published separately so the basis is auditable rather than implied.
  ('invoiced_revenue', 'Invoiced Revenue', 'revenue', 'recognized_revenue', 172,
   'SOURCE_ACTUAL', 'invoicedRevenue', 'CURRENCY', '+', 0, 1),

  -- planned_headcount x revenue_rate_per_head — the budgeting figure. Recognised revenue falls
  -- back to it on an open month, when invoicing is still incomplete.
  ('planned_revenue', 'Contracted Revenue (planned seats)', 'revenue', 'recognized_revenue', 174,
   'SOURCE_ACTUAL', 'plannedRevenue', 'CURRENCY', '+', 0, 1),

  -- Seat rate x billable people actually on the floor, pro-rated by payable days.
  ('seat_revenue_earned', 'Earned Seat Revenue', 'revenue', 'recognized_revenue', 176,
   'SOURCE_ACTUAL', 'seatRevenueEarned', 'CURRENCY', '+', 0, 1),

  -- Contracted minus earned: unfilled or part-filled seats. NULL wherever any billable person in
  -- the column has no resolvable rate, because subtracting an incomplete figure would report
  -- unconfigured rates as lost revenue.
  ('seat_shortfall', 'Seat Shortfall', 'revenue', 'recognized_revenue', 178,
   'SOURCE_ACTUAL', 'seatShortfall', 'CURRENCY', '+', 0, 1)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  source_field = VALUES(source_field),
  display_order = VALUES(display_order),
  active_status = VALUES(active_status);
