-- Bellavita Chat uploader: make the template catalog match the NEW chat table.
--
-- The BB_CHAT_MASMIS importer (bb-chat-masmis-bulk.service.ts) has written to db_masmis.new_bb_chat
-- since 2026-09-19 and keys each row on "Unique ID", but the upload_template_master row still described
-- the old db_masmis.bb_chat export (required column "Ticket ID", the old ticket-export headers). The
-- uploader screen therefore showed "Required columns: Ticket ID" and "Download Template" produced the
-- old headers. Replace them with the 24 columns of the new sheet, in sheet order:
--   Repeat Status, Repeat Status on Assign Time, FRT, Resolution Time (In Min), FRT TAT, Resolution TAT,
--   Phone Number1, Current Agent, Email, Date, ID, LOB, Week, Count 1, Time Slot, Hour, TL Name,
--   Disposition, Day Shift/Night Shift, Unique ID, Fraud, FRT (second column, read as FRT_1),
--   User Type, Repeat/Chat.
-- Only this one catalog row changes; no table is created or altered (db_masmis.new_bb_chat already exists).
UPDATE upload_template_master
   SET upload_type_name = 'Bellavita — Chat (writes to db_masmis.new_bb_chat)',
       target_table     = 'db_masmis.new_bb_chat',
       description      = 'Bellavita chat export -- writes into db_masmis.new_bb_chat (one row per Unique ID).',
       required_columns = JSON_ARRAY('Unique ID'),
       optional_columns = JSON_ARRAY(
         'Repeat Status', 'Repeat Status on Assign Time', 'FRT', 'Resolution Time (In Min)', 'FRT TAT', 'Resolution TAT',
         'Phone Number1', 'Current Agent', 'Email', 'Date', 'ID', 'LOB', 'Week', 'Count 1', 'Time Slot', 'Hour',
         'TL Name', 'Disposition', 'Day Shift/Night Shift', 'Fraud', 'FRT_1', 'User Type', 'Repeat/Chat'
       ),
       sample_row       = JSON_OBJECT('Unique ID', 'SAMPLE-1', 'Date', '1-Sep-26', 'Current Agent', 'Agent Name', 'User Type', 'Chat')
 WHERE upload_type_code = 'BB_CHAT_MASMIS';
