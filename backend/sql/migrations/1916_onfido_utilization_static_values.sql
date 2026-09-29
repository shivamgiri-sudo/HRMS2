-- Migration 1916: static (uploaded) values for the Onfido Utilization calculated columns.
-- The owner does not want the Utilization sheet driven by formulas: WFM uploads the sheet's
-- calculated columns too (Utilization Forecast, with/without Adhoc, their %, POA Answering,
-- Escalated %). When a day has an uploaded value it is shown as-is; when it is NULL the
-- column falls back to the existing on-screen calculation, so nothing already entered breaks.
-- Purely additive: seven nullable columns on onfido_utilization_daily_input, no DROP/DELETE.

ALTER TABLE onfido_utilization_daily_input
  ADD COLUMN fixed_utilization_forecast          DECIMAL(14,2) NULL COMMENT 'Uploaded Utilization Forecast (static).',
  ADD COLUMN fixed_utilization_with_adhoc        DECIMAL(14,2) NULL COMMENT 'Uploaded Utilization with Adhoc (static).',
  ADD COLUMN fixed_utilization_without_adhoc     DECIMAL(14,2) NULL COMMENT 'Uploaded Utilization without Adhoc (static).',
  ADD COLUMN fixed_utilization_with_adhoc_pct    DECIMAL(9,4)  NULL COMMENT 'Uploaded Utilization with Adhoc % (static).',
  ADD COLUMN fixed_utilization_without_adhoc_pct DECIMAL(9,4)  NULL COMMENT 'Uploaded Utilization without Adhoc % (static).',
  ADD COLUMN fixed_poa_answering_pct             DECIMAL(9,4)  NULL COMMENT 'Uploaded POA Answering % (static).',
  ADD COLUMN fixed_escalated_pct                 DECIMAL(9,4)  NULL COMMENT 'Uploaded Escalated % (static).';
