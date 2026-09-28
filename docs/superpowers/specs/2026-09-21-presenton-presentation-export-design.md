# Presenton Presentation Export — Design Spec
**Date:** 2026-09-21  
**Module:** Client Portal → Export as Presentation  
**Status:** Approved for implementation

---

## 1. Overview

Add an "Export as Presentation" feature to the HRMS Client Portal powered by [Presenton](https://github.com/Presenton/presenton) — a self-hosted, AI-driven `.pptx` / `.pdf` generator.

Clients and admins can export a polished PowerPoint presentation of any client's portal data for any period. Two deck types are supported:

- **Client Summary Deck** — all LOBs for a client, ~8 slides
- **Per-Process Deck** — single LOB deep-dive, ~10 slides

Phase 2 (out of scope here): monthly scheduled auto-generation + email delivery.

---

## 2. Architecture

```
Frontend (PortalOverview / PortalProcessDashboard / SuperAdminClientPortalAccess)
    │  "Export as Presentation" button → ExportPresentationModal
    │  { clientId, processId?, periodType, periodStart, periodEnd, scope }
    ▼
POST /api/presentations/generate   (Express backend)
    │
    ├─ 1. Auth check (portal JWT → own clientId only; admin JWT → any clientId)
    ├─ 2. Fetch portal data via portal services (direct function calls, no HTTP)
    ├─ 3. Build Markdown slide arrays (presentation.slides.ts)
    ├─ 4. POST to Presenton API at http://localhost:8000
    ├─ 5. Poll Presenton until done (max 60s, 2s interval)
    ├─ 6. Download .pptx binary from Presenton
    ├─ 7. Save to uploads/presentations/<clientId>/<filename>
    └─ 8. Return { fileUrl, filename }
    ▼
Frontend: download button → file served via /api/files/*
```

**Presenton** runs as a Docker sidecar on the same server at `http://localhost:8000`. It is never exposed to the internet. The Express backend is the only caller.

**LLM:** Presenton uses the locally installed LLM (Ollama-compatible endpoint already on server). No new LLM cost or external API calls.

---

## 3. New Files

### Backend — `backend/src/modules/presentation/`

| File | Responsibility |
|------|---------------|
| `presentation.routes.ts` | `POST /api/presentations/generate` |
| `presentation.controller.ts` | Request parsing, auth, response shaping |
| `presentation.service.ts` | Orchestrates fetch → build → Presenton call → file save |
| `presentation.slides.ts` | Pure functions: portal data → Markdown slide arrays |
| `presenton.client.ts` | Presenton REST API client (generate, poll, download) |

Register in `backend/src/index.ts`:
```ts
import presentationRoutes from './modules/presentation/presentation.routes'
app.use('/api/presentations', requireAuth, presentationRoutes)
```

### Frontend — `src/components/presentation/`

| File | Responsibility |
|------|---------------|
| `ExportPresentationButton.tsx` | Button that opens modal; accepts `clientId`, optional `processId` |
| `ExportPresentationModal.tsx` | Period picker + scope toggle + Generate/Download flow |

### Infrastructure

| File | Purpose |
|------|---------|
| `docker-compose.presenton.yml` | Presenton Docker sidecar (standalone, not merged into existing compose) |

---

## 4. API Contract

### Request
```
POST /api/presentations/generate
Authorization: Bearer <jwt>

{
  "clientId": number,
  "processId": number | null,      // null = client summary deck
  "scope": "client" | "process",
  "periodType": "last_month" | "current_month" | "custom",
  "periodStart": "YYYY-MM-DD",    // resolved from periodType by backend
  "periodEnd":   "YYYY-MM-DD"
}
```

### Response (success)
```json
{
  "success": true,
  "data": {
    "fileUrl": "/api/files/presentations/<clientId>/<filename>",
    "filename": "<ClientName>-Summary-Aug-2026.pptx"
  }
}
```

### Response (error)
```json
{ "success": false, "error": "<message>" }
```

---

## 5. Slide Structure

### Client Summary Deck (~8 slides)
Filename: `<ClientName>-Summary-<MonthYear>.pptx`

| # | Title | Data Source |
|---|-------|-------------|
| 1 | Cover | Static: client name, period, MAS Callnet |
| 2 | Executive Summary | `ProcessCard[]` — RAG status, LLM narrates wins/risks |
| 3 | Process Scorecard | `ProcessCard[]` — all LOBs as RAG traffic-light table |
| 4 | Headcount & Attrition | `AttritionData` across all processes |
| 5 | Training Compliance | `TrainingComplianceData` — %, breached count, by severity |
| 6 | Open Action Plans | `ActionPlanItem[]` — owner, due date, status |
| 7 | Governance Calendar | `GovernanceActivity[]` — completion % |
| 8 | Next Review / Closing | Static + latest published `Commentary` |

### Per-Process Deck (~10 slides)
Filename: `<ClientName>-<ProcessName>-<MonthYear>.pptx`

| # | Title | Data Source |
|---|-------|-------------|
| 1 | Cover | Static: process, client, period |
| 2 | KPI Scorecard | `PortalKpiMetric[]` — actual vs target, RAG |
| 3 | Performance Trend | `GlidePathsResult` — actual/committed/target series |
| 4 | Workforce | `AttritionData` — headcount, open positions, avg tenure |
| 5 | Attrition | `AttritionData` — % trend, top 3 exit reasons |
| 6 | Training Compliance | `TrainingComplianceData` — mandatory %, breached |
| 7 | Quality & Operations | Portal quality service KPIs |
| 8 | Action Plans | `ActionPlanItem[]` — open items |
| 9 | Client Commentary | `Commentary[]` — published remarks |
| 10 | Next Steps | LLM-generated from action plans + RAG |

**No-data rule:** Metrics with `no_data_reason` render "Data not available for this period" — never blank, never hidden, generation always proceeds.

---

## 6. Period Picker

The modal offers three modes:

1. **Last completed month** — quick-pick, no date input
2. **Current month (partial)** — quick-pick, labelled "as of today"
3. **Custom** — month + year dropdowns (closed set, never free text per Form Input Rule)

Backend resolves `periodType` → `periodStart` / `periodEnd` before any portal service call.

---

## 7. UI Entry Points (no new pages)

| Page | Button label | Scope |
|------|-------------|-------|
| `PortalOverview.tsx` — page header action bar | "Export Client Report" | `scope: "client"` |
| `PortalProcessDashboard.tsx` — process header | "Export Process Report" | `scope: "process"` |
| `SuperAdminClientPortalAccess.tsx` — same positions when impersonating | Both buttons | Both scopes |

---

## 8. Authorization

| Actor | Rule |
|-------|------|
| Portal JWT (client role) | `clientId` fixed to `req.portalUser.clientId` — body value ignored |
| Admin JWT (`super_admin`, `hr_admin`) | Any `clientId`, validated against `portal_clients` table |
| All other roles | 403 Forbidden |

Generated files stored under `uploads/presentations/<clientId>/` — served via existing `/api/files/*` auth middleware (client can only access their own folder).

`PRESENTON_API_KEY` lives in `backend/.env` only. Never returned in any response, never logged.

---

## 9. Error Handling

| Condition | HTTP | Message |
|-----------|------|---------|
| Presenton container not running | 503 | "Presentation service temporarily unavailable" |
| Generation timeout (>60s) | 504 | "Generation timed out, please retry" |
| Invalid `clientId` (admin path) | 404 | "Client not found" |
| No portal data for period | 422 | "No portal data found for the selected period" |
| Partial data (`no_data_reason`) | 200 | Generation proceeds with placeholder text on affected slides |

---

## 10. File Storage

```
uploads/
  presentations/
    <clientId>/
      <ClientName>-Summary-<YYYY-MM>.pptx
      <ClientName>-<ProcessName>-<YYYY-MM>.pptx
```

Served via existing `/api/files/*` endpoint with standard auth middleware.

---

## 11. New Environment Variables

```env
# backend/.env
PRESENTON_API_URL=http://localhost:8000
PRESENTON_API_KEY=sk-presenton-...
```

---

## 12. Docker Sidecar

`docker-compose.presenton.yml` at repo root — standalone file, not merged into any existing compose configuration.

Presenton configured with:
- Local Ollama endpoint as LLM provider
- `PRESENTON_API_KEY` matching backend env var
- Volume mount for generated files (optional — backend downloads via API)

---

## 13. Phase 2 (Out of Scope Now)

Scheduled monthly auto-generation: `presentation.service.ts` generate function is designed to be called from a cron job with no signature changes. No code for this in Phase 1.

---

## 14. Out of Scope

- PDF export (PPTX only in Phase 1)
- Email delivery
- Presentation history / gallery page
- Custom branding / template uploads
- Rebuilding or modifying the Presenton codebase
