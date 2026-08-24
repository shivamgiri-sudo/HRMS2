# MAS Callnet HRMS — MCP Server

Connects **Claude AI** (Claude Code) directly to the `mas_hrms` database so you can query live workforce data in plain English and build dashboards instantly.

---

## What you can do

Once set up, just ask Claude anything about the HRMS:

> "How many employees are active right now?"  
> "Show me attendance trend for the last 30 days"  
> "Build a CEO dashboard with branch headcount and ATS pipeline"  
> "Which branches have the most pending leave requests?"  
> "Show me all ATS candidates in Round 2 Ops stage"  

Claude queries the live database and answers — no SQL knowledge needed.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| **Node.js 18+** | [nodejs.org](https://nodejs.org) — LTS version |
| **Claude Code** | VSCode extension or CLI |
| **LAN access** | Must be on the MAS Callnet internal network (192.168.10.x) |
| **DB credentials** | Get `DB_USER` and `DB_PASSWORD` from your DB admin |

---

## Setup (Windows)

### Step 1 — Run the setup script
```
Double-click setup.bat
```
This installs dependencies, copies `.env.example` → `.env`, and tests the connection.

### Step 2 — Edit `.env`
Open `.env` in Notepad and fill in:
```
DB_HOST=192.168.10.6
DB_PORT=3306
DB_USER=your_username
DB_PASSWORD=your_password
DB_NAME=mas_hrms
HRMS_ROLE=viewer
```
Ask your admin which `HRMS_ROLE` you should use (see roles below).

### Step 3 — Add to `.mcp.json`
In your Claude Code project root, open or create `.mcp.json`:
```json
{
  "mcpServers": {
    "hrms-db": {
      "command": "node",
      "args": ["C:/path/to/mcp-server/index.mjs"]
    }
  }
}
```
Replace `C:/path/to/mcp-server/` with the actual folder path.

### Step 4 — Restart Claude Code
Close and reopen Claude Code in your project. The `hrms-db` tools will appear automatically.

---

## Manual install (if setup.bat fails)
```bash
cd mcp-server
npm install
cp .env.example .env
# edit .env with your credentials
```

---

## Access Roles

Set `HRMS_ROLE` in `.env` to one of:

| Role | What you can query |
|---|---|
| `viewer` | Employee list, branch structure, process/LOB master |
| `hr` | + Attendance records, leave requests, leave balances |
| `recruitment` | hr + ATS candidate pipeline, interviews, offers |
| `management` | recruitment + KPI, process performance, WFM roster |
| `finance` | management + P&L cost/revenue components |
| `full` | Everything above — no payroll/statutory ever |

Ask your admin which role to assign.

---

## Security

| Protection | How |
|---|---|
| **Read-only** | Only `SELECT / SHOW / DESCRIBE / EXPLAIN` allowed — no INSERT/UPDATE/DELETE |
| **Blocked tables** | Payroll, salary, TDS, PF/ESIC, gratuity, F&F, bank details — **always blocked regardless of role** |
| **PII masking** | PAN, Aadhaar, account numbers, personal phone/email — automatically replaced with `***` in all output |
| **Row cap** | Maximum 500 rows per query |
| **Role allowlist** | Each role can only see its assigned tables — attempting to query outside your role returns an error |

---

## Available Tools

Once connected, Claude has these tools:

| Tool | What it does |
|---|---|
| `query_hrms` | Run any SELECT query on allowed tables |
| `list_allowed_tables` | See which tables your role can access |
| `describe_table` | See column names and types for a table |
| `get_hrms_stats` | Live snapshot: headcount, attendance, ATS, leave |
| `search_employees` | Search by name or employee code |
| `get_dashboard_data` | Full dataset for building a CEO analytics dashboard |
| `get_role_info` | Show current role, permissions, and what each role can do |

---

## Example prompts to try

```
What is my current HRMS role and what tables can I access?

How many employees joined this month vs last month?

Build a dashboard showing attendance trend for August 2026

Show me the top 10 branches by headcount with active vs resigned breakdown

How many ATS candidates are currently in Round 2 Ops stage?

Which leave type has the most pending requests?
```

---

## Troubleshooting

**"DB_USER and DB_PASSWORD must be set"**  
→ Edit `.env` and fill in your credentials. Make sure there are no extra spaces.

**"Table X is not accessible for role=viewer"**  
→ Your role doesn't have access to that table. Ask admin to assign a higher role or use `list_allowed_tables` to see what's available.

**"Connection refused" / timeout**  
→ You're not on the MAS Callnet LAN. Connect via VPN or use from within the office network.

**Claude Code doesn't show hrms-db tools**  
→ Check `.mcp.json` path is correct and absolute. Restart Claude Code. Check that `node mcp-server/index.mjs` runs without errors in a terminal.

---

*MAS Callnet PeopleOS • HRMS MCP Server v2.0 • Read-only • Payroll always protected*
