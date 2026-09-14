-- ============================================================================
-- SALES FUNNEL ANALYSIS QUERIES
-- Database: db_external
-- Table: CallDetails
-- Purpose: Complete sales funnel data for 90-day period
-- ============================================================================

-- ===========================================================================
-- QUERY 1: Overall Sales Funnel by Process
-- Output: PROCESS | TOTAL_CALLS | OFFERS | SALES | CONVERSION_RATE (%)
-- ===========================================================================
SELECT
  'OVERALL_FUNNEL' as report_type,
  COALESCE(ProcessName, 'Unknown') as process,
  COUNT(*) as total_calls,
  COUNT(CASE WHEN OfferMade = 'Yes' OR OfferMade = '1' THEN 1 END) as offers,
  COUNT(CASE WHEN SaleDone = 'Yes' OR SaleDone = '1' THEN 1 END) as sales,
  ROUND(100 * COUNT(CASE WHEN SaleDone = 'Yes' OR SaleDone = '1' THEN 1 END) / NULLIF(COUNT(*), 0), 2) as conversion_rate_pct
FROM db_external.CallDetails
WHERE CallDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
GROUP BY ProcessName
ORDER BY total_calls DESC;

-- ===========================================================================
-- QUERY 2: Sales Conversion Trend Over 90 Days (Daily Breakdown)
-- Output: DATE | DAILY_CALLS | DAILY_SALES | CONVERSION_RATE (%)
-- ===========================================================================
SELECT
  'CONVERSION_TREND' as report_type,
  DATE(CallDate) as date,
  COUNT(*) as daily_calls,
  COUNT(CASE WHEN SaleDone = 'Yes' OR SaleDone = '1' THEN 1 END) as daily_sales,
  ROUND(100 * COUNT(CASE WHEN SaleDone = 'Yes' OR SaleDone = '1' THEN 1 END) / NULLIF(COUNT(*), 0), 2) as daily_conversion_rate
FROM db_external.CallDetails
WHERE CallDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
GROUP BY DATE(CallDate)
ORDER BY date DESC;

-- ===========================================================================
-- QUERY 3: Offer Acceptance Rate by Process
-- Output: PROCESS | TOTAL_CALLS | OFFERS | ACCEPTED | OFFER_RATE (%) | ACCEPTANCE_RATE (%)
-- ===========================================================================
SELECT
  'OFFER_ACCEPTANCE' as report_type,
  COALESCE(ProcessName, 'Unknown') as process,
  COUNT(*) as total_calls,
  COUNT(CASE WHEN OfferMade = 'Yes' OR OfferMade = '1' THEN 1 END) as offers_made,
  COUNT(CASE WHEN SaleDone = 'Yes' OR SaleDone = '1' THEN 1 END) as offers_accepted,
  ROUND(100 * COUNT(CASE WHEN OfferMade = 'Yes' OR OfferMade = '1' THEN 1 END) / NULLIF(COUNT(*), 0), 2) as offer_rate,
  ROUND(100 * COUNT(CASE WHEN SaleDone = 'Yes' OR SaleDone = '1' THEN 1 END) / NULLIF(COUNT(CASE WHEN OfferMade = 'Yes' OR OfferMade = '1' THEN 1 END), 0), 2) as acceptance_rate
FROM db_external.CallDetails
WHERE CallDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
GROUP BY ProcessName
ORDER BY offers_made DESC;

-- ===========================================================================
-- QUERY 4: Time from First Call to Sale (Call Funnel Duration)
-- Output: PROCESS | AGENT | FIRST_CALL_DATE | SALE_DATE | DAYS_TO_SALE | TOTAL_CALLS | SALES_COUNT
-- ===========================================================================
SELECT
  'CALL_TO_SALE_TIME' as report_type,
  COALESCE(ProcessName, 'Unknown') as process,
  COALESCE(AgentName, 'Unknown') as agent,
  MIN(CallDate) as first_call_date,
  MAX(CASE WHEN SaleDone = 'Yes' OR SaleDone = '1' THEN CallDate END) as sale_date,
  DATEDIFF(MAX(CASE WHEN SaleDone = 'Yes' OR SaleDone = '1' THEN CallDate END), MIN(CallDate)) as days_to_sale,
  COUNT(*) as total_calls_before_sale,
  COUNT(CASE WHEN SaleDone = 'Yes' OR SaleDone = '1' THEN 1 END) as sales_count
FROM db_external.CallDetails
WHERE CallDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
  AND (SaleDone = 'Yes' OR SaleDone = '1')
GROUP BY ProcessName, AgentName
HAVING sale_date IS NOT NULL
ORDER BY days_to_sale ASC, sales_count DESC;

-- ===========================================================================
-- QUERY 5: Summary Statistics (Overall 90-Day Period)
-- ===========================================================================
SELECT
  'SUMMARY_STATS' as report_type,
  COUNT(*) as total_calls,
  COUNT(DISTINCT COALESCE(ProcessName, 'Unknown')) as unique_processes,
  COUNT(DISTINCT COALESCE(AgentName, 'Unknown')) as unique_agents,
  COUNT(CASE WHEN OfferMade = 'Yes' OR OfferMade = '1' THEN 1 END) as total_offers,
  COUNT(CASE WHEN SaleDone = 'Yes' OR SaleDone = '1' THEN 1 END) as total_sales,
  ROUND(100 * COUNT(CASE WHEN SaleDone = 'Yes' OR SaleDone = '1' THEN 1 END) / NULLIF(COUNT(*), 0), 2) as overall_conversion_rate,
  ROUND(100 * COUNT(CASE WHEN OfferMade = 'Yes' OR OfferMade = '1' THEN 1 END) / NULLIF(COUNT(*), 0), 2) as overall_offer_rate,
  MIN(CallDate) as data_start_date,
  MAX(CallDate) as data_end_date
FROM db_external.CallDetails
WHERE CallDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY);

-- ===========================================================================
-- ADDITIONAL: Top Performing Agents (Sales Conversion)
-- ===========================================================================
SELECT
  'TOP_AGENTS' as report_type,
  COALESCE(ProcessName, 'Unknown') as process,
  COALESCE(AgentName, 'Unknown') as agent,
  COUNT(*) as total_calls,
  COUNT(CASE WHEN SaleDone = 'Yes' OR SaleDone = '1' THEN 1 END) as sales,
  ROUND(100 * COUNT(CASE WHEN SaleDone = 'Yes' OR SaleDone = '1' THEN 1 END) / NULLIF(COUNT(*), 0), 2) as conversion_rate
FROM db_external.CallDetails
WHERE CallDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
  AND COALESCE(AgentName, '') != ''
GROUP BY ProcessName, AgentName
HAVING total_calls >= 10
ORDER BY conversion_rate DESC, total_calls DESC
LIMIT 25;

-- ===========================================================================
-- ADDITIONAL: Process Performance Comparison
-- ===========================================================================
SELECT
  'PROCESS_COMPARISON' as report_type,
  COALESCE(ProcessName, 'Unknown') as process,
  COUNT(DISTINCT AgentName) as total_agents,
  COUNT(*) as total_calls,
  COUNT(CASE WHEN OfferMade = 'Yes' OR OfferMade = '1' THEN 1 END) as offers_made,
  COUNT(CASE WHEN SaleDone = 'Yes' OR SaleDone = '1' THEN 1 END) as sales,
  ROUND(100 * COUNT(CASE WHEN OfferMade = 'Yes' OR OfferMade = '1' THEN 1 END) / NULLIF(COUNT(*), 0), 2) as offer_rate,
  ROUND(100 * COUNT(CASE WHEN SaleDone = 'Yes' OR SaleDone = '1' THEN 1 END) / NULLIF(COUNT(*), 0), 2) as conversion_rate,
  ROUND(AVG(CASE WHEN SaleDone = 'Yes' OR SaleDone = '1' THEN 1 ELSE 0 END) * 100, 2) as avg_sales_per_call_pct
FROM db_external.CallDetails
WHERE CallDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
GROUP BY ProcessName
ORDER BY sales DESC;

-- ===========================================================================
-- ADDITIONAL: Weekly Sales Funnel Trend
-- ===========================================================================
SELECT
  'WEEKLY_TREND' as report_type,
  YEARWEEK(CallDate) as week,
  MIN(DATE(CallDate)) as week_start,
  MAX(DATE(CallDate)) as week_end,
  COUNT(*) as weekly_calls,
  COUNT(CASE WHEN OfferMade = 'Yes' OR OfferMade = '1' THEN 1 END) as weekly_offers,
  COUNT(CASE WHEN SaleDone = 'Yes' OR SaleDone = '1' THEN 1 END) as weekly_sales,
  ROUND(100 * COUNT(CASE WHEN SaleDone = 'Yes' OR SaleDone = '1' THEN 1 END) / NULLIF(COUNT(*), 0), 2) as weekly_conversion_rate
FROM db_external.CallDetails
WHERE CallDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
GROUP BY YEARWEEK(CallDate)
ORDER BY week DESC;

-- ===========================================================================
-- ADDITIONAL: Funnel Leakage Analysis (Where Leads Are Lost)
-- ===========================================================================
SELECT
  'FUNNEL_LEAKAGE' as report_type,
  COALESCE(ProcessName, 'Unknown') as process,
  COUNT(*) as total_calls,
  COUNT(CASE WHEN OfferMade = 'Yes' OR OfferMade = '1' THEN 1 END) as offers_made,
  COUNT(*) - COUNT(CASE WHEN OfferMade = 'Yes' OR OfferMade = '1' THEN 1 END) as no_offer,
  COUNT(CASE WHEN OfferMade = 'Yes' OR OfferMade = '1' THEN 1 END) - COUNT(CASE WHEN SaleDone = 'Yes' OR SaleDone = '1' THEN 1 END) as offers_not_accepted,
  ROUND(100 * (COUNT(*) - COUNT(CASE WHEN OfferMade = 'Yes' OR OfferMade = '1' THEN 1 END)) / NULLIF(COUNT(*), 0), 2) as leakage_no_offer_pct,
  ROUND(100 * (COUNT(CASE WHEN OfferMade = 'Yes' OR OfferMade = '1' THEN 1 END) - COUNT(CASE WHEN SaleDone = 'Yes' OR SaleDone = '1' THEN 1 END)) / NULLIF(COUNT(CASE WHEN OfferMade = 'Yes' OR OfferMade = '1' THEN 1 END), 0), 2) as leakage_rejection_pct
FROM db_external.CallDetails
WHERE CallDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
GROUP BY ProcessName
ORDER BY leakage_no_offer_pct DESC;
