-- Migration: reactivate two branch_master rows that carry live, working staff
-- Date: 2026-08-09
--
-- WHAT IS WRONG
--   Two branches are flagged active_status = 0 while their employees are actively
--   working. Verified read-only against production on 2026-08-09:
--
--     Delhi Office (DELHI, New Delhi)   active_status=0  close_date NULL
--        51 active employees, and 51 of 51 have attendance_daily_record rows in the
--        last 30 days (newest 2026-08-06)
--     Head Office  (HQ, Mumbai)         active_status=0  close_date NULL
--        12 active employees, 11 of 12 with attendance in the last 30 days
--
--   Neither carries a close_date, so neither was deliberately closed. 63 people are
--   employed at branches the platform treats as shut.
--
-- WHY NOT MOVE THE EMPLOYEES INSTEAD
--   Because there is nowhere correct to move them. The only active branches are
--   AHMEDABAD-JALDARSHAN, HEAD OFFICE (CORP), NOIDA, NOIDA-2 and NOIDA-DIALDESK --
--   every one of them Ahmedabad or Noida. Delhi and Mumbai staff do not belong to any
--   of those.
--
--   This matters because "de-duplicate branch_master" looks like the obvious fix and is
--   the wrong one. branch_master holds three rows whose name is some case-variant of
--   "Head Office", and they are NOT duplicates:
--     HEAD OFFICE (CORP, active)  -> Trapezoid IT Park, Sector 62, Noida, Uttar Pradesh
--     Head Office (HQ, inactive)  -> Mumbai, Maharashtra
--   Merging them would relocate 12 Mumbai employees to Noida and corrupt their branch
--   attribution, ID-card address (the card prints branch_master.address), payroll
--   voucher grouping and attendance scoping. Do not merge branches on name.
--
-- WHAT THIS CHANGES
--   active_status 0 -> 1 on exactly those two rows, matched by branch_code AND guarded
--   on the state that was verified: still inactive, still no close_date, and still
--   holding at least one active employee. If any of that has since changed, the row is
--   left alone rather than forced.
--
--   Effect: the two branches reappear in branch pickers, active-branch filters and
--   branch-scoped reporting, which is what their 63 working employees already imply.
--   Nothing about the employees themselves is touched.
--
-- ROLLBACK
--   UPDATE branch_master SET active_status = 0
--    WHERE branch_code IN ('DELHI','HQ');
--
-- Idempotent: the active_status = 0 predicate means a re-run matches nothing.

UPDATE branch_master bm
   SET bm.active_status = 1,
       bm.updated_at = NOW()
 WHERE bm.branch_code IN ('DELHI', 'HQ')
   AND bm.active_status = 0
   AND bm.close_date IS NULL
   AND EXISTS (
     SELECT 1 FROM employees e
      WHERE e.branch_id = bm.id AND e.active_status = 1
   );

-- Verification (expects both rows active_status = 1):
--   SELECT branch_code, branch_name, city, active_status, close_date
--     FROM branch_master WHERE branch_code IN ('DELHI','HQ');
--
-- And the orphan count should fall from 73 to 10 (the remaining 10 are active
-- employees whose branch_id matches no branch_master row at all -- a separate defect,
-- deliberately not addressed here because the correct branch for each is unknown):
--   SELECT COUNT(*) FROM employees e
--     LEFT JOIN branch_master bm ON bm.id = e.branch_id
--    WHERE e.active_status = 1 AND (bm.id IS NULL OR bm.active_status = 0);
