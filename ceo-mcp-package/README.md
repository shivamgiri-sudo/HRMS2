# MAS Callnet HRMS — CEO Analytics for Claude AI

This connects Claude AI directly to the MAS Callnet HRMS database so you can ask questions and get live workforce analytics instantly — no dashboards to open, no reports to request.

---

## What you can ask Claude

Once set up, open Claude Code and type naturally:

> "Show me today's attendance count"
> "Build a CEO dashboard with headcount, ATS pipeline, and attendance trend"
> "How many employees joined this month vs last month?"
> "Which branch has the most active employees?"
> "Show me the monthly joiners vs exits for the last year"
> "What's the current ATS pipeline breakdown by stage?"
> "How many leave requests are pending approval?"

---

## Setup (5 minutes, one time only)

### Step 1 — Install Node.js
If you don't have it: https://nodejs.org → download LTS → install.

### Step 2 — Run setup
Double-click `setup.bat` in this folder.
It will ask you to fill in your database credentials in the `.env` file.

### Step 3 — Add to Claude Code
Open (or create) `.mcp.json` in your Claude Code project folder and add:

```json
{
  "mcpServers": {
    "hrms-db": {
      "command": "node",
      "args": ["C:/path/to/this-folder/index.mjs"]
    }
  }
}
```

Replace `C:/path/to/this-folder/` with the actual location of this folder on your machine.

### Step 4 — Restart Claude Code
Close and reopen Claude Code. The HRMS tools connect automatically.

---

## Your access level

You have **full** access — the highest level available:

| Data available to you |
|---|
| All employee records (headcount, joining, exits) |
| All branch and process structure |
| Attendance records and trends |
| Leave requests and balances |
| Full ATS recruitment pipeline |
| KPI and process performance |
| WFM roster data |
| P&L cost and revenue components |

**Payroll, salary figures, PAN, Aadhaar, and bank details are permanently blocked** — they cannot be accessed through this tool regardless of role.

---

## Need help?
Contact your HRMS admin.
