-- 2116: the 11 English follow-up templates were approved at Meta (BookMyInterview T1-T11 master, 2026-10) under
-- t1_..t11_ names. Records the approved name, the {{n}} parameter order and the approved body, and marks them approved.
-- Hinglish rows stay draft (sends fall back to English). Re-runnable: plain UPDATEs keyed on template_key.
UPDATE he_template SET pinbot_name = 't1_he_walkin_invitation', language = 'en', param_names = '["role", "company", "drive_date", "slot_time", "branch_address", "maps_link", "assessment_link", "docs_list"]', sample_body = 'Your interview for the {role} position at {company} has been scheduled.

Date: {drive_date}
Time: {slot_time}
Venue: {branch_address}

Location: {maps_link}.
Assessment: {assessment_link}.
Documents required: {docs_list}.

Please confirm your attendance using the options below.', approval_state = 'approved' WHERE template_key = 'he_walkin_invite:en';
UPDATE he_template SET pinbot_name = 't2_he_appointment_confirmation', language = 'en', param_names = '["candidate_name", "drive_date", "slot_time", "branch_name", "reference_id", "contact_name", "contact_phone"]', sample_body = 'Your appointment details have been recorded.

Name: {candidate_name}
Date: {drive_date}
Time: {slot_time}
Location: {branch_name}

Reference ID: {reference_id}

Please keep this Reference ID for your visit.

For assistance, contact {contact_name} at {contact_phone} for appointment-related queries.', approval_state = 'approved' WHERE template_key = 'he_walkin_confirmed:en';
UPDATE he_template SET pinbot_name = 't3_he_reminder_1d', language = 'en', param_names = '["candidate_name", "role", "drive_date", "slot_time", "branch_name", "docs_list", "maps_link"]', sample_body = 'This is a reminder about your scheduled appointment.

Candidate: {candidate_name}
Role: {role}
Date: {drive_date}
Time: {slot_time}
Branch: {branch_name}

Documents required: {docs_list}

Location details are available here: {maps_link}.

Please confirm your attendance using the option below.', approval_state = 'approved' WHERE template_key = 'he_reminder_1d:en';
UPDATE he_template SET pinbot_name = 't4_he_reminder_2h_location', language = 'en', param_names = '["candidate_name", "slot_time", "branch_name"]', sample_body = 'Your interview is scheduled for today.

Candidate: {candidate_name}
Time: {slot_time}
Branch: {branch_name}

If you are travelling to the branch, you may optionally share your arrival location using the button below.

You can choose not to share your location.', approval_state = 'approved' WHERE template_key = 'he_reminder_2h_location:en';
UPDATE he_template SET pinbot_name = 't5_he_reschedule_offer', language = 'en', param_names = '["candidate_name", "drive_date", "slot_time", "branch_name", "branch_address"]', sample_body = 'A new appointment slot is available for {candidate_name}.

Date: {drive_date}
Time: {slot_time}
Branch: {branch_name}
Address: {branch_address}

Please confirm whether this new appointment slot works for you.', approval_state = 'approved' WHERE template_key = 'he_reschedule_offer:en';
UPDATE he_template SET pinbot_name = 't6_he_no_show_recovery', language = 'en', param_names = '["candidate_name", "drive_date", "slot_time", "branch_name"]', sample_body = 'Your scheduled appointment was not attended today.

Candidate: {candidate_name}
Date: {drive_date}
Time: {slot_time}
Branch: {branch_name}

If you would like to reschedule the appointment, please select an option below.', approval_state = 'approved' WHERE template_key = 'he_no_show_recovery:en';
UPDATE he_template SET pinbot_name = 't7_he_other_role_offer', language = 'en', param_names = '["candidate_name", "company", "role", "branch_name"]', sample_body = 'Hello {candidate_name},

{company} has another opening that may match your profile.

Position: {role}
Branch: {branch_name}

If you are interested, select an option below to learn more.', approval_state = 'approved' WHERE template_key = 'he_other_role_offer:en';
UPDATE he_template SET pinbot_name = 't8_he_winback', language = 'en', param_names = '["candidate_name", "company", "role", "branch_name", "drive_date"]', sample_body = 'Hello {candidate_name},

{company} is hosting a walk-in drive for the {role} position at {branch_name} on {drive_date}.

If you are interested in this opportunity, select an option below and we can help you book a slot.', approval_state = 'approved' WHERE template_key = 'he_winback:en';
UPDATE he_template SET pinbot_name = 't9_he_missed_call', language = 'en', param_names = '["candidate_name", "company", "role", "drive_date", "slot_time", "branch_name"]', sample_body = 'Your scheduled interview appointment is pending confirmation.

Candidate: {candidate_name}
Company: {company}
Role: {role}
Date: {drive_date}
Time: {slot_time}
Branch: {branch_name}

Please confirm whether you will attend using the options below.', approval_state = 'approved' WHERE template_key = 'he_missed_call:en';
UPDATE he_template SET pinbot_name = 't10_he_optout_ack', language = 'en', param_names = '["candidate_name"]', sample_body = 'Your opt-out request has been recorded.

Candidate: {candidate_name}

You will no longer receive job-related messages from us.

To receive updates again in the future, reply START.', approval_state = 'approved' WHERE template_key = 'he_optout_ack:en';
UPDATE he_template SET pinbot_name = 't11_he_hr_arrival_alert', language = 'en', param_names = '["contact_name", "expected_count", "branch_name", "confirmed_count", "live_count", "board_link"]', sample_body = 'Candidate arrival update for {contact_name}.

Expected candidates: {expected_count}
Branch: {branch_name}
Confirmed candidates: {confirmed_count}
Location shared: {live_count}

View the arrival board here: {board_link}.

Please prepare for the expected arrivals.', approval_state = 'approved' WHERE template_key = 'he_hr_arrival_alert:en';
