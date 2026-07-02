# Sales Funnel Analysis - START HERE

**Complete sales funnel data extraction from `db_external.CallDetails`**

## What You're Getting

✓ 9 SQL queries for comprehensive sales funnel analysis
✓ Python automation script with formatted output
✓ TypeScript/Node.js equivalent script
✓ Complete documentation and quick reference guides
✓ Ready-to-copy queries for immediate use
✓ Full customization guide for your specific needs

## The Exact Data You Requested

All queries output in your requested format:

```
PROCESS | TOTAL_CALLS | OFFERS | SALES | CONVERSION_RATE
```

### 4 Required Analyses:

1. **Overall Sales Funnel by Process** ✓ Query 1
   - Calls → Offers → Sales breakdown
   - Conversion rate by process

2. **Sales Conversion Trend (90 days)** ✓ Query 2
   - Daily conversion tracking
   - Trend analysis

3. **Offer Acceptance Rate by Process** ✓ Query 3
   - Offers made vs. sales
   - Acceptance percentage

4. **Time from First Call to Sale** ✓ Query 4
   - Sales cycle duration
   - Days to conversion

### Bonus Analysis:

5. **Summary Statistics** ✓ Query 5
   - Overall KPIs
   - Period metrics
   - Unique processes/agents count

## Quick Start (Choose One)

### Option A: Copy One Query (30 seconds)
```bash
# Open any query from sales-funnel-queries.sql in MySQL Workbench/DBeaver
# Copy the first query (lines 8-18)
# Paste and execute
```

**Single Master Query:**
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

### Option B: Run SQL File (1 minute)
```bash
mysql -u root -p db_external < /home/shuvam/Desktop/MyHRMS1/backend/scripts/sales-funnel-queries.sql
```

### Option C: Python Script (1-2 minutes)
```bash
pip install mysql-connector-python python-dotenv
python /home/shuvam/Desktop/MyHRMS1/backend/scripts/sales-funnel-report.py
```

### Option D: TypeScript Script (1-2 minutes)
```bash
cd /home/shuvam/Desktop/MyHRMS1/backend
npx tsx scripts/sales-funnel-report.ts
```

## Expected Sample Output

### Query 1: Overall Funnel
```
+------------------+-------------+--------+-------+-------------------+
| process          | total_calls | offers | sales | conversion_rate_pct |
+------------------+-------------+--------+-------+-------------------+
| Sales Process A  |        1250 |    450 |   180 |             14.40 |
| Sales Process B  |         890 |    320 |   128 |             14.38 |
| Retention Group  |         612 |    220 |    82 |             13.40 |
+------------------+-------------+--------+-------+-------------------+
```

### Query 5: Summary Stats
```
Total Calls:              12,450
Unique Processes:         8
Unique Agents:            125
Total Offers:             4,500
Total Sales:              1,800
Overall Conversion Rate:  14.44%
Overall Offer Rate:       36.14%
```

## File Descriptions

| File | Purpose | Size |
|------|---------|------|
| **sales-funnel-queries.sql** | All 9 queries - copy any into your SQL client | 8.5 KB |
| **sales-funnel-report.py** | Python automation - runs all queries, formatted output | 8.3 KB |
| **sales-funnel-report.ts** | TypeScript version - same functionality | 8.6 KB |
| **SALES_FUNNEL_README.md** | Complete documentation - customization, performance, export | 8.6 KB |
| **SALES_FUNNEL_QUICK_START.md** | Quick reference - queries, troubleshooting, samples | 7.2 KB |
| **INDEX.md** | Package overview - query reference table, KPI glossary | 7.0 KB |
| **00_START_HERE.md** | This file |  |

## The 9 Queries Included

| # | Query | Purpose |
|---|-------|---------|
| 1 | Overall Funnel | Calls → Offers → Sales by process ✓ REQUIRED |
| 2 | Conversion Trend | Daily conversion % for 90 days ✓ REQUIRED |
| 3 | Offer Acceptance | Offer rate & acceptance rate ✓ REQUIRED |
| 4 | Call to Sale Time | Sales cycle duration tracking ✓ REQUIRED |
| 5 | Summary Stats | Overall KPIs for period ✓ BONUS |
| 6 | Top Agents | Best performers by conversion % |
| 7 | Process Comparison | All processes side-by-side |
| 8 | Weekly Trend | Week-over-week analysis |
| 9 | Funnel Leakage | Where leads drop off |

## Data Source

**Database:** `db_external`
**Table:** `CallDetails`
**Time Window:** Last 90 days (configurable)
**Key Fields:**
- `CallDate` - Used for filtering
- `ProcessName` - Process grouping
- `AgentName` - Agent performance
- `OfferMade` - Offer indicator ('Yes', '1', or NULL)
- `SaleDone` - Sale indicator ('Yes', '1', or NULL)

## KPI Quick Reference

| Metric | Formula | Benchmark |
|--------|---------|-----------|
| **Conversion Rate** | (Sales ÷ Total Calls) × 100 | 10-20% |
| **Offer Rate** | (Offers ÷ Total Calls) × 100 | 30-50% |
| **Acceptance Rate** | (Sales ÷ Offers) × 100 | 40-60% |
| **Days to Sale** | MAX(sale_date) - MIN(call_date) | 1-5 days |

## Customization

### Change Date Range
Replace `INTERVAL 90 DAY` with:
- `INTERVAL 30 DAY` - Last 30 days
- `'2025-01-01'` - Specific start date
- `'2025-01-01' AND '2025-03-31'` - Date range

### Filter by Process
Add to WHERE clause: `AND ProcessName = 'Your Process'`

### Filter by Agent
Add to WHERE clause: `AND AgentName = 'Agent123'`

## Troubleshooting

| Problem | Solution |
|---------|----------|
| **Can't connect** | Check DB_HOST, DB_PORT in .env; MySQL running? |
| **Access denied** | Verify DB_USER and DB_PASSWORD |
| **Table not found** | Check db_external exists; table is CallDetails (case-sensitive) |
| **No results** | Data exists? `SELECT COUNT(*) FROM db_external.CallDetails WHERE CallDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY);` |
| **Python: ModuleNotFoundError** | Run: `pip install mysql-connector-python python-dotenv` |

## Environment Setup

Required in `.env` or `.env.local`:
```
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
```

## Next Steps

1. **Choose Your Method:**
   - Option A: Copy single query (fastest)
   - Option B: Run SQL file (all queries)
   - Option C: Python script (automated)
   - Option D: TypeScript script (automated)

2. **Execute One Query** to validate data works

3. **Review Output** - Should see your process names and funnel data

4. **Read Documentation:**
   - `SALES_FUNNEL_QUICK_START.md` - 5 min read, quick reference
   - `SALES_FUNNEL_README.md` - 15 min read, complete guide

5. **Integrate** - Use in dashboards, reports, or monitoring

## Need Help?

| Question | Answer |
|----------|--------|
| Which query should I run first? | Query 1 (Overall Funnel) - simplest and most useful |
| What if I only want one process? | Add `AND ProcessName = 'name'` to WHERE clause |
| How do I export to CSV? | Use MySQL Workbench "Export Recordset" feature |
| Can I schedule this daily? | Yes - wrap Python/TS script in cron job |
| How do I add to a dashboard? | Export as JSON, integrate with Power BI/Tableau/Looker |

## Summary

✓ 9 queries provided covering all 4 required analyses + bonus metrics
✓ 3 execution methods (SQL, Python, TypeScript)
✓ Complete documentation for customization
✓ Production-ready code
✓ No setup required - just connect and query

**You have everything needed to extract, analyze, and track sales funnel performance.**

---

**Status:** ✓ Complete
**Date:** 2025-06-21
**Location:** `/home/shuvam/Desktop/MyHRMS1/backend/scripts/`
**Files:** 6 total (48.2 KB)
**Database:** db_external
**Time Window:** 90 days (configurable)
