-- Migration 1907: Fix collation + add missing FKs on skill roadmap tables.
-- employees.id / designation_master.id use utf8mb4_unicode_ci; the three skill
-- tables used utf8mb4_0900_ai_ci — MySQL rejects FK creation across collations.
-- Fix: MODIFY COLUMN to align collation, then ADD CONSTRAINT.
-- employee_skill_states.employee_id was already converted by an earlier partial run.
-- No DROP needed — none of these three FKs exist yet (verified via information_schema).

ALTER TABLE employee_skill_states
  MODIFY COLUMN employee_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  ADD CONSTRAINT fk_ess_employee
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;

ALTER TABLE employee_roadmap_assignments
  MODIFY COLUMN employee_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  ADD CONSTRAINT fk_era_employee
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;

ALTER TABLE designation_required_skills
  MODIFY COLUMN designation_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  ADD CONSTRAINT fk_drs_designation
    FOREIGN KEY (designation_id) REFERENCES designation_master(id) ON DELETE CASCADE;
