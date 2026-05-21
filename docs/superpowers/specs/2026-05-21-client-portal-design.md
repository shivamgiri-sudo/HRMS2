# Client Portal — Design Spec
**Date:** 2026-05-21  
**Project:** MAS Callnet HRMS — Client-Facing Performance Portal  
**Status:** Approved for implementation planning

---

## 1. Overview

Clients (Airtel, Jio, etc.) get a dedicated portal to view operational performance for their BPO process(es) — KPI scorecards, glide path commitments, action plans, governance activity, attrition, and management commentary.

**Goals:**
- Replace manual PDF/Excel report sharing with a live, self-serve portal
- Create an auditable paper trail of commitments and acknowledgements
- Give ops teams full transparency without exposing internal HR data

**Not in scope:** Internal staff login, payroll data, individual employee records, recruitment pipeline.

---

## 2. Authentication — Magic Link (Email OTP)

No passwords. Client users authenticate via email OTP:

1. Client visits `/client-portal` → enters registered email
2. System generates a 6-digit OTP (valid 10 min, single-use) → sends via email
3. Client enters OTP → receives a signed JWT (7-day expiry, rotated on each login)
4. JWT stored in `localStorage`; sent as `Authorization: Bearer <token>` on all API calls
5. JWT payload: `{ clientUserId, clientId, processIds: [...], role: 'client' }`

**Audit trail:** Every portal page load logged to `portal_access_log` (user, timestamp, IP, page visited).

**Multi-user:** Each client company can have multiple registered users (ops head, QA manager, CXO). Each user has access scoped to their process(es).

**Token revocation:** Deleting the `client_user` record or rotating a server secret invalidates all sessions.

---

## 3. Navigation — Account Overview + Process Drill-Down

```
/portal                       → Account Overview (all processes summary)
/portal/processes/:id         → Process Dashboard (single process full view)
```

**Account Overview:** Shows a summary scorecard across all processes belonging to the client. Each process card shows name, overall RAG status, and 3 key metrics. If client has exactly one process, redirect directly to `/portal/processes/:id` (skip overview).

**Process Dashboard:** 6 tabs, each independently scrollable:
1. Performance (KPI Scorecards)
2. Glide Paths
3. Action Plans
4. Governance
5. Attrition & Headcount
6. Commentary

---

## 4. Account Overview Page

### Process Cards Grid

Each process card:
- Process name + client name
- Overall RAG: Green (all metrics on track), Amber (≥1 at risk), Red (≥1 off track)
- 3 headline metrics: CSAT, AHT, FCR — current value vs target, colour-coded
- Last updated timestamp
- Click → navigate to Process Dashboard

**Sorting:** Red first, Amber second, Green last (worst health surfaces first).

---

## 5. Process Dashboard — Tab 1: Performance (KPI Scorecards)

### KPI Scorecards

One card per metric assigned to this process via `kpi_template_metric`. Card shows:
- Metric name + unit
- Current month actual value
- Target value
- Achievement % (calculated per direction: `higher_is_better` or `lower_is_better`)
- RAG status:
  - Green: achievement ≥ 100%
  - Amber: achievement ≥ 85% and < 100%
  - Red: achievement < 85%
- MTD sparkline: last 6 months trend (data from `kpi_score`)

**Layout:** 3-column grid on desktop, 2-column on tablet, 1-column on mobile.

**Data source:** `kpi_score` joined to `kpi_metric_master` and `kpi_template_metric` for the process's assigned template. Period = current month (YYYY-MM).

---

## 6. Process Dashboard — Tab 2: Glide Paths

Shown only for metrics where current achievement < 100% (off-track or at-risk metrics).

### Glide Path Chart (per off-track metric)

An SVG/canvas line chart with 3 lines:
- **Actual** (solid line, blue): historical monthly actuals from `kpi_score`
- **Committed** (dashed line, amber): the improvement trajectory ops team has committed to — stored in `glide_path_commitment` table
- **Target** (dotted line, green): flat line at the metric's target value

X-axis: months (last 3 actual + next 3 committed)  
Y-axis: metric value (auto-scaled)  
Today marker: vertical dashed line

**Commitment data model:**
```
glide_path_commitment
  id, process_id, metric_id, committed_by (user_id), created_at
  month (YYYY-MM), committed_value DECIMAL(12,4)
  is_locked TINYINT(1)  -- locked once client acknowledges
```

Ops team enters committed values month-by-month. Client sees exactly when the team has committed to hit target and whether actual tracks to commitment.

**Alert:** If actual falls below committed by >5%, the chart shows an amber warning badge: "Tracking Behind Commitment".

---

## 7. Process Dashboard — Tab 3: Action Plans

One accordion section per off-track metric. Each section lists specific actions being taken.

### Action Item row:
- Description of action
- Owner level tag: `Analyst` / `TL` / `Process Manager` / `Branch Head`
- Owner name (staff member name — no employee ID exposed to client)
- Due date
- Status: `Planned` | `In Progress` | `Done` | `Delayed`
- Linked metric

### Data model:
```
action_plan
  id, process_id, metric_id
  action_text TEXT
  owner_level ENUM('analyst','tl','process_manager','branch_head')
  owner_name VARCHAR(255)
  due_date DATE
  status ENUM('planned','in_progress','done','delayed')
  created_by (internal user_id), created_at, updated_at
```

**Client view:** Read-only. Internal ops team creates/updates action items via internal HRMS.

**Filtering:** Client can filter by metric and/or status.

---

## 8. Process Dashboard — Tab 4: Governance Checklist

4-column layout — one column per governance level:
- **Analyst** (daily/weekly tasks): Adherence checks, QA calibration attendance
- **Team Leader** (weekly): Floor walks, team briefings, coaching sessions
- **Process Manager** (weekly/monthly): MIS review, escalation review, SIP reviews
- **Branch Head** (monthly): Client review meeting, P&L review, headcount review

### Each checklist item:
- Activity name
- Frequency (daily / weekly / monthly)
- Required count in period (e.g., "4 floor walks this month")
- Completed count
- % completion
- Status indicator (green/amber/red)

### Data model:
```
governance_activity_master
  id, activity_name, level ENUM('analyst','tl','process_manager','branch_head')
  frequency ENUM('daily','weekly','monthly'), required_count INT

governance_checklist_log
  id, process_id, period (YYYY-MM)
  activity_id, completed_count INT
  updated_by (internal user_id), updated_at
```

**Summary row** at bottom of each column: overall completion % for that level.

---

## 9. Process Dashboard — Tab 5: Attrition & Headcount

### Metrics shown:
- Monthly attrition % (voluntary / involuntary split) — 6-month trend bar chart
- Current headcount vs sanctioned strength (numeric + % fill)
- Open positions count
- Average tenure (months) of current staff

### Exit reason analysis:
Top 3 exit reasons from exit interviews (from `exit_management` module), shown as a horizontal bar chart with counts.

### Data model:
Draws from existing `exit_management` module + `employees` table. No new tables needed.

**Period selector:** Default = current month. Dropdown allows last 6 months.

---

## 10. Process Dashboard — Tab 6: Commentary

### Management Commentary card (per month):
- Author name + designation
- Date published
- Free-text body (rendered as markdown — bold, bullets, links only; no raw HTML)
- Attachments: up to 3 file links (PDF/XLSX stored in object storage)

### Client interaction:
Two buttons visible to logged-in client users:
1. **Acknowledge & Accept** — stamps the commentary as read; records `acknowledged_at`, `acknowledged_by`
2. **Add Comment** — opens a text area; client can reply (max 1000 chars); reply visible to internal ops team

### Acknowledgement state:
- Unacknowledged: amber badge "Awaiting Acknowledgement"
- Acknowledged: green badge "Acknowledged on [date] by [name]"

### Data model:
```
management_commentary
  id, process_id, period (YYYY-MM)
  author_id (internal user_id), author_name VARCHAR(255), author_designation VARCHAR(255)
  body TEXT, published_at DATETIME
  acknowledged_at DATETIME NULL, acknowledged_by_client_user_id CHAR(36) NULL

management_commentary_reply
  id, commentary_id
  replied_by_client_user_id CHAR(36), reply_text TEXT(1000), created_at DATETIME
```

**Notification:** When client acknowledges or replies, internal ops team gets an in-app notification (future: email).

---

## 11. New Backend Modules Required

### 11.1 `client_portal` module — new SQL file (`012_client_portal.sql`)

`process_master` currently has no client linkage. The SQL migration adds:
1. `client_master` — one row per client company (Airtel, Jio, etc.)
2. `client_id` column on `process_master` — FK to `client_master`

```sql
CREATE TABLE client_master (
  id           CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  client_code  VARCHAR(50) NOT NULL UNIQUE,
  client_name  VARCHAR(255) NOT NULL,
  active_status TINYINT(1) NOT NULL DEFAULT 1,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE process_master
  ADD COLUMN client_id CHAR(36) NULL,
  ADD FOREIGN KEY (client_id) REFERENCES client_master(id) ON DELETE SET NULL;

CREATE TABLE client_user (
  id           CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  client_id    CHAR(36) NOT NULL,
  FOREIGN KEY (client_id) REFERENCES client_master(id) ON DELETE CASCADE,
  email        VARCHAR(255) NOT NULL UNIQUE,
  name         VARCHAR(255) NOT NULL,
  designation  VARCHAR(255),
  process_ids  JSON NOT NULL,            -- array of process_master IDs this user can view
  is_active    TINYINT(1) NOT NULL DEFAULT 1,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE portal_otp (
  id         CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  email      VARCHAR(255) NOT NULL,
  otp_hash   VARCHAR(255) NOT NULL,      -- bcrypt hash of 6-digit OTP
  expires_at DATETIME NOT NULL,
  used       TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_portal_otp_email (email)
);

CREATE TABLE portal_access_log (
  id              CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  client_user_id  CHAR(36) NOT NULL,
  page            VARCHAR(255) NOT NULL,
  ip_address      VARCHAR(45),
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pal_user (client_user_id),
  INDEX idx_pal_time (created_at)
);
```

### 11.2 `glide_path` module — tables added to `012_client_portal.sql`

```sql
CREATE TABLE glide_path_commitment (
  id            CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  process_id    CHAR(36) NOT NULL,
  metric_id     CHAR(36) NOT NULL,
  month         CHAR(7) NOT NULL,        -- YYYY-MM
  committed_value DECIMAL(12,4) NOT NULL,
  committed_by  CHAR(36) NOT NULL,       -- internal user_id
  is_locked     TINYINT(1) NOT NULL DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_glide (process_id, metric_id, month)
);
```

### 11.3 `action_plan` table — added to `012_client_portal.sql`

(Schema shown in Section 7 above)

### 11.4 `governance` tables — added to `012_client_portal.sql`

(Schema shown in Section 8 above)

### 11.5 `management_commentary` tables — added to `012_client_portal.sql`

(Schema shown in Section 10 above)

---

## 12. API Endpoints

### Auth (public)
```
POST /api/portal/auth/request-otp    { email }
POST /api/portal/auth/verify-otp     { email, otp }  → { token }
```

### Portal (requires client JWT)
```
GET  /api/portal/overview                         → all processes for this client
GET  /api/portal/processes/:id/kpis?period=YYYY-MM
GET  /api/portal/processes/:id/glide-paths?period=YYYY-MM
GET  /api/portal/processes/:id/action-plans
GET  /api/portal/processes/:id/governance?period=YYYY-MM
GET  /api/portal/processes/:id/attrition?period=YYYY-MM
GET  /api/portal/processes/:id/commentary?period=YYYY-MM
POST /api/portal/commentary/:id/acknowledge
POST /api/portal/commentary/:id/reply             { text }
```

### Internal ops (requires internal staff JWT)
```
GET/POST/PUT /api/internal/glide-paths
GET/POST/PUT /api/internal/action-plans
GET/POST/PUT /api/internal/governance
GET/POST/PUT /api/internal/commentary
GET/POST     /api/internal/client-users
```

---

## 13. Frontend Routes

New React routes added to existing Vite SPA:

```
/portal/login                → OTP login page
/portal                      → Account overview
/portal/processes/:id        → Process dashboard (tabbed)
```

Existing internal routes (`/dashboard`, `/payroll`, etc.) unaffected.

**Auth guard:** `PortalRoute` HOC checks for `portal_token` in localStorage; redirects to `/portal/login` if absent or expired.

**Separate JWT namespace:** Portal JWT uses claim `role: 'client'`; internal JWT uses `role: 'staff'`. The same backend validates both but routes are separated.

---

## 14. Security Considerations

- OTP hashed with bcrypt before storage; plaintext never stored
- Portal JWT signed with a separate secret (`PORTAL_JWT_SECRET`) from internal JWT (`JWT_SECRET`)
- `process_ids` claim in JWT validated server-side on every request (client cannot access processes not in their list)
- All portal API responses strip internal fields: employee IDs, salary data, internal user IDs
- Rate limit OTP requests: max 3 per email per 15 minutes
- `portal_access_log` retained for 90 days

---

## 15. Data Flow Summary

```
Client browser
  → POST /portal/auth/verify-otp
  → receives JWT { clientUserId, clientId, processIds: ["p1","p2"] }
  → GET /portal/overview
      → backend: SELECT from process_master WHERE id IN (processIds)
      → for each process: fetch latest kpi_score, compute RAG
  → GET /portal/processes/p1/kpis?period=2026-05
      → JOIN kpi_score + kpi_metric_master + kpi_template_metric
      → compute achievement % per metric, apply RAG thresholds
  → GET /portal/processes/p1/glide-paths?period=2026-05
      → JOIN glide_path_commitment + kpi_score for last 3 months + next 3 committed
  → GET /portal/processes/p1/action-plans
      → SELECT from action_plan WHERE process_id = p1
  → GET /portal/processes/p1/governance?period=2026-05
      → JOIN governance_activity_master + governance_checklist_log
  → GET /portal/processes/p1/attrition?period=2026-05
      → aggregate employees + exit_management data
  → GET /portal/processes/p1/commentary?period=2026-05
      → SELECT from management_commentary + replies
```

---

## 16. Implementation Phases

**Phase 1 — Foundation (auth + overview)**
- SQL: `012_client_portal.sql` (client_user, portal_otp, portal_access_log)
- Backend: `portal/auth` module (request-otp, verify-otp, JWT middleware)
- Backend: `portal/overview` endpoint
- Frontend: `/portal/login` page, `/portal` overview page

**Phase 2 — Process Dashboard tabs 1-2 (KPIs + Glide Paths)**
- SQL: glide_path_commitment table
- Backend: `/processes/:id/kpis`, `/processes/:id/glide-paths`
- Backend: internal glide-path CRUD
- Frontend: Process dashboard shell, Performance tab, Glide Paths tab

**Phase 3 — Action Plans + Governance**
- SQL: action_plan, governance tables
- Backend: action-plans + governance endpoints (portal read + internal write)
- Frontend: Action Plans tab, Governance tab

**Phase 4 — Attrition + Commentary**
- Backend: attrition aggregation endpoint (uses existing exit_management data)
- SQL: management_commentary + replies tables
- Backend: commentary endpoints, acknowledge, reply
- Frontend: Attrition tab, Commentary tab with acknowledge/reply UI

---

## 17. Out of Scope (Explicitly)

- Push notifications / SMS OTP (email OTP only in v1)
- Client-side data export to PDF (printable view only via browser print)
- Internal staff accessing portal with their login (separate login page exists)
- Real-time websocket updates (HTTP polling or manual refresh only in v1)
- Multi-language support
