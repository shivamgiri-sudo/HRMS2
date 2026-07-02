# Sales Funnel Analysis - Complete Package

## Overview
Complete sales funnel analysis toolkit for querying `db_external.CallDetails` and generating comprehensive sales performance reports.

## Deliverables

### 1. SQL Queries (`sales-funnel-queries.sql`)
- **9 complete SQL queries** for sales funnel analysis
- 90-day analysis window by default
- Can be customized for different date ranges
- Queries included:
  1. Overall Sales Funnel by Process
  2. Sales Conversion Trend (90 days daily)
  3. Offer Acceptance Rate by Process
  4. Time from First Call to Sale
  5. Summary Statistics
  6. Top Performing Agents
  7. Process Performance Comparison
  8. Weekly Sales Funnel Trend
  9. Funnel Leakage Analysis

**Usage:**
```bash
mysql -u root -ppassword db_external < sales-funnel-queries.sql
```

### 2. Python Report Script (`sales-funnel-report.py`)
- Automated report generation
- Formatted table output
- Auto-loads environment credentials from `.env`
- Error handling for connection issues
- Executes all 5 core queries

**Requirements:**
```bash
pip install mysql-connector-python python-dotenv
```

**Usage:**
```bash
python backend/scripts/sales-funnel-report.py
```

### 3. TypeScript/Node.js Script (`sales-funnel-report.ts`)
- Same functionality as Python script
- Uses `mysql2/promise` for async operations
- Formatted console output

**Usage:**
```bash
cd backend
npx tsx scripts/sales-funnel-report.ts
```

### 4. Documentation

#### `SALES_FUNNEL_QUICK_START.md`
- Quick reference guide
- Copy-paste ready queries
- Troubleshooting tips
- Expected output samples
- 5-minute setup

#### `SALES_FUNNEL_README.md`
- Complete documentation
- Data structure explanation
- Output format specifications
- Customization guide
- Performance optimization tips
- Export procedures

#### `INDEX.md` (this file)
- Package overview
- File descriptions
- Quick navigation

## Query Output Format

All queries follow the requested format:
```
PROCESS | TOTAL_CALLS | OFFERS | SALES | CONVERSION_RATE
```

Example:
```
Process A | 1250 | 450 | 180 | 14.40%
Process B | 890 | 320 | 128 | 14.38%
```

## Data Specifications

| Specification | Value |
|---|---|
| **Database** | db_external |
| **Table** | CallDetails |
| **Default Period** | Last 90 days |
| **Key Fields** | ProcessName, AgentName, CallDate, OfferMade, SaleDone |
| **Date Range SQL** | `CallDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)` |

## Files Location
```
/home/shuvam/Desktop/MyHRMS1/backend/scripts/
├── sales-funnel-queries.sql          (SQL queries)
├── sales-funnel-report.py            (Python automation)
├── sales-funnel-report.ts            (TypeScript automation)
├── SALES_FUNNEL_README.md            (Full documentation)
├── SALES_FUNNEL_QUICK_START.md       (Quick reference)
└── INDEX.md                          (This file)
```

## Quick Start

### 1. Simplest: Copy a Query
```sql
-- Paste this into MySQL Workbench and run:
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

### 2. Medium: Run SQL File
```bash
mysql -u root -p db_external < backend/scripts/sales-funnel-queries.sql
```

### 3. Advanced: Automated Report
```bash
python backend/scripts/sales-funnel-report.py
```

## Query Reference

| # | Query Name | Purpose | Output Columns |
|---|---|---|---|
| 1 | Overall Funnel | Funnel by process | Process, Total Calls, Offers, Sales, Conversion % |
| 2 | Conversion Trend | Daily trend analysis | Date, Daily Calls, Sales, Conversion % |
| 3 | Offer Acceptance | Offer-to-sale conversion | Process, Calls, Offers, Accepted, Offer %, Acceptance % |
| 4 | Call to Sale Time | Sales cycle duration | Process, Agent, First Call, Sale Date, Days, Calls, Sales |
| 5 | Summary Stats | Overall metrics | Total Calls, Processes, Agents, Offers, Sales, Rates |
| 6 | Top Agents | Best performers | Agent, Calls, Sales, Conversion % |
| 7 | Process Comparison | All processes side-by-side | Process, Agents, Calls, Offers, Sales, Rates |
| 8 | Weekly Trend | Week-over-week metrics | Week, Start, End, Calls, Offers, Sales, Conversion % |
| 9 | Funnel Leakage | Where leads drop off | Process, Calls, Offers, No Offer, Rejected, Leakage % |

## KPI Glossary

- **Conversion Rate**: (Sales ÷ Total Calls) × 100
  - What % of all calls result in a sale
  - Benchmark: 10-20%

- **Offer Rate**: (Offers ÷ Total Calls) × 100
  - What % of calls get an offer
  - Benchmark: 30-50%

- **Acceptance Rate**: (Sales ÷ Offers) × 100
  - What % of offers are accepted
  - Benchmark: 40-60%

- **Days to Sale**: MAX(sale_date) - MIN(call_date)
  - Average days from first call to sale
  - Benchmark: 1-5 days

## Configuration

### Environment Variables
Required in `.env` or `.env.local`:
```
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
```

### Customize Date Range
In any query, modify this line:
```sql
-- Change from:
WHERE CallDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)

-- To any of these:
WHERE CallDate >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)   -- Last 30 days
WHERE CallDate >= '2025-01-01'                            -- Specific start
WHERE CallDate BETWEEN '2025-01-01' AND '2025-03-31'      -- Date range
```

### Filter by Process
```sql
WHERE CallDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
  AND ProcessName = 'Your Process Name'
```

### Filter by Agent
```sql
WHERE CallDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
  AND AgentName = 'Agent123'
```

## Troubleshooting

| Issue | Solution |
|---|---|
| Connection refused | Verify DB_HOST, DB_PORT, check MySQL running |
| Access denied | Check DB_USER and DB_PASSWORD credentials |
| Table not found | Verify db_external database exists and has CallDetails table |
| No results | Check if data exists in CallDetails for last 90 days |
| Permission denied on file | Make scripts executable: `chmod +x *.py *.ts` |

## Performance Notes

- Queries are optimized for 90-day windows
- Index on `CallDate` highly recommended
- For larger datasets (>10M rows), consider:
  - Reducing date range
  - Adding indexes on ProcessName, AgentName
  - Pre-aggregating to materialized view

## Next Steps

1. ✓ Choose your preferred method (SQL, Python, or TypeScript)
2. ✓ Set up database credentials in `.env`
3. ✓ Run your first query (start with Query 1)
4. ✓ Review results for accuracy
5. ✓ Integrate into dashboards/reports as needed

## Support Resources

- `SALES_FUNNEL_QUICK_START.md` - Fast reference (5 min read)
- `SALES_FUNNEL_README.md` - Complete guide (15 min read)
- SQL queries themselves - Inline comments explain logic
- Python/TS scripts - Well-commented code

---

**Package Version:** 1.0
**Created:** 2025-06-21
**Database:** db_external
**Data Source:** CallDetails table
**Time Window:** 90 days (configurable)
**Status:** Production-ready
