-- A resignation is visible to the reporting TL (to) and now also to the AM (the TL's manager) from the day it
-- is submitted: add the existing 'skip_level_manager' recipient kind to the CC list of resignation_submitted.
-- Appends only when it is not already there, so it is safe to re-run and never removes an existing recipient.

UPDATE notification_event_config
   SET recipient_spec = JSON_SET(
         recipient_spec,
         '$.cc',
         JSON_ARRAY_APPEND(COALESCE(JSON_EXTRACT(recipient_spec, '$.cc'), JSON_ARRAY()), '$', JSON_OBJECT('kind', 'skip_level_manager'))
       ),
       updated_at = NOW()
 WHERE event_code = 'resignation_submitted'
   AND JSON_SEARCH(COALESCE(JSON_EXTRACT(recipient_spec, '$.cc'), JSON_ARRAY()), 'one', 'skip_level_manager', NULL, '$[*].kind') IS NULL;
