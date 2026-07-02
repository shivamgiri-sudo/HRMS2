# Sales Funnel - Quick Start Guide

## TL;DR - Run This Now

### Fastest Way: Direct MySQL Query

```bash
# If you have MySQL CLI installed:
mysql -h localhost -u root -p db_external < backend/scripts/sales-funnel-queries.sql

# Or copy this single query and run in MySQL Workbench/DBeaver:
```

## Single Master Query (All Data)

Run this one query to get ALL funnel data at once:

```sql
-- QUERY: Complete Sales Funnel Dashboard
SELECT 'FUNNEL' as metric, ProcessName as dimension, 
  COUNT(*) as total_calls,
  COUNT(CASE WHEN OfferMade IN ('Yes','1') THEN 1 END) as offers,
  COUNT(CASE WHEN SaleDone IN ('Yes','1') THEN 1 END) as sales,
  ROUND(100*COUNT(CASE WHEN SaleDone IN ('Yes','1') THEN 1 END)/NULLIF(COUNT(*),0),2) as conversion_rate_pct
FROM db_external.CallDetails
WHERE CallDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
GROUP BY ProcessName
ORDER BY total_calls DESC;
```

## Expected Output Format

### Requested Format:
```
PROCESS | TOTAL_CALLS | OFFERS | SALES | CONVERSION_RATE
---------|-------------|--------|-------|----------------
```

### Actual Output:
```
metric | dimension  | total_calls | offers | sales | conversion_rate_pct
--------|-----------|-------------|--------|-------|--------------------
FUNNEL | Process A  |      1250   |   450  |  180  |      14.40
FUNNEL | Process B  |       890   |   320  |  128  |      14.38
FUNNEL | Process C  |       612   |   220  |   82  |      13.40
```

## All 5 Core Reports

### 1. Overall Funnel by Process
```sql
SELECT
  ProcessName as process,
  COUNT(*) as total_calls,
  COUNT(CASE WHEN OfferMade IN ('Yes','1') THEN 1 END) as offers,
  COUNT(CASE WHEN SaleDone IN ('Yes','1') THEN 1 END) as sales,
  ROUND(100*COUNT(CASE WHEN SaleDone IN ('Yes','1') THEN 1 END)/NULLIF(COUNT(*),0),2) as conversion_rate_pct
FROM db_external.CallDetails
WHERE CallDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
GROUP BY ProcessName
ORDER BY total_calls DESC;
```

### 2. 90-Day Conversion Trend
```sql
SELECT
  DATE(CallDate) as date,
  COUNT(*) as daily_calls,
  COUNT(CASE WHEN SaleDone IN ('Yes','1') THEN 1 END) as daily_sales,
  ROUND(100*COUNT(CASE WHEN SaleDone IN ('Yes','1') THEN 1 END)/NULLIF(COUNT(*),0),2) as daily_conversion_rate
FROM db_external.CallDetails
WHERE CallDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
GROUP BY DATE(CallDate)
ORDER BY date DESC;
```

### 3. Offer Acceptance Rate by Process
```sql
SELECT
  ProcessName as process,
  COUNT(*) as total_calls,
  COUNT(CASE WHEN OfferMade IN ('Yes','1') THEN 1 END) as offers_made,
  COUNT(CASE WHEN SaleDone IN ('Yes','1') THEN 1 END) as offers_accepted,
  ROUND(100*COUNT(CASE WHEN OfferMade IN ('Yes','1') THEN 1 END)/NULLIF(COUNT(*),0),2) as offer_rate_pct,
  ROUND(100*COUNT(CASE WHEN SaleDone IN ('Yes','1') THEN 1 END)/NULLIF(COUNT(CASE WHEN OfferMade IN ('Yes','1') THEN 1 END),0),2) as acceptance_rate_pct
FROM db_external.CallDetails
WHERE CallDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
GROUP BY ProcessName
ORDER BY offers_made DESC;
```

### 4. Time from First Call to Sale
```sql
SELECT
  ProcessName as process,
  AgentName as agent,
  MIN(CallDate) as first_call_date,
  MAX(CASE WHEN SaleDone IN ('Yes','1') THEN CallDate END) as sale_date,
  DATEDIFF(MAX(CASE WHEN SaleDone IN ('Yes','1') THEN CallDate END), MIN(CallDate)) as days_to_sale,
  COUNT(*) as total_calls,
  COUNT(CASE WHEN SaleDone IN ('Yes','1') THEN 1 END) as sales
FROM db_external.CallDetails
WHERE CallDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY) AND SaleDone IN ('Yes','1')
GROUP BY ProcessName, AgentName
ORDER BY days_to_sale ASC, sales DESC;
```

### 5. Summary Statistics
```sql
SELECT
  COUNT(*) as total_calls,
  COUNT(DISTINCT ProcessName) as unique_processes,
  COUNT(DISTINCT AgentName) as unique_agents,
  COUNT(CASE WHEN OfferMade IN ('Yes','1') THEN 1 END) as total_offers,
  COUNT(CASE WHEN SaleDone IN ('Yes','1') THEN 1 END) as total_sales,
  ROUND(100*COUNT(CASE WHEN SaleDone IN ('Yes','1') THEN 1 END)/NULLIF(COUNT(*),0),2) as overall_conversion_rate_pct,
  ROUND(100*COUNT(CASE WHEN OfferMade IN ('Yes','1') THEN 1 END)/NULLIF(COUNT(*),0),2) as overall_offer_rate_pct,
  MIN(CallDate) as period_start,
  MAX(CallDate) as period_end
FROM db_external.CallDetails
WHERE CallDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY);
```

## Files Provided

| File | Purpose |
|------|---------|
| `sales-funnel-queries.sql` | All 9 SQL queries (comprehensive) |
| `sales-funnel-report.py` | Python script to generate formatted report |
| `sales-funnel-report.ts` | TypeScript/Node.js version |
| `SALES_FUNNEL_README.md` | Complete documentation |
| `SALES_FUNNEL_QUICK_START.md` | This file |

## Quick Execution Methods

### Method 1: SQL File (30 seconds)
```bash
# Copy entire file to your MySQL client
cat backend/scripts/sales-funnel-queries.sql | mysql -u root -p db_external
```

### Method 2: Python Script (60 seconds)
```bash
pip install mysql-connector-python python-dotenv
python backend/scripts/sales-funnel-report.py
```

### Method 3: DBeaver/MySQL Workbench (2 minutes)
1. Open `backend/scripts/sales-funnel-queries.sql`
2. Copy query 1 (lines 8-18)
3. Paste in new SQL tab
4. Click Execute

## Key Metrics Explained

| Metric | What It Means | Good Value |
|--------|--------------|-----------|
| **Conversion Rate** | % of calls that became sales | 10-20% |
| **Offer Rate** | % of calls where offer was made | 30-50% |
| **Acceptance Rate** | % of offers that were accepted | 40-60% |
| **Days to Sale** | Average days from first call to sale | 1-5 days |

## Where Are the Data Files?

All generated reports will be in:
```
/home/shuvam/Desktop/MyHRMS1/backend/scripts/
```

## Troubleshooting

**Q: "Can't connect to MySQL"**
A: Check DB credentials in `.env` or pass them manually:
```bash
mysql -h 192.168.x.x -u username -p database_name
```

**Q: "Table doesn't exist"**
A: Verify table exists:
```sql
SHOW TABLES IN db_external LIKE 'CallDetails%';
```

**Q: "No results"**
A: Check if data exists in last 90 days:
```sql
SELECT COUNT(*) FROM db_external.CallDetails 
WHERE CallDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY);
```

**Q: Python ModuleNotFoundError**
A: Install dependencies:
```bash
pip install mysql-connector-python python-dotenv
```

## Sample Output (Expected)

After running Query 1, you should see something like:

```
+-----+-----+-----+-----+-----+
| process   | total_calls | offers | sales | conversion_rate_pct |
+-----------|-------------|--------|-------|---------------------|
| Sales-001 | 1250        | 450    | 180   | 14.40               |
| Sales-002 | 890         | 320    | 128   | 14.38               |
| OutboundX | 612         | 220    | 82    | 13.40               |
+-----------|-------------|--------|-------|---------------------|
```

## Next Steps

1. Run Query 1 above (Overall Funnel) - should take <1 second
2. Review results for sanity (numbers look reasonable?)
3. Run other queries if needed (Trend, Acceptance Rate, Duration, Stats)
4. Use Python/TypeScript scripts for automated reports

## Need More Details?

See `SALES_FUNNEL_README.md` for:
- Complete query explanations
- Data quality notes
- Performance optimization
- Export procedures
- Customization options

---

**Quick Reference:** 90-day funnel data from `db_external.CallDetails`
**Last Updated:** 2025-06-21
