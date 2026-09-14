# Sales Funnel Analysis Report

Complete sales funnel data extraction from `db_external.CallDetails` with 90-day analysis window.

## Overview

This report provides comprehensive sales funnel metrics including:
1. **Overall Sales Funnel by Process** - Calls → Offers → Sales conversion
2. **Sales Conversion Trend** - 90-day daily conversion tracking
3. **Offer Acceptance Rate** - Breakdown of offer to sale conversions
4. **Time from First Call to Sale** - Sales cycle duration analysis
5. **Summary Statistics** - Aggregated KPIs for the period

## Data Structure

### Source Table: `db_external.CallDetails`

Key columns used:
- `CallDate` - Call timestamp (DATE filtering for 90-day window)
- `ProcessName` - Process/Campaign name (grouping dimension)
- `AgentName` - Agent identifier (performance analysis)
- `OfferMade` - Offer flag ('Yes', '1', or NULL/other = No)
- `SaleDone` - Sale completion flag ('Yes', '1', or NULL/other = No)

### Date Range
All queries use: `CallDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)`
- Covers last 90 calendar days from today
- Adjust the interval number in queries if needed

## Usage Methods

### Method 1: Direct MySQL Client

**Using mysql CLI:**
```bash
mysql -h <DB_HOST> -u <DB_USER> -p<DB_PASSWORD> db_external < backend/scripts/sales-funnel-queries.sql
```

**Using MySQL Workbench:**
1. Open backend/scripts/sales-funnel-queries.sql
2. Copy-paste each query block into a new MySQL tab
3. Execute each query individually (queries are separated by comments)

**Using DBeaver or similar tools:**
1. Connect to db_external database
2. Open backend/scripts/sales-funnel-queries.sql as new SQL Script
3. Execute all queries at once (multipleStatements enabled)

### Method 2: Python Script

**Requirements:**
```bash
pip install mysql-connector-python python-dotenv
```

**Run the report:**
```bash
cd /home/shuvam/Desktop/MyHRMS1
python backend/scripts/sales-funnel-report.py
```

The Python script automatically:
- Loads database credentials from `.env` or `.env.local`
- Connects to `db_external`
- Executes all 5 core queries
- Formats output as readable tables
- Handles connection errors gracefully

### Method 3: Node.js/TypeScript Script

**Using tsx (TypeScript runner):**
```bash
cd /home/shuvam/Desktop/MyHRMS1/backend
npx tsx scripts/sales-funnel-report.ts
```

OR add to backend/package.json scripts:
```json
"scripts": {
  "report:sales-funnel": "tsx scripts/sales-funnel-report.ts"
}
```

Then run:
```bash
cd backend && npm run report:sales-funnel
```

## Output Format

### Query 1: Overall Sales Funnel by Process
```
PROCESS | TOTAL_CALLS | OFFERS | SALES | CONVERSION_RATE (%)
---------|-------------|--------|-------|-------------------
Process A|      1250   |   450  |  180  |      14.40
Process B|       890   |   320  |  128  |      14.38
```

### Query 2: Conversion Trend (Daily)
```
DATE       | DAILY_CALLS | DAILY_SALES | CONVERSION_RATE (%)
-----------|-------------|-------------|--------------------
2025-06-20 |      45     |     8       |       17.78
2025-06-19 |      52     |     7       |       13.46
```

### Query 3: Offer Acceptance Rate
```
PROCESS | TOTAL_CALLS | OFFERS_MADE | ACCEPTED | OFFER_RATE (%) | ACCEPTANCE_RATE (%)
--------|-------------|-------------|----------|----------------|--------------------
Process A|      1250   |      450    |    180   |      36.00     |         40.00
Process B|       890   |      320    |    128   |      35.96     |         40.00
```

### Query 4: Call to Sale Time
```
PROCESS | AGENT | FIRST_CALL | SALE_DATE | DAYS_TO_SALE | TOTAL_CALLS | SALES
--------|-------|------------|-----------|--------------|-------------|-------
Process A| Agent1| 2025-04-20 | 2025-04-22|      2       |      5      |   1
Process A| Agent2| 2025-04-15 | 2025-05-10|     25       |     42      |   3
```

### Query 5: Summary Statistics
```
Total Calls:              12,450
Unique Processes:         8
Unique Agents:            125
Total Offers Made:        4,500
Total Sales:              1,800
Overall Conversion Rate:  14.44%
Overall Offer Rate:       36.14%
Data Period:              2025-03-22 to 2025-06-20
```

## KPI Definitions

| Metric | Formula | Interpretation |
|--------|---------|-----------------|
| **Conversion Rate** | (Sales / Total Calls) × 100 | % of calls that resulted in a sale |
| **Offer Rate** | (Offers / Total Calls) × 100 | % of calls where offer was made |
| **Acceptance Rate** | (Sales / Offers) × 100 | % of offers that were accepted |
| **Days to Sale** | MAX(sale_date) - MIN(first_call_date) | Days elapsed from first call to first sale |

## Advanced Queries (Included in SQL File)

The `sales-funnel-queries.sql` file includes additional analysis queries:

### Query 6: Top Performing Agents
- Agents ranked by conversion rate
- Filtered to agents with 10+ calls (eliminates statistical noise)
- Shows total calls, sales count, and conversion %

### Query 7: Process Performance Comparison
- Compares all processes side-by-side
- Shows agent count, call volume, and funnel metrics
- Identifies which processes are performing best

### Query 8: Weekly Sales Funnel Trend
- Groups data by ISO week
- Shows week start/end dates
- Tracks weekly conversion trend over 90 days

### Query 9: Funnel Leakage Analysis
- Identifies where leads are lost in the funnel
- Shows calls without offers (first leak point)
- Shows offers not accepted (second leak point)
- Calculates leakage % at each stage

## Customization

### Change Time Window
Replace `INTERVAL 90 DAY` with:
- `INTERVAL 30 DAY` - Last 30 days
- `INTERVAL 180 DAY` - Last 6 months
- `'2025-01-01'` - Specific start date

Example:
```sql
WHERE CallDate >= '2025-01-01' AND CallDate <= '2025-03-31'
```

### Filter by Process
Add WHERE clause:
```sql
WHERE CallDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
  AND ProcessName = 'Sales Campaign'
```

### Filter by Agent
Add WHERE clause:
```sql
WHERE CallDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
  AND AgentName = 'Agent123'
```

## Data Quality Notes

1. **Null Handling**: Queries treat NULL, empty string, and unmapped values as 'Unknown' or 0
2. **Date Precision**: CallDate is typically DATE type; time components are aggregated
3. **Flag Values**: Both 'Yes' and '1' are treated as true for OfferMade and SaleDone
4. **Division by Zero**: All division operations use NULLIF to prevent errors when denominators are 0

## Troubleshooting

### Connection Error
```
ERROR 2003: Can't connect to MySQL server
```
- Verify DB_HOST, DB_PORT, DB_USER, DB_PASSWORD in `.env`
- Ensure MySQL service is running
- Check firewall/network connectivity to database host

### Access Denied
```
ERROR 1045: Access denied for user 'root'@'localhost'
```
- Verify DB_USER and DB_PASSWORD are correct
- Ensure the user has SELECT permission on db_external.CallDetails

### Table Not Found
```
ERROR 1146: Table 'db_external.CallDetails' doesn't exist
```
- Verify the table name (case-sensitive)
- Check database name is 'db_external'
- Confirm CallDetails table exists: `SHOW TABLES IN db_external;`

### No Results
- Verify data exists in the 90-day window: `SELECT COUNT(*) FROM db_external.CallDetails WHERE CallDate >= DATE_SUB(CURDATE(), INTERVAL 90 DAY);`
- Check if CallDate values are in expected format
- Verify OfferMade and SaleDone columns contain 'Yes'/'1' values

## Exporting Results

### Export to CSV (MySQL CLI)
```bash
mysql -h <host> -u <user> -p<pass> db_external -e "SELECT * FROM ... \G" > report.csv
```

### Export from Python Script
Modify `sales-funnel-report.py` to output JSON:
```python
json.dump(results, open('sales_funnel_report.json', 'w'))
```

### Export from Workbench
- Execute query
- Right-click result grid → Export Recordset
- Choose CSV or Excel format

## Performance Optimization

For very large datasets (>1M rows), consider:

1. **Add Index** (if not exists):
   ```sql
   CREATE INDEX idx_calldate ON CallDetails(CallDate);
   CREATE INDEX idx_process ON CallDetails(ProcessName);
   ```

2. **Pre-aggregate Data**: Create a materialized view for 90-day window

3. **Reduce Date Range**: Query more specific periods instead of full 90 days

4. **Parallel Execution**: Run separate queries in parallel for different processes

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-06-21 | Initial release with 9 core queries |

## Support

For issues or questions:
1. Check Troubleshooting section above
2. Verify data exists in db_external.CallDetails
3. Review CLAUDE.md for general project guidelines
4. Check database connectivity and permissions

---

**Generated:** 2025-06-21
**Database:** db_external.CallDetails
**Data Window:** Last 90 days
**Query Type:** OLAP/Analytics
