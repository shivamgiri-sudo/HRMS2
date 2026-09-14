-- Seed default rows for the 5 hiring-entry option groups that the ATS form config
-- admin UI manages (hiringProcessOptions, hiringSourceOptions, hiringPositionOptions,
-- hiringWpGroupOptions, hiringCallingOutcomeOptions).
-- Uses INSERT IGNORE so re-running is safe and existing customised values are preserved.

INSERT IGNORE INTO ats_form_config
  (id, config_key, config_label, config_type, config_value, sort_order, updated_by)
VALUES
  (UUID(), 'hiringProcessOptions',        'Hiring Entry Process Options',          'option_list',
   JSON_ARRAY('Walk-In', 'Referral', 'Job Portal', 'Consultancy', 'Campus Drive'),
   20, 'system'),

  (UUID(), 'hiringSourceOptions',         'Hiring Entry Source Options',           'option_list',
   JSON_ARRAY('Walk-In', 'Reference', 'Job Portal', 'Consultancy', 'Employee Referral'),
   21, 'system'),

  (UUID(), 'hiringPositionOptions',       'Hiring Entry Position Options',         'option_list',
   JSON_ARRAY('Inbound Agent', 'Outbound Agent', 'Back Office', 'Team Leader', 'Quality Analyst'),
   22, 'system'),

  (UUID(), 'hiringWpGroupOptions',        'Hiring Entry WP Group Options',         'option_list',
   JSON_ARRAY(),
   23, 'system'),

  (UUID(), 'hiringCallingOutcomeOptions', 'Hiring Entry Calling Outcome Options',  'option_list',
   JSON_ARRAY('Interested', 'Not Interested', 'Not Reachable', 'Call Back Later', 'Wrong Number'),
   24, 'system');
