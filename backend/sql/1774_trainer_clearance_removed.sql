-- Trainer clearance removed from the exit process entirely (owner ruling 2026-09-15).
-- createDefaultClearanceTasks() no longer creates the "LMS and certification closure"
-- task for any new exit going forward (exit-intelligence.service.ts).
--
-- This migration handles the two things that change for existing data:
--   1. Any already-created, still-open trainer/lms task must not keep blocking an
--      employee's "Move to Exited" transition (finalExitBlockers in exit.secure.routes.ts
--      counts any task not in ('cleared','waived')) — waive them.
--   2. The dedicated PROVISIONING_TRAINER_EXIT page (migration 1771) and its grants are
--      removed — the page will never have anything to show again.

UPDATE exit_clearance_task
   SET status = 'waived',
       cleared_at = NOW(),
       remarks = CONCAT_WS(' ', remarks, '[Trainer clearance step removed from exit process — owner ruling 2026-09-15]')
 WHERE clearance_area = 'lms'
   AND owner_role = 'trainer'
   AND status NOT IN ('cleared', 'waived');

DELETE FROM role_page_access WHERE page_code = 'PROVISIONING_TRAINER_EXIT';
DELETE FROM page_catalog WHERE page_code = 'PROVISIONING_TRAINER_EXIT';
