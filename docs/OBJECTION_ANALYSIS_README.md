# Call Analysis: Objection Patterns Intelligence

**System**: HRMS Quality Dashboard  
**Module**: Quality Dashboard > Objection Analysis  
**Data Sources**: `db_external.CallDetails`, `db_external.tbl_obj`, `mas_hrms` lookups  
**Created**: 2026-06-21

---

## Quick Start

### 1. Get Objection Data via API

```bash
# Set your JWT token
export AUTH_TOKEN="your-jwt-token-here"
export BACKEND_URL="http://localhost:5055"

# Fetch top objection patterns
curl -H "Authorization: Bearer $AUTH_TOKEN" \
  "$BACKEND_URL/api/quality-dashboard/objections/patterns?limit=50"
```

### 2. Run Full Analysis Script

```bash
export AUTH_TOKEN="your-jwt-token-here"
./scripts/run-objection-analysis.sh
```

This generates:
- JSON reports (all endpoints)
- CSV exports (for Excel/BI tools)
- HTML dashboard (interactive charts)
- Text summary (executive overview)

### 3. Direct SQL Query

```bash
mysql -u root mas_hrms < scripts/objection-analysis.sql
```

---

## Query Output Format

```
OBJECTION | COUNT | RESOLUTION_RATE | SALES_AFTER | TOP_HANDLER
```

### Example Results

```
Price Too High                | 1245 | 68.5% | 562 | AG001
Competitor Cheaper            | 890  | 72.1% | 487 | AG015
Not Interested / Busy         | 756  | 61.2% | 301 | AG008
Already Using Competitor      | 634  | 65.8% | 289 | AG023
Company Policy / Compliance   | 512  | 58.9% | 178 | AG005
```

---

## Four Main Result Sets

### 1. **Top Objection Types & Resolution Rates**
- Identifies most common objections
- Shows how often each is handled (resolution %)
- Shows sales outcomes
- Includes best handler for each objection

**API**: `GET /api/quality-dashboard/objections/patterns`

**Columns**:
```
OBJECTION | COUNT | RESOLUTION_RATE | SALES_AFTER | TOP_HANDLER
```

### 2. **Top Objection Handlers**
- Lists agents ranked by sales conversion rate after objection handling
- Shows objection handling volume per agent
- Shows variety of objection types handled
- Minimum 5 objections handled to appear

**API**: `GET /api/quality-dashboard/objections/handlers`

**Columns**:
```
HANDLER_CODE | HANDLER_NAME | OBJECTIONS_HANDLED | UNIQUE_TYPES | RESOLUTION_PCT | SALES_CLOSED
```

**Example**:
```
AG001 | Rahul Singh   | 245 | 14 | 87.3% | 214
AG015 | Priya Sharma  | 189 | 12 | 84.2% | 159
AG008 | Amit Kumar    | 167 | 10 | 81.9% | 137
```

### 3. **Sales Closed After Objection Handling**
- Shows conversion rate by objection type
- Identifies which objections convert best
- Helps prioritize training on low-conversion objections

**API**: `GET /api/quality-dashboard/objections/sales-metrics`

**Columns**:
```
OBJECTION | RAISED_COUNT | HANDLED_COUNT | SALES_AFTER | CONVERSION_RATE_PCT
```

**Example**:
```
Price Too High      | 1245 | 854 | 562 | 65.8%
Competitor Cheaper  | 890  | 642 | 487 | 75.8%
Not Interested      | 756  | 463 | 217 | 46.9%
```

### 4. **Objection Types by Process**
- Shows objection distribution across processes/campaigns
- Identifies process-specific challenges
- Helps tailor training per process

**API**: `GET /api/quality-dashboard/objections/by-process`

**Columns**:
```
PROCESS_CODE | PROCESS_NAME | OBJECTION | COUNT | RESOLUTION_RATE | SALES_AFTER
```

**Example**:
```
PROC001 | Outbound Sales  | Price Too High      | 450 | 71.3% | 218
PROC001 | Outbound Sales  | Not Interested      | 340 | 55.6% | 98
PROC002 | Renewals        | Competitor Cheaper  | 310 | 77.7% | 187
```

---

## Additional Reference Data

### 5. **Objection & Rebuttal Reference Matrix**
- Knowledge base: objection type → recommended rebuttal
- Training materials
- Agent script reference

**API**: `GET /api/quality-dashboard/objections/rebuttals`

### 6. **Overall Health Dashboard**
- Single snapshot of objection metrics
- KPIs: total raised, handled, sales conversion rate
- Unique handlers/clients/processes

**API**: `GET /api/quality-dashboard/objections/health`

### 7. **Comprehensive Report**
- All result sets combined in one JSON
- Single API call for full analysis

**API**: `GET /api/quality-dashboard/objections/comprehensive-report`

---

## API Endpoints Reference

| Endpoint | Purpose | Returns |
|----------|---------|---------|
| `/api/quality-dashboard/objections/patterns` | Top objections + resolution rates | Array of patterns |
| `/api/quality-dashboard/objections/handlers` | Top handlers by sales conversion | Array of handlers |
| `/api/quality-dashboard/objections/sales-metrics` | Sales conversion by objection | Array of metrics |
| `/api/quality-dashboard/objections/by-process` | Objections grouped by process | Array of process breakdowns |
| `/api/quality-dashboard/objections/rebuttals` | Objection + rebuttal reference | Array of rebuttals |
| `/api/quality-dashboard/objections/health` | Overall health KPIs | Single dashboard object |
| `/api/quality-dashboard/objections/comprehensive-report` | All metrics combined | Single report object |

**Common Query Params**:
- `limit=50` (default) - controls result set size
- Auth: `Authorization: Bearer {JWT_TOKEN}`

---

## Files in This Implementation

### Backend Code
```
backend/src/modules/quality-dashboard/
├── objection-analysis.service.ts      # Core service: database queries
├── quality-dashboard.routes.ts        # 7 new API endpoints added
```

### Database Scripts
```
scripts/
└── objection-analysis.sql             # All 6 SQL queries (runnable directly)
```

### Documentation
```
docs/
├── OBJECTION_ANALYSIS_README.md       # This file
├── OBJECTION_ANALYSIS_GUIDE.md        # Detailed technical guide
├── OBJECTION_ANALYSIS_OUTPUT_FORMAT.md# Sample data & format examples
```

### CLI Tools
```
scripts/
└── run-objection-analysis.sh          # Automated report generator
```

---

## Key Metrics & Benchmarks

| Metric | Formula | Target | Check |
|--------|---------|--------|-------|
| **Overall Resolution Rate** | (Handled / Raised) × 100 | > 70% | `OVERALL_RESOLUTION_RATE_PCT` |
| **Sales Conversion After Objection** | (Sales / Handled) × 100 | > 60% | `SALES_CONVERSION_AFTER_OBJECTION_PCT` |
| **Top Handler Performance** | Best agent conversion % | > 80% | Top 5 in handlers list |
| **Objection Type Conversion** | Varies by type | > 65% avg | Individual conversion rates |
| **Process Effectiveness** | Avg resolution by process | > 70% | Process breakdowns |

---

## Usage Examples

### Example 1: Find Most Common Objections
```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:5055/api/quality-dashboard/objections/patterns?limit=10" \
  | jq '.patterns | .[] | "\(.OBJECTION): \(.CALL_COUNT) calls, \(.RESOLUTION_RATE_PCT)% handled"'
```

Output:
```
Price Too High: 1245 calls, 68.5% handled
Competitor Cheaper: 890 calls, 72.1% handled
Not Interested: 756 calls, 61.2% handled
```

### Example 2: Identify Best Performers
```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:5055/api/quality-dashboard/objections/handlers?limit=5" \
  | jq '.handlers | .[] | "\(.HANDLER_NAME): \(.SALES_CLOSE_RATE_AFTER_OBJ_PCT)% conversion"'
```

Output:
```
Rahul Singh: 87.3% conversion
Priya Sharma: 84.2% conversion
Amit Kumar: 81.9% conversion
```

### Example 3: Find Training Rebuttals
```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:5055/api/quality-dashboard/objections/rebuttals?limit=5" \
  | jq '.rebuttals | .[] | "Q: \(.OBJECTION)\nA: \(.RECOMMENDED_REBUTTAL)\n"'
```

### Example 4: Generate Full Report
```bash
export AUTH_TOKEN="your-jwt-token"
./scripts/run-objection-analysis.sh
# Generates: objection-reports/YYYYMMDD_HHMMSS/
#   ├── comprehensive-report.json
#   ├── top-objections.csv
#   ├── top-handlers.csv
#   ├── sales-metrics.csv
#   ├── dashboard.html
#   └── SUMMARY.txt
```

---

## Integration Points

### Frontend Dashboard
Embed in React components:
```javascript
import { getObjectionPatterns } from './api/quality-dashboard';

export function ObjectionWidget() {
  const [patterns, setPatterns] = useState([]);
  
  useEffect(() => {
    getObjectionPatterns().then(setPatterns);
  }, []);
  
  return (
    <div>
      <h2>Top Objections</h2>
      <table>
        {patterns.map(p => (
          <tr key={p.OBJECTION}>
            <td>{p.OBJECTION}</td>
            <td>{p.CALL_COUNT}</td>
            <td>{p.RESOLUTION_RATE_PCT}%</td>
          </tr>
        ))}
      </table>
    </div>
  );
}
```

### BI Tools & Dashboards
Export to Tableau/Power BI:
```bash
# Generate CSV files
./scripts/run-objection-analysis.sh

# Use CSV files directly in BI tools
# Files: top-objections.csv, top-handlers.csv, sales-metrics.csv
```

### Training & Performance Systems
Use rebuttal matrix for:
- Agent training materials
- Quality assessment scripts
- Performance coaching

---

## Security & Access Control

All endpoints enforce role-based access:
- **Allowed Roles**: admin, hr, ceo, qa, analyst, manager, process_manager, branch_head
- **Auth**: Require `Authorization: Bearer {JWT_TOKEN}` header
- **Scope**: Process managers/branch heads see only their scope; global roles see all

---

## Performance Considerations

- **Query Optimization**: Indexed on OBJECTION, User, campaign_id
- **Pagination**: Use `limit` parameter for large datasets
- **Caching**: Dashboard can cache at 1-hour granularity
- **Load**: 100K+ calls analyzed efficiently with GROUP BY aggregation

---

## Troubleshooting

### No Data Returned
- Verify `db_external` database connectivity
- Check if `CallDetails` and `tbl_obj` tables exist
- Confirm call data is being populated from upstream

### Low Resolution Rates
- Indicates objections raised but not handled
- Opportunity: improve agent objection handling training
- Use top handlers as coaches

### Missing Handler Names
- Agent code in CallDetails doesn't map to mas_hrms.employees
- Run employee sync/reconciliation

---

## References

| File | Purpose |
|------|---------|
| `backend/src/modules/quality-dashboard/objection-analysis.service.ts` | Core TypeScript service with 6 database queries |
| `backend/src/modules/quality-dashboard/quality-dashboard.routes.ts` | Express routes for 7 new API endpoints |
| `scripts/objection-analysis.sql` | Raw SQL queries (use directly with MySQL) |
| `docs/OBJECTION_ANALYSIS_GUIDE.md` | Detailed technical documentation |
| `docs/OBJECTION_ANALYSIS_OUTPUT_FORMAT.md` | Sample data and format examples |
| `scripts/run-objection-analysis.sh` | CLI script for automated report generation |

---

## Next Steps

1. **Start Backend Service**:
   ```bash
   cd backend
   npm start
   ```

2. **Test API**:
   ```bash
   curl -H "Authorization: Bearer $AUTH_TOKEN" \
     "http://localhost:5055/api/quality-dashboard/objections/health"
   ```

3. **Generate First Report**:
   ```bash
   export AUTH_TOKEN="your-token"
   ./scripts/run-objection-analysis.sh
   ```

4. **View Results**:
   - JSON: `objection-reports/TIMESTAMP/comprehensive-report.json`
   - HTML: Open `objection-reports/TIMESTAMP/dashboard.html` in browser
   - CSV: Import `objection-reports/TIMESTAMP/*.csv` to Excel/BI tools

---

## Support

For issues, see:
- **Technical Guide**: `/docs/OBJECTION_ANALYSIS_GUIDE.md`
- **Sample Output**: `/docs/OBJECTION_ANALYSIS_OUTPUT_FORMAT.md`
- **Codebase**: `/backend/src/modules/quality-dashboard/`

---

**System Architecture**: Call Analytics → Quality Dashboard → Objection Intelligence  
**Data Flow**: CallDetails (Shivamgiri) → Express API → Frontend/Export  
**Last Updated**: 2026-06-21
