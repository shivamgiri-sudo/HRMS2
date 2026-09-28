-- Migration 1907: Fix collation + add missing FKs on skill roadmap tables.
-- employees.id / designation_master.id use utf8mb4_unicode_ci; the three skill
-- tables used utf8mb4_0900_ai_ci, causing MySQL to reject FK creation (ERROR 3780).
-- Fix: convert the referencing columns with MODIFY COLUMN, then add FKs ON DELETE CASCADE.
-- MODIFY COLUMN is idempotent. DROP FOREIGN KEY IF EXISTS makes re-runs safe.

-- employee_skill_states -------------------------------------------------------
ALTER TABLE employee_skill_states
  MODIFY COLUMN employee_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;

ALTER TABLE employee_skill_states
  DROP FOREIGN KEY IF EXISTS fk_ess_employee;
ALTER TABLE employee_skill_states
  ADD CONSTRAINT fk_ess_employee
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;

-- employee_roadmap_assignments ------------------------------------------------
ALTER TABLE employee_roadmap_assignments
  MODIFY COLUMN employee_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;

ALTER TABLE employee_roadmap_assignments
  DROP FOREIGN KEY IF EXISTS fk_era_employee;
ALTER TABLE employee_roadmap_assignments
  ADD CONSTRAINT fk_era_employee
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;

-- designation_required_skills -------------------------------------------------
ALTER TABLE designation_required_skills
  MODIFY COLUMN designation_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;

ALTER TABLE designation_required_skills
  DROP FOREIGN KEY IF EXISTS fk_drs_designation;
ALTER TABLE designation_required_skills
  ADD CONSTRAINT fk_drs_designation
  FOREIGN KEY (designation_id) REFERENCES designation_master(id) ON DELETE CASCADE;
