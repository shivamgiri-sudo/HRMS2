# Objection Analysis - Output Format & Sample Data

**Generated**: 2026-06-21  
**System**: HRMS Quality Dashboard - Call Analysis  
**Query Target**: `db_external.CallDetails` + `db_external.tbl_obj` + `mas_hrms` lookups

---

## Output Format Summary

The objection analysis exports 4 primary result sets and 2 reference tables, all normalized to a consistent format:

```
OBJECTION | COUNT | RESOLUTION_RATE | SALES_AFTER | TOP_HANDLER
```

---

## Result Set 1: Top Objection Types and Resolution Rates

**Query**: `GET /api/quality-dashboard/objections/patterns`

**Fields**:
| Field | Type | Description |
|-------|------|-------------|
| `OBJECTION` | VARCHAR | Customer objection category/reason |
| `COUNT` | INT | Total times raised (from CALL_COUNT) |
| `RESOLUTION_RATE` | DECIMAL(5,2) | % handled: (HANDLED_COUNT/COUNT)*100 |
| `SALES_AFTER` | INT | Sales closed after handling this objection |
| `TOP_HANDLER` | VARCHAR | Agent code with highest sales-close rate for this objection |

**Sample Output**:

```
OBJECTION                          | COUNT | RESOLUTION_RATE | SALES_AFTER | TOP_HANDLER
===========================================================================================
Price Too High                     | 1245  | 68.5            | 562         | AG001
Competitor Cheaper                | 890   | 72.1            | 487         | AG015
Not Interested / Busy              | 756   | 61.2            | 301         | AG008
Already Using Competitor           | 634   | 65.8            | 289         | AG023
Company Policy                     | 512   | 58.9            | 178         | AG005
Need Manager Approval              | 478   | 71.3            | 267         | AG001
Budget Constraints                 | 401   | 63.4            | 198         | AG015
Poor Previous Experience           | 389   | 55.2            | 142         | AG012
Timing Not Right                   | 345   | 66.7            | 178         | AG018
Technical Concerns                 | 287   | 74.2            | 156         | AG002
```

---

## Result Set 2: Top Objection Handlers (Best Resolution %)

**Query**: `GET /api/quality-dashboard/objections/handlers`

**Fields**:
| Field | Type | Description |
|-------|------|-------------|
| `HANDLER_CODE` | VARCHAR | Employee code / agent ID |
| `HANDLER_NAME` | VARCHAR | Agent full name |
| `OBJECTIONS_HANDLED` | INT | Total objections handled by this agent |
| `UNIQUE_OBJECTION_TYPES` | INT | Variety: distinct objection types handled |
| `RESOLUTION_PCT` | DECIMAL(5,2) | % of their objections that became sales |
| `TOP_HANDLER` | VARCHAR | This agent's sales-close rate ranking |

**Sample Output**:

```
HANDLER_CODE | HANDLER_NAME      | OBJECTIONS_HANDLED | UNIQUE_TYPES | RESOLUTION_PCT | SALES_CLOSED
=======================================================================================================
AG001        | Rahul Singh       | 245                | 14           | 87.3           | 214
AG015        | Priya Sharma      | 189                | 12           | 84.2           | 159
AG008        | Amit Kumar        | 167                | 10           | 81.9           | 137
AG023        | Neha Patel        | 156                | 11           | 79.5           | 124
AG005        | Vikram Desai      | 143                | 9            | 76.8           | 110
AG002        | Deepak Nair       | 132                | 13           | 75.0           | 99
AG018        | Anjali Gupta      | 128                | 8            | 72.7           | 93
AG012        | Sanjay Reddy      | 115                | 9            | 68.3           | 79
AG034        | Meera Iyer        | 103                | 7            | 65.0           | 67
AG045        | Rohan Verma       | 98                 | 10           | 62.2           | 61
```

**Insights**:
- Rahul Singh (AG001) is the top performer: 87.3% conversion rate after objection handling
- Top handlers handle 8-14 different objection types (versatile problem-solvers)
- Minimum 5 objections required to appear in this list (ensures statistical validity)

---

## Result Set 3: Sales Closed After Objection Handling

**Query**: `GET /api/quality-dashboard/objections/sales-metrics`

**Fields**:
| Field | Type | Description |
|-------|------|-------------|
| `OBJECTION` | VARCHAR | Objection type |
| `OBJECTION_RAISED_COUNT` | INT | Total times raised in all calls |
| `HANDLED_COUNT` | INT | Times agent actually engaged with objection |
| `SALES_AFTER` | INT | Sales that resulted after handling |
| `CONVERSION_RATE_PCT` | DECIMAL(5,2) | (SALES_AFTER/HANDLED_COUNT)*100 |

**Sample Output**:

```
OBJECTION                      | RAISED_COUNT | HANDLED_COUNT | SALES_AFTER | CONVERSION_RATE_PCT
==================================================================================================
Price Too High                 | 1245         | 854           | 562         | 65.8
Competitor Cheaper             | 890          | 642           | 487         | 75.8
Not Interested / Busy          | 756          | 463           | 217         | 46.9
Already Using Competitor       | 634          | 417           | 289         | 69.3
Company Policy                 | 512          | 301           | 178         | 59.1
Need Manager Approval          | 478          | 341           | 267         | 78.3
Budget Constraints             | 401          | 254           | 198         | 77.9
Poor Previous Experience       | 389          | 214           | 142         | 66.4
Timing Not Right               | 345          | 230           | 178         | 77.4
Technical Concerns             | 287          | 213           | 156         | 73.2
```

**Key Metrics**:
- "Price Too High": Most common (1,245) but moderate conversion (65.8%)
- "Competitor Cheaper": 75.8% conversion = high-value objection if handled well
- "Not Interested": Lowest conversion (46.9%) = needs better handling/training
- "Need Manager Approval": 78.3% conversion = highly resolvable if escalated properly

---

## Result Set 4: Objection Types by Process

**Query**: `GET /api/quality-dashboard/objections/by-process`

**Fields**:
| Field | Type | Description |
|-------|------|-------------|
| `PROCESS_CODE` | VARCHAR | Campaign ID / process identifier |
| `PROCESS_NAME` | VARCHAR | Process name |
| `OBJECTION` | VARCHAR | Objection type |
| `OBJECTION_COUNT` | INT | Frequency in this process |
| `HANDLED_COUNT` | INT | Times handled in this process |
| `RESOLUTION_RATE_PCT` | DECIMAL(5,2) | (HANDLED/COUNT)*100 |
| `SALES_AFTER_OBJECTION` | INT | Sales from this objection in this process |

**Sample Output**:

```
PROCESS_CODE | PROCESS_NAME      | OBJECTION                  | COUNT | HANDLED | RES_RATE_% | SALES_AFTER
=========================================================================================================
PROC001      | Outbound Sales    | Price Too High             | 450   | 321     | 71.3       | 218
PROC001      | Outbound Sales    | Not Interested             | 340   | 189     | 55.6       | 98
PROC001      | Outbound Sales    | Competitor Cheaper         | 280   | 201     | 71.8       | 154
PROC002      | Renewals          | Price Too High             | 320   | 212     | 66.3       | 152
PROC002      | Renewals          | Competitor Cheaper         | 310   | 241     | 77.7       | 187
PROC002      | Renewals          | Already Using Competitor   | 280   | 198     | 70.7       | 145
PROC003      | Collections       | Budget Constraints         | 200   | 142     | 71.0       | 98
PROC003      | Collections       | Already Using Competitor   | 150   | 97      | 64.7       | 62
PROC004      | High-Value Leads  | Need Manager Approval      | 178   | 145     | 81.5       | 121
PROC005      | Expansion         | Technical Concerns         | 95    | 78      | 82.1       | 62
```

**Insights**:
- PROC001 (Outbound) struggles with "Not Interested" (55.6% resolution) → needs coaching
- PROC002 (Renewals) excels at "Competitor Cheaper" (77.7% resolution) → best practices replicable
- PROC003 (Collections) handles budget constraints effectively (71.0%)
- PROC004 (High-Value) has highest manager-approval conversion (81.5%)

---

## Reference Table 1: Objection & Rebuttal Matrix

**Query**: `GET /api/quality-dashboard/objections/rebuttals`

**Fields**:
| Field | Type | Description |
|-------|------|-------------|
| `OBJECTION` | VARCHAR | Customer objection |
| `RECOMMENDED_REBUTTAL` | TEXT | Suggested agent response |
| `FREQUENCY` | INT | Times this objection appears in system |

**Sample Output**:

```
OBJECTION                      | RECOMMENDED_REBUTTAL                                              | FREQUENCY
==================================================================================================
Price Too High                 | Our premium pricing includes 24/7 support and ROI guarantee...   | 1245
Competitor Cheaper             | While they may quote lower, our service level and support...     | 890
Not Interested / Busy          | I understand you're busy—this is a 30-second value call...       | 756
Already Using Competitor       | Our solution integrates seamlessly and has 2x better outcomes... | 634
Company Policy                 | Our compliance team has worked with enterprise policies...        | 512
Need Manager Approval          | Absolutely—I can connect with your manager to discuss...         | 478
Budget Constraints             | We offer flexible payment plans that fit your Q budget...        | 401
Poor Previous Experience       | We've completely redesigned that experience—let me show you... | 389
Timing Not Right               | Perfect—let's schedule for when timing works better...            | 345
Technical Concerns             | Our technical team is available for a 15-min architecture call... | 287
```

**Use Case**: Training materials, agent scripts, quality assessment checklists

---

## Reference Table 2: Overall Health Dashboard

**Query**: `GET /api/quality-dashboard/objections/health`

**Sample Output**:

```json
{
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
```

**Interpretation**:
- Total Objections: 5,892 calls had objections raised
- Handled Rate: 3,654 / 5,892 = 62.0% → **Target > 70%**
- Sales After: 2,187 / 3,654 = 59.8% → **Target > 60%** (currently meeting)
- 148 unique agents handle objections across 87 clients in 12 processes

---

## Consolidated Report (All Metrics)

**Query**: `GET /api/quality-dashboard/objections/comprehensive-report`

**Output**: Single JSON combining all above result sets:

```json
{
  "success": true,
  "report": {
    "dashboard": {
      "TOTAL_OBJECTIONS_RAISED": 5892,
      ...
    },
    "topPatterns": [
      {
        "OBJECTION": "Price Too High",
        "CALL_COUNT": 1245,
        ...
      }
    ],
    "topHandlers": [
      {
        "HANDLER_CODE": "AG001",
        ...
      }
    ],
    "salesMetrics": [
      {
        "OBJECTION": "Price Too High",
        ...
      }
    ],
    "processList": [
      {
        "PROCESS_CODE": "PROC001",
        ...
      }
    ],
    "rebuttalMatrix": [
      {
        "OBJECTION": "Price Too High",
        ...
      }
    ]
  }
}
```

---

## CSV Export Format

For Excel/BI tool integration, each result set can be exported as CSV:

### Top Patterns CSV
```csv
OBJECTION,COUNT,RESOLUTION_RATE,SALES_AFTER,TOP_HANDLER
Price Too High,1245,68.5,562,AG001
Competitor Cheaper,890,72.1,487,AG015
...
```

### Top Handlers CSV
```csv
HANDLER_CODE,HANDLER_NAME,OBJECTIONS_HANDLED,UNIQUE_TYPES,RESOLUTION_PCT,SALES_CLOSED
AG001,Rahul Singh,245,14,87.3,214
AG015,Priya Sharma,189,12,84.2,159
...
```

### Sales Metrics CSV
```csv
OBJECTION,RAISED_COUNT,HANDLED_COUNT,SALES_AFTER,CONVERSION_RATE_PCT
Price Too High,1245,854,562,65.8
Competitor Cheaper,890,642,487,75.8
...
```

### By Process CSV
```csv
PROCESS_CODE,PROCESS_NAME,OBJECTION,OBJECTION_COUNT,HANDLED_COUNT,RESOLUTION_RATE_PCT,SALES_AFTER_OBJECTION
PROC001,Outbound Sales,Price Too High,450,321,71.3,218
PROC001,Outbound Sales,Not Interested,340,189,55.6,98
...
```

---

## Key Metrics & Benchmarks

| Metric | Formula | Benchmark | Status |
|--------|---------|-----------|--------|
| Overall Resolution Rate | (Handled / Raised) × 100 | > 70% | Check `OVERALL_RESOLUTION_RATE_PCT` |
| Sales Conversion After Objection | (Sales / Handled) × 100 | > 60% | Check `SALES_CONVERSION_AFTER_OBJECTION_PCT` |
| Top Handler Performance | Best agent sales rate | > 80% | Top 5 agents |
| Objection Type Conversion | Varies by type | > 65% avg | Check individual `SALES_CLOSE_RATE_AFTER_OBJECTION_PCT` |
| Process Effectiveness | Avg resolution by process | > 70% | Check `PROCESS_NAME` breakdowns |

---

## Integration Examples

### 1. Dashboard Visualization (React)
```javascript
import { useEffect, useState } from 'react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis } from 'recharts';

export function ObjectionDashboard() {
  const [patterns, setPatterns] = useState([]);
  const [handlers, setHandlers] = useState([]);

  useEffect(() => {
    fetch('/api/quality-dashboard/objections/comprehensive-report')
      .then(r => r.json())
      .then(data => {
        setPatterns(data.report.topPatterns);
        setHandlers(data.report.topHandlers);
      });
  }, []);

  return (
    <div>
      <h2>Top Objections</h2>
      <BarChart data={patterns}>
        <XAxis dataKey="OBJECTION" />
        <YAxis />
        <Bar dataKey="CALL_COUNT" fill="#8884d8" />
      </BarChart>

      <h2>Top Handlers</h2>
      <BarChart data={handlers}>
        <XAxis dataKey="HANDLER_NAME" />
        <YAxis />
        <Bar dataKey="SALES_CLOSE_RATE_AFTER_OBJ_PCT" fill="#82ca9d" />
      </BarChart>
    </div>
  );
}
```

### 2. SQL Direct Query (Local Analysis)
```sql
-- Query top 3 objections with their best handlers
SELECT
    p.OBJECTION,
    p.CALL_COUNT,
    p.RESOLUTION_RATE_PCT,
    h.HANDLER_CODE,
    h.HANDLER_NAME,
    h.SALES_CLOSE_RATE_AFTER_OBJ_PCT
FROM (
    SELECT * FROM objection_patterns LIMIT 3
) p
CROSS APPLY (
    SELECT HANDLER_CODE, HANDLER_NAME, SALES_CLOSE_RATE_AFTER_OBJ_PCT
    FROM objection_handlers
    WHERE RESOLUTION_PCT > 80
    LIMIT 1
) h;
```

---

## File References

- **SQL Queries**: `/scripts/objection-analysis.sql`
- **TypeScript Service**: `/backend/src/modules/quality-dashboard/objection-analysis.service.ts`
- **API Routes**: `/backend/src/modules/quality-dashboard/quality-dashboard.routes.ts`
- **Documentation**: `/docs/OBJECTION_ANALYSIS_GUIDE.md` (this file)
