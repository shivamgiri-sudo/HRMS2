-- Migration 451: Atomic queue token sequence table
--
-- generateTokenNumber() used COUNT(*) with no lock, causing duplicate token
-- numbers when registrations happened simultaneously (confirmed on 2026-09-29:
-- NOI-20260929-010 issued 4x, -015/-016/-017 issued 2x each at same ms).
-- This table provides an atomic per-branch-per-day sequence, the same pattern
-- as employee_code_sequence.

CREATE TABLE IF NOT EXISTS ats_queue_token_sequence (
  id           CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  branch_name  VARCHAR(100) NOT NULL,
  seq_date     DATE         NOT NULL,
  current_seq  INT          NOT NULL DEFAULT 0,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_branch_date (branch_name, seq_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed today's sequences from existing token counts so the counter starts
-- at the right number for any branch that already has tokens today.
INSERT INTO ats_queue_token_sequence (branch_name, seq_date, current_seq)
SELECT branch_name, DATE(created_at) AS seq_date, COUNT(*) AS current_seq
FROM ats_queue_token
WHERE DATE(created_at) = CURDATE()
  AND branch_name IS NOT NULL
GROUP BY branch_name, DATE(created_at)
ON DUPLICATE KEY UPDATE current_seq = VALUES(current_seq);
