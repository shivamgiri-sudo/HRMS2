-- Migration 127: Add UNIQUE constraints on ats_candidate mobile and email
-- Previously enforced only at service layer; adding DB-level constraint removes race condition window.
-- Uses a partial-unique approach: mobile is always unique; email NULL rows are excluded by MySQL UNIQUE behaviour.

ALTER TABLE ats_candidate
  ADD CONSTRAINT uq_ats_candidate_mobile UNIQUE (mobile);

-- MySQL UNIQUE index on a nullable column allows multiple NULLs, so this is safe even if some rows have NULL email.
ALTER TABLE ats_candidate
  ADD CONSTRAINT uq_ats_candidate_email UNIQUE (email);
