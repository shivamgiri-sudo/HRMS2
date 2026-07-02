USE mas_hrms;

-- ATS form configuration: dropdown option lists + field schema
CREATE TABLE IF NOT EXISTS ats_form_config (
  id           CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  config_key   VARCHAR(100) NOT NULL,
  config_label VARCHAR(200) NOT NULL,
  config_type  ENUM('option_list','field_schema') NOT NULL,
  config_value JSON         NOT NULL,
  sort_order   INT          NOT NULL DEFAULT 0,
  updated_by   CHAR(36)     NULL,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY ux_form_config_key (config_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Recruiter list (manually managed, independent of employees table)
CREATE TABLE IF NOT EXISTS ats_recruiter (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  name          VARCHAR(255) NOT NULL,
  active_status TINYINT(1)   NOT NULL DEFAULT 1,
  sort_order    INT          NOT NULL DEFAULT 0,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_recruiter_active (active_status, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed dropdown option lists
INSERT IGNORE INTO ats_form_config (id, config_key, config_label, config_type, config_value, sort_order) VALUES
  (UUID(), 'roleOptions',           'Role / Designation Options', 'option_list',
   JSON_ARRAY('Inbound Agent','Outbound Agent','Back Office','Team Leader','Quality Analyst'), 1),
  (UUID(), 'educationOptions',      'Education Level Options',    'option_list',
   JSON_ARRAY('10th Pass','12th Pass','Graduate','Post Graduate','Diploma'), 2),
  (UUID(), 'experienceOptions',     'Experience Level Options',   'option_list',
   JSON_ARRAY('Fresher','0-1 Year','1-2 Years','2-3 Years','3+ Years'), 3),
  (UUID(), 'preferredShiftOptions', 'Preferred Shift Options',    'option_list',
   JSON_ARRAY('Morning (6AM-2PM)','Afternoon (2PM-10PM)','Night (10PM-6AM)','Rotational'), 4),
  (UUID(), 'nightShiftComfortOptions','Night Shift Comfort Options','option_list',
   JSON_ARRAY('Comfortable','Not Comfortable','On Request'), 5),
  (UUID(), 'genderOptions',         'Gender Options',             'option_list',
   JSON_ARRAY('Male','Female','Other'), 6);

-- Seed field schema (controls visibility, required, label, section, order for each form field)
INSERT IGNORE INTO ats_form_config (id, config_key, config_label, config_type, config_value, sort_order)
VALUES (UUID(), 'formFields', 'Form Field Schema', 'field_schema', JSON_ARRAY(
  JSON_OBJECT('k','name',      'lb','Full Name',          't','text',     'ic','👤','ph','Enter your full name',   'ok',NULL,'section','Basic Details', 'visible',true,'required',true, 'sort_order',1),
  JSON_OBJECT('k','mobile',    'lb','Mobile Number',      't','tel',      'ic','📞','ph','10-digit mobile number', 'ok',NULL,'section','Basic Details', 'visible',true,'required',true, 'sort_order',2),
  JSON_OBJECT('k','email',     'lb','Email Address',      't','email',    'ic','✉️','ph','your.email@example.com','ok',NULL,'section','Basic Details', 'visible',true,'required',false,'sort_order',3),
  JSON_OBJECT('k','address',   'lb','Address',            't','textarea', 'ic','📍','ph','Your residential address','ok',NULL,'section','Basic Details','visible',true,'required',true, 'sort_order',4),
  JSON_OBJECT('k','education', 'lb','Education',          't','select',   'ic','🎓','ph',NULL,'ok','educationOptions','section','Basic Details',  'visible',true,'required',true, 'sort_order',5),
  JSON_OBJECT('k','experience','lb','Experience',         't','select',   'ic','💼','ph',NULL,'ok','experienceOptions','section','Basic Details', 'visible',true,'required',true, 'sort_order',6),
  JSON_OBJECT('k','gender',    'lb','Gender',             't','select',   'ic','🧑','ph',NULL,'ok','genderOptions',    'section','Basic Details', 'visible',true,'required',true, 'sort_order',7),
  JSON_OBJECT('k','roleApplied',    'lb','Role Applied',           't','select','ic','🗂️','ph',NULL,'ok','roleOptions',          'section','Job Details','visible',true,'required',true, 'sort_order',8),
  JSON_OBJECT('k','recruiterName',  'lb','Recruiter Name',         't','select','ic','🤝','ph',NULL,'ok','recruiterOptions',     'section','Job Details','visible',true,'required',true, 'sort_order',9),
  JSON_OBJECT('k','branch',         'lb','Branch',                 't','select','ic','🏢','ph',NULL,'ok','branchOptions',        'section','Job Details','visible',true,'required',true, 'sort_order',10),
  JSON_OBJECT('k','rotationalShift','lb','Rotational Shift',       't','select','ic','🔄','ph',NULL,'ok','yesNoOptions',         'section','Job Details','visible',true,'required',true, 'sort_order',11),
  JSON_OBJECT('k','preferredShift', 'lb','Preferred Shift',        't','select','ic','🕐','ph',NULL,'ok','preferredShiftOptions','section','Job Details','visible',true,'required',true, 'sort_order',12),
  JSON_OBJECT('k','nightShiftComfort','lb','Night Shift Comfort',  't','select','ic','🌙','ph',NULL,'ok','nightShiftComfortOptions','section','Job Details','visible',true,'required',true,'sort_order',13),
  JSON_OBJECT('k','leavesRequired', 'lb','Leaves Required in 3 Months','t','select','ic','📅','ph',NULL,'ok','yesNoOptions','section','Job Details','visible',true,'required',true,'sort_order',14),
  JSON_OBJECT('k','ownTwoWheeler',       'lb','Own 2 Wheeler',               't','select','ic','🛵','ph',NULL,'ok','yesNoOptions','section','Verification','visible',true,'required',true, 'sort_order',15),
  JSON_OBJECT('k','idProofAvailable',    'lb','ID Proof Available',          't','select','ic','🪪','ph',NULL,'ok','yesNoOptions','section','Verification','visible',true,'required',true, 'sort_order',16),
  JSON_OBJECT('k','educationProofAvailable','lb','Education Proof Available','t','select','ic','📄','ph',NULL,'ok','yesNoOptions','section','Verification','visible',true,'required',true, 'sort_order',17),
  JSON_OBJECT('k','resumeFile', 'lb','Upload Resume',        't','file',  'ic','📎','ph',NULL,'ok',NULL,'section','Verification','visible',true,'required',false,'sort_order',18),
  JSON_OBJECT('k','selfieFile', 'lb','Capture Selfie (Optional)','t','camera','ic','📷','ph',NULL,'ok',NULL,'section','Verification','visible',true,'required',false,'sort_order',19)
), 10);

SELECT 'Migration 051 applied: ats_form_config + ats_recruiter created and seeded' AS status;
