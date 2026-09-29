-- Migration 1917: allow a company-wide "TOTAL" approved-HC entry in onfido_manpower_plan.
-- The owner has one approved headcount for the whole Onfido floor (181), not one per queue, so
-- Buffer % and Shortfall stayed blank until all three queues were filled. 'TOTAL' is appended to
-- the ENUM; when a TOTAL row is in force it is used as the floor's approved HC, otherwise the
-- per-queue sum rule is unchanged. Additive: only appends an ENUM member, existing rows untouched.

ALTER TABLE onfido_manpower_plan
  MODIFY COLUMN process_queue ENUM('EXTRACTION','POA','ENCORD','TOTAL') NOT NULL;
