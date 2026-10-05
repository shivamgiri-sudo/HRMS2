-- 2103: seed he_template with every follow-up template, in draft. The orchestrator only sends templates whose
-- approval_state = 'approved', so nothing can be sent until someone records the Meta approval (and, if Pinbot
-- approved a different name, updates pinbot_name). INSERT IGNORE: never overwrites an edited/approved row.
INSERT IGNORE INTO he_template (template_key, pinbot_name, language, param_names, sample_body, approval_state) VALUES
  ('he_walkin_invite:hi', 'he_walkin_invite_hi', 'hi', '["candidate_name", "role", "company", "drive_date", "slot_time", "branch_address", "maps_link", "assessment_link", "docs_list"]', 'Namaste {candidate_name} ji, aapki application {role} ke liye {company} mein shortlist hui hai.

Walk-in interview:
Date: {drive_date}
Time: {slot_time}
Jagah: {branch_address}
Map: {maps_link}

Assessment link (interview se pehle bharein): {assessment_link}
Saath laayein: {docs_list}

Kya aap aa payenge? Neeche se jawab dein.', 'draft'),
  ('he_walkin_invite:en', 'he_walkin_invite_en', 'en', '["candidate_name", "role", "company", "drive_date", "slot_time", "branch_address", "maps_link", "assessment_link", "docs_list"]', 'Hello {candidate_name}, your application for {role} at {company} has been shortlisted.

Walk-in interview:
Date: {drive_date}
Time: {slot_time}
Venue: {branch_address}
Map: {maps_link}

Assessment link (please complete before the interview): {assessment_link}
Please bring: {docs_list}

Will you be able to attend? Please reply using the buttons below.', 'draft'),
  ('he_walkin_confirmed:hi', 'he_walkin_confirmed_hi', 'hi', '["candidate_name", "drive_date", "slot_time", "branch_name", "reference_id", "contact_name", "contact_phone"]', 'Shukriya {candidate_name} ji! Aapka walk-in confirm ho gaya hai.

{drive_date} ko {slot_time} baje {branch_name} par aayein. Reference ID: {reference_id}.

Reception par yeh ID bataiye. Koi dikkat ho to {contact_name} ko {contact_phone} par call karein.', 'draft'),
  ('he_walkin_confirmed:en', 'he_walkin_confirmed_en', 'en', '["candidate_name", "drive_date", "slot_time", "branch_name", "reference_id", "contact_name", "contact_phone"]', 'Thank you {candidate_name}! Your walk-in is confirmed.

Please come on {drive_date} at {slot_time} to {branch_name}. Reference ID: {reference_id}.

Share this ID at reception. For any help, call {contact_name} on {contact_phone}.', 'draft'),
  ('he_reminder_1d:hi', 'he_reminder_1d_hi', 'hi', '["candidate_name", "slot_time", "branch_name", "role", "docs_list", "maps_link"]', 'Namaste {candidate_name} ji, yaad dila rahe hain ki kal {slot_time} baje {branch_name} par aapka {role} ka walk-in interview hai.

Saath laayein: {docs_list}. Pata: {maps_link}

Pakka aa rahe hain?', 'draft'),
  ('he_reminder_1d:en', 'he_reminder_1d_en', 'en', '["candidate_name", "role", "slot_time", "branch_name", "docs_list", "maps_link"]', 'Hello {candidate_name}, a quick reminder: your {role} walk-in interview is tomorrow at {slot_time} at {branch_name}.

Please bring: {docs_list}. Address: {maps_link}

Are you still able to come?', 'draft'),
  ('he_reminder_2h_location:hi', 'he_reminder_2h_location_hi', 'hi', '["candidate_name", "slot_time", "branch_name"]', 'Namaste {candidate_name} ji, aapka interview aaj {slot_time} baje {branch_name} par hai.

Agar aap chahein to nikalte waqt "Main nikal gaya" par tap karke apni location share kar sakte hain. Isse branch aapke aane ka time jaan kar taiyari kar paayegi. Yeh poori tarah aapki marzi par hai aur aap kabhi bhi band kar sakte hain.', 'draft'),
  ('he_reminder_2h_location:en', 'he_reminder_2h_location_en', 'en', '["candidate_name", "slot_time", "branch_name"]', 'Hi {candidate_name}, your interview is today at {slot_time} at {branch_name}.

If you wish, tap "I''m on my way" and share your location while travelling. This helps the branch prepare for your arrival. It is entirely optional and you can stop sharing at any time.', 'draft'),
  ('he_reschedule_offer:hi', 'he_reschedule_offer_hi', 'hi', '["candidate_name", "drive_date", "slot_time", "branch_name", "branch_address"]', 'Koi baat nahi {candidate_name} ji. Aapke liye naya slot ye hai:

{drive_date}, {slot_time} baje, {branch_name}
Pata: {branch_address}

Kya yeh theek rahega?', 'draft'),
  ('he_reschedule_offer:en', 'he_reschedule_offer_en', 'en', '["candidate_name", "drive_date", "slot_time", "branch_name", "branch_address"]', 'No problem {candidate_name}. Here is a new slot for you:

{drive_date} at {slot_time}, {branch_name}
Address: {branch_address}

Does this work for you?', 'draft'),
  ('he_no_show_recovery:hi', 'he_no_show_recovery_hi', 'hi', '["candidate_name", "branch_name", "role"]', 'Namaste {candidate_name} ji, aaj aap {branch_name} par interview ke liye nahi aa paaye. Sab theek hai na?

Agar aap abhi bhi {role} ke liye interested hain to hum naya slot de sakte hain.', 'draft'),
  ('he_no_show_recovery:en', 'he_no_show_recovery_en', 'en', '["candidate_name", "branch_name", "role"]', 'Hello {candidate_name}, we missed you at {branch_name} for your interview today. Hope all is well.

If you are still interested in {role}, we can arrange a new slot for you.', 'draft'),
  ('he_other_role_offer:hi', 'he_other_role_offer_hi', 'hi', '["candidate_name", "company", "role", "branch_name"]', 'Namaste {candidate_name} ji, {company} mein aapki profile ke hisaab se ek aur opening hai: {role}, {branch_name} branch par.

Interested hain to hum aapko walk-in ka time bhej denge.', 'draft'),
  ('he_other_role_offer:en', 'he_other_role_offer_en', 'en', '["candidate_name", "company", "role", "branch_name"]', 'Hello {candidate_name}, {company} has another opening that matches your profile: {role} at our {branch_name} branch.

If you are interested, we will share a walk-in time with you.', 'draft'),
  ('he_winback:hi', 'he_winback_hi', 'hi', '["candidate_name", "company", "drive_date", "branch_name", "role"]', 'Namaste {candidate_name} ji, {company} mein {drive_date} ko {branch_name} par {role} ke liye walk-in drive hai.

Agar aap job ki talaash mein hain to hume bataiye, hum slot book kar denge.', 'draft'),
  ('he_winback:en', 'he_winback_en', 'en', '["candidate_name", "company", "role", "branch_name", "drive_date"]', 'Hello {candidate_name}, {company} is hosting a walk-in drive for {role} at {branch_name} on {drive_date}.

If you are looking for a job, let us know and we will book a slot for you.', 'draft'),
  ('he_missed_call:hi', 'he_missed_call_hi', 'hi', '["candidate_name", "company", "role", "drive_date", "slot_time", "branch_name"]', 'Namaste {candidate_name} ji, {company} ki HR team ne aapko {role} interview ke baare mein call kiya tha, par baat nahi ho payi.

Aapka walk-in {drive_date} ko {slot_time} baje {branch_name} par hai. Kya aap aa payenge?', 'draft'),
  ('he_missed_call:en', 'he_missed_call_en', 'en', '["candidate_name", "company", "role", "drive_date", "slot_time", "branch_name"]', 'Hello {candidate_name}, the {company} HR team tried calling you about your {role} interview but could not reach you.

Your walk-in is on {drive_date} at {slot_time} at {branch_name}. Will you be able to attend?', 'draft'),
  ('he_optout_ack:hi', 'he_optout_ack_hi', 'hi', '["candidate_name"]', 'Theek hai {candidate_name} ji, ab hum aapko job se jude messages nahi bhejenge. Dobara jaankari chahiye to "START" likh dijiye.', 'draft'),
  ('he_optout_ack:en', 'he_optout_ack_en', 'en', '["candidate_name"]', 'Understood {candidate_name}. We will no longer send you job-related messages. Reply "START" if you want updates again.', 'draft'),
  ('he_hr_arrival_alert:hi', 'he_hr_arrival_alert_hi', 'hi', '["contact_name", "branch_name", "expected_count", "confirmed_count", "live_count", "board_link"]', 'Namaste {contact_name} ji, {branch_name} par agle 30 minute mein {expected_count} candidate aane wale hain. Confirmed: {confirmed_count}, live location se: {live_count}. Board dekhein: {board_link} . Dhanyavaad.', 'draft'),
  ('he_hr_arrival_alert:en', 'he_hr_arrival_alert_en', 'en', '["contact_name", "expected_count", "branch_name", "confirmed_count", "live_count", "board_link"]', 'Hi {contact_name}, {expected_count} candidates are expected at {branch_name} within the next 30 minutes. Confirmed: {confirmed_count}, via live location: {live_count}. View board: {board_link} . Thank you.', 'draft');
