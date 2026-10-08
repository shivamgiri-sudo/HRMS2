-- Migration 1998: metric codes for the second batch of upload feeds into kpi_daily_actual: Satya Retail (allocation + calls),
-- Appreciate Wealth (agent-day billing / outbound), Clovia chat and Clovia outbound. INSERT IGNORE, additive.
INSERT IGNORE INTO kpi_metric_master
  (id, metric_code, metric_name, category, family, unit, direction, aggregation_method, active_status)
VALUES
  (UUID(), 'SATYA_ALLOCATED',      'Satya shops allocated',        'operations', 'volume',  'count',   'higher_is_better', 'sum',     1),
  (UUID(), 'SATYA_CONNECTED',      'Satya shops connected',        'operations', 'volume',  'count',   'higher_is_better', 'sum',     1),
  (UUID(), 'SATYA_ORDERS',         'Satya orders placed',          'sales',      'volume',  'count',   'higher_is_better', 'sum',     1),
  (UUID(), 'SATYA_CONVERSION_PCT', 'Satya order conversion %',     'sales',      'rate',    'percent', 'higher_is_better', 'average', 1),
  (UUID(), 'SATYA_CALLS',          'Satya calls made',             'operations', 'volume',  'count',   'higher_is_better', 'sum',     1),
  (UUID(), 'AW_CALLS',             'Appreciate calls',             'operations', 'volume',  'count',   'higher_is_better', 'sum',     1),
  (UUID(), 'AW_CONNECTED',         'Appreciate connected calls',   'operations', 'volume',  'count',   'higher_is_better', 'sum',     1),
  (UUID(), 'AW_CONNECT_PCT',       'Appreciate connect %',         'operations', 'rate',    'percent', 'higher_is_better', 'average', 1),
  (UUID(), 'AW_AVG_TALK_SEC',      'Appreciate avg talk per call', 'operations', 'duration','seconds', 'lower_is_better',  'average', 1),
  (UUID(), 'AW_LOGIN_HOURS',       'Appreciate login hours',       'hr',         'duration','hours',   'higher_is_better', 'average', 1),
  (UUID(), 'CL_CHATS',             'Clovia chats handled',         'operations', 'volume',  'count',   'higher_is_better', 'sum',     1),
  (UUID(), 'CL_CHAT_RATING',       'Clovia chat customer rating',  'quality',    'rate',    'ratio',   'higher_is_better', 'average', 1),
  (UUID(), 'CL_CHAT_WAIT_SEC',     'Clovia chat wait to accept',   'operations', 'duration','seconds', 'lower_is_better',  'average', 1),
  (UUID(), 'CL_OB_DIALS',          'Clovia outbound dials',        'operations', 'volume',  'count',   'higher_is_better', 'sum',     1),
  (UUID(), 'CL_OB_CONNECTED',      'Clovia outbound connected',    'operations', 'volume',  'count',   'higher_is_better', 'sum',     1),
  (UUID(), 'CL_OB_CONNECT_PCT',    'Clovia outbound connect %',    'operations', 'rate',    'percent', 'higher_is_better', 'average', 1),
  (UUID(), 'CL_OB_AVG_TALK_SEC',   'Clovia outbound avg talk',     'operations', 'duration','seconds', 'lower_is_better',  'average', 1);
