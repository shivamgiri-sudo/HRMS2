-- Migration 1993: metric codes for the upload feeds that now write per-employee rows into kpi_daily_actual
-- (kpi-upload-feeds.service.ts): SBI Card collections, Bellavita chat, Clovia email. INSERT IGNORE, additive.
INSERT IGNORE INTO kpi_metric_master
  (id, metric_code, metric_name, category, family, unit, direction, aggregation_method, active_status)
VALUES
  (UUID(), 'COLLECTION_CALLS',        'Collection calls',          'operations', 'volume', 'count',   'higher_is_better', 'sum',     1),
  (UUID(), 'COLLECTION_CONTACTS',     'Collection contacts',       'operations', 'volume', 'count',   'higher_is_better', 'sum',     1),
  (UUID(), 'COLLECTION_CONTACT_RATE', 'Collection contact rate',   'operations', 'rate',   'percent', 'higher_is_better', 'average', 1),
  (UUID(), 'COLLECTION_PTP',          'Promise to pay (PTP)',      'sales',      'volume', 'count',   'higher_is_better', 'sum',     1),
  (UUID(), 'COLLECTION_PAD',          'Payment after dial (PAD)',  'sales',      'volume', 'count',   'higher_is_better', 'sum',     1),
  (UUID(), 'COLLECTION_AMOUNT',       'Amount collected',          'sales',      'volume', 'currency','higher_is_better', 'sum',     1),
  (UUID(), 'CHAT_TICKETS',            'Chat tickets handled',      'operations', 'volume', 'count',   'higher_is_better', 'sum',     1),
  (UUID(), 'CHAT_RESOLVED_PCT',       'Chat resolved %',           'quality',    'rate',   'percent', 'higher_is_better', 'average', 1),
  (UUID(), 'CHAT_FRT_MIN',            'Chat first response time',  'operations', 'duration','minutes','lower_is_better',  'average', 1),
  (UUID(), 'EMAIL_ASSIGNED',          'Emails assigned',           'operations', 'volume', 'count',   'higher_is_better', 'sum',     1),
  (UUID(), 'EMAIL_CLOSURE_PCT',       'Email closure %',           'operations', 'rate',   'percent', 'higher_is_better', 'average', 1);
