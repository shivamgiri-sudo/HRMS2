-- Joined count per requisition: candidates whose employee code has been generated. The engine fills a requisition to 130% of its
-- seats (CEIL(requested * 1.3)) measured by this count, then moves on to the next requisition (same process, designation, branch).
-- Maintained by the engine tick (refreshJoinedHeadcount); HR's fulfilled_headcount (selected count) is not touched.
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'job_requisition' AND COLUMN_NAME = 'joined_headcount') = 0,
  "ALTER TABLE job_requisition ADD COLUMN joined_headcount INT NOT NULL DEFAULT 0", 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
