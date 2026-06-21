# Objection Analysis - Quick Reference Card

## Output Format (Single Line)

```
OBJECTION | COUNT | RESOLUTION_RATE | SALES_AFTER | TOP_HANDLER
```

## The 4 Main Result Sets

### 1️⃣ TOP OBJECTION TYPES & RESOLUTION RATES
```
API:  GET /api/quality-dashboard/objections/patterns?limit=50
SQL:  Query 1 in scripts/objection-analysis.sql

Output:
OBJECTION                | COUNT | RESOLUTION_RATE_% | SALES_AFTER | TOP_HANDLER
────────────────────────────────────────────────────────────────────────────────
Price Too High          | 1245  | 68.5              | 562         | AG001
Competitor Cheaper      | 890   | 72.1              | 487         | AG015
Not Interested / Busy   | 756   | 61.2              | 301         | AG008
```

### 2️⃣ TOP OBJECTION HANDLERS (BEST RESOLUTION %)
```
API:  GET /api/quality-dashboard/objections/handlers?limit=50
SQL:  Query 2 in scripts/objection-analysis.sql

Output:
HANDLER_CODE | HANDLER_NAME  | OBJECTIONS_HANDLED | UNIQUE_TYPES | CONVERSION_% | SALES_CLOSED
─────────────────────────────────────────────────────────────────────────────────────────────
AG001        | Rahul Singh   | 245                | 14           | 87.3         | 214
AG015        | Priya Sharma  | 189                | 12           | 84.2         | 159
AG008        | Amit Kumar    | 167                | 10           | 81.9         | 137
```

### 3️⃣ SALES CLOSED AFTER OBJECTION HANDLING
```
API:  GET /api/quality-dashboard/objections/sales-metrics?limit=50
SQL:  Query 3 in scripts/objection-analysis.sql

Output:
OBJECTION               | RAISED_COUNT | HANDLED_COUNT | SALES_AFTER | CONVERSION_RATE_%
────────────────────────────────────────────────────────────────────────────────────────────
Price Too High         | 1245         | 854           | 562         | 65.8
Competitor Cheaper     | 890          | 642           | 487         | 75.8
Not Interested         | 756          | 463           | 217         | 46.9
```

### 4️⃣ OBJECTION TYPES BY PROCESS
```
API:  GET /api/quality-dashboard/objections/by-process?limit=100
SQL:  Query 4 in scripts/objection-analysis.sql

Output:
PROCESS_CODE | PROCESS_NAME    | OBJECTION          | COUNT | HANDLED | RES_RATE_% | SALES_AFTER
────────────────────────────────────────────────────────────────────────────────────────────────
PROC001      | Outbound Sales  | Price Too High     | 450   | 321     | 71.3       | 218
PROC001      | Outbound Sales  | Not Interested     | 340   | 189     | 55.6       | 98
PROC002      | Renewals        | Competitor Cheaper | 310   | 241     | 77.7       | 187
```

---

## 🔗 API Quick Links

| What You Need | Endpoint | How to Use |
|---|---|---|
| Top objections | `/objections/patterns` | `curl -H "Auth: Bearer $TOKEN" "http://localhost:5055/api/quality-dashboard/objections/patterns?limit=50"` |
| Best handlers | `/objections/handlers` | Same URL, replace `patterns` with `handlers` |
| Sales metrics | `/objections/sales-metrics` | Same URL, replace `patterns` with `sales-metrics` |
| By process | `/objections/by-process` | Same URL, replace `patterns` with `by-process` |
| Rebuttals | `/objections/rebuttals` | Same URL, replace `patterns` with `rebuttals` |
| Health KPIs | `/objections/health` | Same URL, replace `patterns` with `health` |
| All in one | `/objections/comprehensive-report` | Same URL, replace `patterns` with `comprehensive-report` |

---

## 🚀 Quick Start (3 steps)

### Step 1: Set Auth Token
```bash
export AUTH_TOKEN="your-jwt-token-here"
export BACKEND_URL="http://localhost:5055"
```

### Step 2: Fetch Data
```bash
# Option A: Get top objections
curl -H "Authorization: Bearer $AUTH_TOKEN" \
  "$BACKEND_URL/api/quality-dashboard/objections/patterns"

# Option B: Get best handlers
curl -H "Authorization: Bearer $AUTH_TOKEN" \
  "$BACKEND_URL/api/quality-dashboard/objections/handlers"

# Option C: Get everything
curl -H "Authorization: Bearer $AUTH_TOKEN" \
  "$BACKEND_URL/api/quality-dashboard/objections/comprehensive-report"
```

### Step 3: Generate Report
```bash
./scripts/run-objection-analysis.sh
# Creates: objection-reports/YYYYMMDD_HHMMSS/
```

---

## 📊 Key Metrics Cheat Sheet

| Metric | Formula | Target | Where |
|---|---|---|---|
| **Resolution Rate** | (Handled / Raised) × 100 | > 70% | `RESOLUTION_RATE_PCT` |
| **Sales Conversion** | (Sales / Handled) × 100 | > 60% | `SALES_CLOSE_RATE_AFTER_OBJECTION_PCT` |
| **Handler Performance** | Sales from their handling | > 80% | Top 5 in handlers list |

---

## 📁 File Locations

```
MyHRMS1/
├── backend/src/modules/quality-dashboard/
│   ├── objection-analysis.service.ts     ← Core queries
│   └── quality-dashboard.routes.ts       ← API endpoints
├── scripts/
│   ├── objection-analysis.sql            ← Direct SQL
│   └── run-objection-analysis.sh         ← Report generator
└── docs/
    ├── OBJECTION_ANALYSIS_README.md      ← Full guide
    ├── OBJECTION_ANALYSIS_GUIDE.md       ← Technical details
    ├── OBJECTION_ANALYSIS_OUTPUT_FORMAT.md ← Sample data
    └── OBJECTION_QUICK_REFERENCE.md      ← This file
```

---

## 🔍 Data Sources

| Table | Database | Contains |
|---|---|---|
| `CallDetails` | `db_external` (Shivamgiri) | Call records with objections & outcomes |
| `tbl_obj` | `db_external` (Shivamgiri) | Objection types & recommended rebuttals |
| `employees` | `mas_hrms` | Agent names (lookup) |
| `process_master` | `mas_hrms` | Process/campaign names (lookup) |

---

## 🎯 Common Use Cases

### "What are customers objecting to?"
→ Use **Result Set 1: Top Objection Types**  
Check: `OBJECTION` column sorted by `COUNT` DESC

### "Who's best at handling objections?"
→ Use **Result Set 2: Top Handlers**  
Check: `HANDLER_NAME` sorted by `CONVERSION_%` DESC

### "Which objections convert to sales?"
→ Use **Result Set 3: Sales After Objection**  
Check: `CONVERSION_RATE_%` DESC

### "Do certain processes have specific objection problems?"
→ Use **Result Set 4: By Process**  
Filter by `PROCESS_CODE`, check `RES_RATE_%` by objection

### "What's the rebuttal for a given objection?"
→ Use **Reference: Rebuttals**  
Search `OBJECTION` in `/objections/rebuttals`

### "Overall health snapshot?"
→ Use **Reference: Health**  
Check `/objections/health` for KPIs

---

## ⚡ One-Liners

### Get all data as JSON
```bash
curl -s -H "Authorization: Bearer $AUTH_TOKEN" \
  "$BACKEND_URL/api/quality-dashboard/objections/comprehensive-report" | jq '.'
```

### Export top objections as CSV
```bash
curl -s -H "Authorization: Bearer $AUTH_TOKEN" \
  "$BACKEND_URL/api/quality-dashboard/objections/patterns?limit=100" | \
  jq -r '.patterns | ["OBJECTION", "COUNT", "RESOLUTION_RATE"] | @csv, (.[] | [.OBJECTION, .CALL_COUNT, .RESOLUTION_RATE_PCT] | @csv)' > objections.csv
```

### Find best handler for each objection
```bash
curl -s -H "Authorization: Bearer $AUTH_TOKEN" \
  "$BACKEND_URL/api/quality-dashboard/objections/patterns?limit=20" | \
  jq -r '.patterns | .[] | "\(.OBJECTION) → \(.TOP_HANDLER)"'
```

### List objections by conversion rate
```bash
curl -s -H "Authorization: Bearer $AUTH_TOKEN" \
  "$BACKEND_URL/api/quality-dashboard/objections/sales-metrics?limit=50" | \
  jq -r '.metrics | sort_by(.CONVERSION_RATE_AFTER_HANDLING_PCT) | reverse | .[] | "\(.OBJECTION): \(.CONVERSION_RATE_AFTER_HANDLING_PCT)%"'
```

---

## 🛠️ Troubleshooting

| Problem | Solution |
|---|---|
| 401 Unauthorized | Check `AUTH_TOKEN` is valid JWT |
| 403 Forbidden | Verify user has role: admin/hr/ceo/qa/analyst/manager/process_manager/branch_head |
| No data | Ensure `db_external` is connected; check `CallDetails` table exists |
| Slow response | Use `?limit=20` to reduce result set size |
| NULL values | Indicates missing data in upstream sources |

---

## 📞 References

| Need | File |
|---|---|
| Full technical details | `OBJECTION_ANALYSIS_GUIDE.md` |
| Sample output examples | `OBJECTION_ANALYSIS_OUTPUT_FORMAT.md` |
| Getting started | `OBJECTION_ANALYSIS_README.md` |
| Source code | `backend/src/modules/quality-dashboard/objection-analysis.service.ts` |
| Direct SQL | `scripts/objection-analysis.sql` |
| Automated report | `scripts/run-objection-analysis.sh` |

---

**Last Updated**: 2026-06-21  
**System**: HRMS Quality Dashboard - Call Analysis Module
