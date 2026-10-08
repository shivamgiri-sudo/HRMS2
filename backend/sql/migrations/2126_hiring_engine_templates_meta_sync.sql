-- Align he_template with the Meta-approved texts: T1 starts with "Hello {{1}}" (9 variables), T2 is named ..._confirmed, T6 has 3 variables.
UPDATE he_template SET
  param_names = '["candidate_name", "role", "company", "drive_date", "slot_time", "branch_address", "maps_link", "assessment_link", "docs_list"]',
  sample_body = 'Hello {candidate_name},

Your interview appointment for the {role} position at {company} is scheduled.

Date: {drive_date}
Time: {slot_time}
Venue: {branch_address}

Location: {maps_link}.
Assessment: {assessment_link}.
Documents required: {docs_list}.

Please confirm your attendance using the options below.'
 WHERE template_key = 'he_walkin_invite:en';

UPDATE he_template SET pinbot_name = 't2_he_appointment_confirmed' WHERE template_key = 'he_walkin_confirmed:en';

UPDATE he_template SET
  param_names = '["candidate_name", "branch_name", "role"]',
  sample_body = 'Your scheduled appointment was not attended today.

Candidate: {candidate_name}
Branch: {branch_name}
Role: {role}

If you would like to reschedule the appointment, please select an option below.'
 WHERE template_key = 'he_no_show_recovery:en';
