-- Registers the upload_template_master entry for GNC Chat -- the new
-- upload type sql/1774's table serves. Required/optional columns are the
-- real headers confirmed directly against the file the user supplied.
-- Applied ahead of the table existing (same pattern as sql/1767/1769/
-- 1771/1773) -- harmless; uploads will fail with a table-not-found error
-- until sql/1774 is run.
INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'GNC_CHAT_MASMIS', 'GNC — gnc_chat (writes to db_masmis.gnc_chat)', 'db_masmis.gnc_chat',
   'gnc_chat export -- writes into a new table.',
   JSON_ARRAY('TicketId'),
   JSON_ARRAY('TicketStatus','Channel','InboxName','AgentName','CustomerEmail','CustomerPhone','CustomerName','FirstAgentName','FirstAssignedAt','FirstAgentMessageTime','LastAgentMessageTime','FirstBotMessageTime','LastBotMessageTime','FirstCustomerMessageTime','LastCustomerMessageTime','LastResolutionAgentName','LastResolutionTime','AgentFRT (s)','BotFRT (s)','BotTurns','AgentTurns','CustomerTurns','IsHandledByBot','IsHandoff','IsResolved','IsClosed','IsEscalated','TicketClosedAt','TicketQueuedAt','FirstQueuedAt','TicketToWaitingAt','QueueTime (s)','WaitTime (s)','IsCheckoutCreated','Query','QueryCategory','ErrorInstance','ErrorAt','CodeError','Tags','CustomerTags','BotFailureInstances','QueryResolved','CompanyResolutionTime (min)','CustomerFRT (min)','CustomerResolutionTime (min)','ChatFlow','LastCustomerMessage','LastCustomerIntent','FirstCustomerMessage','FirstCustomerIntent','CreatedAt','UpdatedAt','ResponseTime (hrs)','ReopenCount','Contextualisation','ContextualisationCategory','FollowUpTime (min)','CSATRating','CSATReview','CSATCreatedAt','CSATUpdatedAt','OverallSentiment','PrimaryCategory','SecondaryCategory','ChurnRisk','UrgencyLevel','ProductName','PaymentMethod','OrderAmount','OrderId','PriceSensitivity','ResolutionConfidence','AISummary','TicketLink','TicketInOfficeHours','Phone Number','Date','Unique','FRT (IN TAT)','QRC','Response (IN TAT)'),
   JSON_OBJECT('TicketId', 'SAMPLE'),
   1);
