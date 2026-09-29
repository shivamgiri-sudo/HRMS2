-- Registers the upload_template_master entry for Appreciate Chat -- the new
-- upload type sql/1779's table serves. Required/optional columns are the
-- header row of the sample the user supplied. Applied ahead of the table
-- existing (same pattern as sql/1775/1777) -- harmless; uploads will fail
-- with a table-not-found error until sql/1779 is run.
INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'AW_CHAT_MASMIS', 'Appreciate Wealth — Chat (writes to db_masmis.appreciate_chat)', 'db_masmis.appreciate_chat',
   'Appreciate Wealth chat / conversation export -- writes into a new table.',
   JSON_ARRAY('Conversation id'),
   JSON_ARRAY('Date','Member Assigned At','Resolution Time','First Response Time Chrs','Initiated At','Assigned Agent name','Conversation status','User properties Name','User properties Email','User properties Phone number','Issue Re-opened','Response due type','Status','Interaction Time','Issue Resolved','Label category','Label subcategory','Resolved At','Csat Score','CSAT received by','C-SAT','Handle/not handle','FRT in sec','FRT In time'),
   JSON_OBJECT('Conversation id', '912940591923913', 'Assigned Agent name', 'Tanishq Singh', 'Conversation status', 'Resolved'),
   1);
