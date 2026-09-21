-- Migration 1829: META campaign lead screening config on job_requisition
--
-- Adds meta_screening_config JSON column that drives auto-screening of incoming
-- META Lead Gen leads beyond the basic age/education/experience already stored
-- in meta_target_age_min/max, education_requirement, experience_min_years.
--
-- New screening dimensions stored here:
--   auto_notify       bool   — send WhatsApp immediately when a lead qualifies (default true)
--   gender            string — any | male | female
--   certifications    array  — ["DRA","IRDA","NCFM","NSE","AMFI","NISM"]
--   language_requirements array — [{language,skills:[speak,read,write]}]
--   min_typing_speed_wpm  number — for chat/email processes
--   written_english_level string — basic|intermediate|advanced
--   custom_field_rules array — [{field,op,value,label}] — arbitrary form-field conditions

ALTER TABLE job_requisition
  ADD COLUMN meta_screening_config JSON NULL
    AFTER meta_target_radius_km;
