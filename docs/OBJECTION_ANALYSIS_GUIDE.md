# Objection Analysis Guide

## Overview

This document describes the objection pattern analysis system for the HRMS quality dashboard. It provides intelligence on customer objections, how agents handle them, and their impact on sales conversion.

**Date Generated**: 2026-06-21

---

## Data Sources

### Primary Tables

| Table | Database | Purpose |
|-------|----------|---------|
| `db_external.CallDetails` | Shivamgiri | Call records with objection handling and sales outcomes |
| `db_external.tbl_obj` | Shivamgiri | Reference knowledge base: objection types and recommended rebuttals |
| `mas_hrms.employees` | mas_hrms | Agent/handler lookup (name mapping) |
| `mas_hrms.process_master` | mas_hrms | Process/campaign metadata |
| `mas_hrms.client_master` | mas_hrms | Client metadata |

### Key Columns from CallDetails

- `OBJECTION`: Type/category of objection raised
- `ObjectionHandling`: Whether/how the objection was handled
- `SaleDone`: Whether a sale was closed on this call
- `CustomerObjectionCategory`: Categorical reason for objection
- `campaign_id`: Process/campaign assignment
- `User`: Agent/handler employee code
- `client_id`: Client code
- `CallDate`: Call date/time

---

## Output Format

### 1. Top Objection Types and Resolution Rates

**Output Columns**:

```
OBJECTION | COUNT | RESOLUTION_RATE | SALES_AFTER | TOP_HANDLER
```

| Column | Definition |
|--------|-----------|
| `OBJECTION` | Objection type/reason (text) |
| `COUNT` | Total times this objection was raised |
| `RESOLUTION_RATE` | % of times it was successfully handled / (ObjectionHandling filled in) |
| `SALES_AFTER` | Number of sales closed after handling this objection |
| `TOP_HANDLER` | Agent code with highest success rate for this objection type |

**Data Retrieval**:
- API: `GET /api/quality-dashboard/objections/patterns?limit=50`
- SQL: See `scripts/objection-analysis.sql` (Query 1)

**Example**:
```
Price Too High | 1245 | 68.5 | 487 | AG001
Competitor Cheaper | 890 | 72.1 | 562 | AG015
Not Interested | 756 | 61.2 | 301 | AG008
```

---

### 2. Top Objection Handlers (Best Resolution %)

**Output Columns**:

```
HANDLER_CODE | HANDLER_NAME | OBJECTIONS_HANDLED | RESOLUTION_PCT | SALES_CLOSED
```

| Column | Definition |
|--------|-----------|
| `HANDLER_CODE` | Agent/employee code |
| `HANDLER_NAME` | Full name |
| `OBJECTIONS_HANDLED` | Total objections this agent handled |
| `RESOLUTION_PCT` | Sales conversion rate after objection handling by this agent |
| `SALES_CLOSED` | Number of sales closed after they handled objections |

**Data Retrieval**:
- API: `GET /api/quality-dashboard/objections/handlers?limit=50`
- SQL: See `scripts/objection-analysis.sql` (Query 2)

**Example**:
```
AG001 | Rahul Singh | 245 | 87.3 | 214
AG015 | Priya Sharma | 189 | 84.2 | 159
AG008 | Amit Kumar | 167 | 81.9 | 137
```

---

### 3. Sales Closed After Objection Handling

**Output Columns**:

```
OBJECTION | OBJECTION_RAISED_COUNT | HANDLED_COUNT | SALES_CLOSED | CONVERSION_RATE_PCT
```

| Column | Definition |
|--------|-----------|
| `OBJECTION` | Objection type |
| `OBJECTION_RAISED_COUNT` | Total times objection was raised in calls |
| `HANDLED_COUNT` | Times it was actually handled (ObjectionHandling != null) |
| `SALES_CLOSED` | Sales that closed after this objection was handled |
| `CONVERSION_RATE_PCT` | (Sales Closed / Handled Count) × 100 |

**Data Retrieval**:
- API: `GET /api/quality-dashboard/objections/sales-metrics?limit=50`
- SQL: See `scripts/objection-analysis.sql` (Query 3)

**Example**:
```
Price Too High | 1245 | 854 | 562 | 65.8
Competitor Cheaper | 890 | 642 | 487 | 75.8
Not Interested | 756 | 463 | 217 | 46.9
```

---

### 4. Objection Types by Process

**Output Columns**:

```
PROCESS_CODE | PROCESS_NAME | OBJECTION | COUNT | RESOLUTION_RATE | SALES_AFTER
```

| Column | Definition |
|--------|-----------|
| `PROCESS_CODE` | Campaign ID / process code |
| `PROCESS_NAME` | Process name (from process_master) |
| `OBJECTION` | Objection type |
| `COUNT` | Frequency in this process |
| `RESOLUTION_RATE` | Handling % for this objection in this process |
| `SALES_AFTER` | Sales closed after handling in this process |

**Data Retrieval**:
- API: `GET /api/quality-dashboard/objections/by-process?limit=100`
- SQL: See `scripts/objection-analysis.sql` (Query 4)

**Use Case**: Identify if certain processes face specific objection challenges.

**Example**:
```
PROC001 | Outbound Sales | Price Too High | 450 | 71.3 | 218
PROC001 | Outbound Sales | Not Interested | 340 | 58.2 | 98
PROC002 | Renewals | Price Too High | 320 | 65.9 | 152
PROC002 | Renewals | Competitor Cheaper | 180 | 78.3 | 142
```

---

## API Endpoints

### Base URL
```
GET /api/quality-dashboard/objections/...
```

All endpoints require authentication and one of these roles:
- `admin`, `hr`, `ceo`, `qa`, `analyst`, `manager`, `process_manager`, `branch_head`

### Endpoints

#### 1. Top Objection Patterns
```
GET /api/quality-dashboard/objections/patterns?limit=50
```

**Response**:
```json
{
  "success": true,
  "patterns": [
    {
      "OBJECTION": "Price Too High",
      "CALL_COUNT": 1245,
      "HANDLED_COUNT": 854,
      "RESOLUTION_RATE_PCT": 68.5,
      "SALES_AFTER_OBJECTION": 562,
      "SALES_CLOSE_RATE_AFTER_OBJECTION_PCT": 65.8
    }
  ]
}
```

#### 2. Top Handlers
```
GET /api/quality-dashboard/objections/handlers?limit=50
```

**Response**:
```json
{
  "success": true,
  "handlers": [
    {
      "HANDLER_CODE": "AG001",
      "HANDLER_NAME": "Rahul Singh",
      "OBJECTIONS_HANDLED": 245,
      "UNIQUE_OBJECTION_TYPES": 8,
      "SALES_CLOSE_RATE_AFTER_OBJ_PCT": 87.3,
      "SALES_CLOSED_COUNT": 214
    }
  ]
}
```

#### 3. Sales After Objection
```
GET /api/quality-dashboard/objections/sales-metrics?limit=50
```

**Response**:
```json
{
  "success": true,
  "metrics": [
    {
      "OBJECTION": "Price Too High",
      "OBJECTION_RAISED_COUNT": 1245,
      "HANDLED_COUNT": 854,
      "SALES_CLOSED_AFTER_HANDLING": 562,
      "CONVERSION_RATE_AFTER_HANDLING_PCT": 65.8
    }
  ]
}
```

#### 4. By Process
```
GET /api/quality-dashboard/objections/by-process?limit=100
```

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "PROCESS_CODE": "PROC001",
      "PROCESS_NAME": "Outbound Sales",
      "OBJECTION": "Price Too High",
      "OBJECTION_COUNT": 450,
      "HANDLED_COUNT": 321,
      "RESOLUTION_RATE_PCT": 71.3,
      "SALES_AFTER_OBJECTION": 218
    }
  ]
}
```

#### 5. Rebuttal Reference Matrix
```
GET /api/quality-dashboard/objections/rebuttals?limit=100
```

**Response**:
```json
{
  "success": true,
  "rebuttals": [
    {
      "OBJECTION": "Price Too High",
      "RECOMMENDED_REBUTTAL": "Our pricing includes premium support and includes...",
      "FREQUENCY": 1245
    }
  ]
}
```

#### 6. Health Dashboard
```
GET /api/quality-dashboard/objections/health
```

**Response**:
```json
{
  "success": true,
  "dashboard": {
    "TOTAL_OBJECTIONS_RAISED": 5892,
    "UNIQUE_OBJECTION_TYPES": 24,
    "TOTAL_OBJECTIONS_HANDLED": 3654,
    "OVERALL_RESOLUTION_RATE_PCT": 62.0,
    "SALES_CLOSED_AFTER_OBJECTION_HANDLING": 2187,
    "SALES_CONVERSION_AFTER_OBJECTION_PCT": 59.8,
    "UNIQUE_HANDLERS": 148,
    "UNIQUE_CLIENTS": 87,
    "UNIQUE_PROCESSES": 12
  }
}
```

#### 7. Comprehensive Report (All Metrics)
```
GET /api/quality-dashboard/objections/comprehensive-report?patternLimit=50&handlerLimit=50&processLimit=100&rebuttalLimit=100
```

**Response**:
```json
{
  "success": true,
  "report": {
    "dashboard": { ... },
    "topPatterns": [ ... ],
    "topHandlers": [ ... ],
    "salesMetrics": [ ... ],
    "processList": [ ... ],
    "rebuttalMatrix": [ ... ]
  }
}
```

---

## SQL Queries

All queries are located in `/scripts/objection-analysis.sql`

### Query 1: Top Objections with Resolution & Sales
```sql
SELECT
    OBJECTION,
    COUNT(*) as CALL_COUNT,
    SUM(CASE WHEN ObjectionHandling IS NOT NULL AND ObjectionHandling NOT IN ('', 'null') THEN 1 ELSE 0 END) as HANDLED_COUNT,
    -- calculates resolution rate
    -- calculates sales conversion rate
FROM db_external.CallDetails
WHERE OBJECTION IS NOT NULL AND OBJECTION != '' AND OBJECTION != 'null'
GROUP BY OBJECTION
ORDER BY CALL_COUNT DESC
LIMIT 50;
```

### Query 2: Top Handlers
```sql
SELECT
    cd.User as HANDLER_CODE,
    -- agent name lookup
    COUNT(*) as OBJECTIONS_HANDLED,
    COUNT(DISTINCT cd.OBJECTION) as UNIQUE_OBJECTION_TYPES,
    -- calculates sales conversion rate
FROM db_external.CallDetails cd
LEFT JOIN mas_hrms.employees e ON e.employee_code = cd.User
WHERE cd.OBJECTION IS NOT NULL
    AND cd.ObjectionHandling IS NOT NULL AND cd.ObjectionHandling NOT IN ('', 'null')
GROUP BY cd.User
HAVING COUNT(*) >= 5
ORDER BY SALES_CLOSE_RATE_AFTER_OBJ_PCT DESC
LIMIT 50;
```

See `scripts/objection-analysis.sql` for complete queries.

---

## Key Metrics Explained

### Resolution Rate (%)
**Formula**: (Handled Count / Total Objections Raised) × 100

Percentage of times an objection was addressed (ObjectionHandling field is not empty/null).

**Good Target**: > 70%

### Sales Conversion Rate After Objection (%)
**Formula**: (Sales Closed After Handling / Objections Handled) × 100

Percentage of objection-handling interactions that resulted in a sale.

**Good Target**: > 60%

### Handling by Agent
Shows which agents are best at converting objections to sales. High performers can be identified for:
- Coaching/mentoring others
- Complex objection assignments
- Best practice documentation

---

## Usage Examples

### Example 1: Identify Top Objection Type
```bash
curl -X GET "http://localhost:5055/api/quality-dashboard/objections/patterns?limit=5" \
  -H "Authorization: Bearer {token}"
```

Response shows that "Price Too High" is the most common objection (1,245 times), with 68.5% resolution rate and 562 sales closed.

### Example 2: Find Best Objection Handlers
```bash
curl -X GET "http://localhost:5055/api/quality-dashboard/objections/handlers?limit=10" \
  -H "Authorization: Bearer {token}"
```

Response shows Rahul Singh (AG001) closes 87.3% of objections into sales — top performer.

### Example 3: Process-Specific Analysis
```bash
curl -X GET "http://localhost:5055/api/quality-dashboard/objections/by-process?limit=100" \
  -H "Authorization: Bearer {token}"
```

Response shows that PROC001 (Outbound Sales) has high objection rates on "Price Too High" but low on "Not Interested".

### Example 4: Get Training Rebuttals
```bash
curl -X GET "http://localhost:5055/api/quality-dashboard/objections/rebuttals?limit=20" \
  -H "Authorization: Bearer {token}"
```

Response provides recommended rebuttals for each objection type — use for agent training.

---

## Integration Points

### Frontend Dashboard
The objection analysis can be embedded in:
- Quality Dashboard → Objection Intelligence tab
- Agent Performance → Objection Handling scorecard
- Process Reports → Objection breakdown by process
- Training Materials → Use rebuttal matrix for coaching

### Reporting & Export
All endpoints support JSON export for:
- Excel analysis via `jq` or Python
- BI tool integration (Power BI, Tableau)
- Custom dashboards

**Example export**:
```bash
curl -X GET "http://localhost:5055/api/quality-dashboard/objections/comprehensive-report" \
  -H "Authorization: Bearer {token}" | jq '.' > objection_report.json
```

---

## Troubleshooting

### No Data Returned
**Possible Causes**:
1. `db_external` database not available or not synced
2. `tbl_obj` or `CallDetails` tables missing
3. No calls with objection data recorded yet

**Resolution**:
- Verify database connectivity in logs
- Check if call data is being populated from upstream

### Low Resolution Rates
**Interpretation**:
- Many objections raised but few handled (ObjectionHandling empty)
- Agents may need objection-handling training
- Process may need review

**Action**:
- Check top handlers to identify best practices
- Use rebuttal matrix for training
- Assign complex objections to top performers

### Null/Missing Handler Names
**Interpretation**:
- Agent code in CallDetails doesn't match employee_code in mas_hrms.employees

**Action**:
- Verify employee_code mappings are correct
- Run sync/reconciliation if needed

---

## Performance Notes

- Queries are optimized with indexed lookups on OBJECTION, User, campaign_id
- Pagination via LIMIT recommended for large result sets
- Dashboard aggregates built incrementally (can cache at 1-hour granularity)

---

## References

- **Backend Service**: `/backend/src/modules/quality-dashboard/objection-analysis.service.ts`
- **Routes**: `/backend/src/modules/quality-dashboard/quality-dashboard.routes.ts`
- **SQL Queries**: `/scripts/objection-analysis.sql`
- **Main Quality Dashboard**: `/backend/src/modules/quality-dashboard/quality-dashboard.routes.ts`
