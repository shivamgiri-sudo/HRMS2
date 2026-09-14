-- Small follow-up to sql/1757: a handful of BB_CHAT_MASMIS real-header
-- guesses were missed when writing that migration's optional_columns
-- addition, even though they were already accounted for in the
-- corresponding bb-chat-masmis-bulk.service.ts code change made alongside
-- it. Appends the missing ones (JSON_MERGE_PRESERVE, additive only) so the
-- catalog gate and the importer's accepted keys stay consistent.
UPDATE upload_template_master
   SET optional_columns = JSON_MERGE_PRESERVE(
         optional_columns,
         JSON_ARRAY('Ticket Status', 'LOB', 'Resolution Time In Minutes', 'FRT TAT', 'Resolution TAT', 'FRT 2')
       )
 WHERE upload_type_code = 'BB_CHAT_MASMIS';
