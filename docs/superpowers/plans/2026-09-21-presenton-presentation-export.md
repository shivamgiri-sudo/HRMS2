# Presenton Presentation Export — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Export as Presentation" to the HRMS Client Portal — generates a polished `.pptx` from live portal data via a self-hosted Presenton Docker sidecar, triggered by both clients and admins.

**Architecture:** Express backend orchestrates everything: fetches portal data by calling portal services directly (no HTTP round-trip), builds Markdown slide arrays, POSTs to Presenton's async API, polls until done, downloads the `.pptx` binary, saves to `uploads/presentations/<clientId>/`, returns a download URL. Frontend never touches Presenton directly. Two deck types: client summary (~8 slides) and per-process drilldown (~10 slides).

**Tech Stack:** Express + TypeScript, React 18 + TypeScript + Tailwind + shadcn/Radix, Presenton Docker sidecar (FastAPI), Ollama (local LLM, already running on server), Node.js `fs` for file I/O, `node-fetch` / native `fetch` for HTTP calls to Presenton.

---

## Global Constraints

- `clientId` and `processId` are `string` throughout — matching existing portal JWT types (`PortalTokenPayload.clientId: string`)
- Period passed to portal services is `"YYYY-MM"` format (e.g. `"2026-08"`)
- New backend files: `backend/src/modules/presentation/`
- New frontend files: `src/components/presentation/`
- No new pages — buttons added to existing portal pages only
- Presenton sidecar runs at `http://localhost:8000` with `DISABLE_AUTH=true` (loopback only, never internet-exposed)
- Generated files saved to `uploads/presentations/<clientId>/` and served via a dedicated authenticated GET route in the presentation module
- Portal JWT users: `requireClientAuth` (from `backend/src/middleware/requireClientAuth.ts`)
- Admin users: `requireAuth` + `requireRole('super_admin', 'hr_admin')`
- No mutations to existing portal services, routes, or types files
- `npm run build` and `cd backend && npx tsc --noEmit` must pass after every task

---

## File Map

### New — Backend
| Path | Responsibility |
|------|----------------|
| `backend/src/modules/presentation/presenton.client.ts` | Presenton HTTP client (async generate, poll, download) |
| `backend/src/modules/presentation/presentation.slides.ts` | Pure functions: portal data → Markdown slide arrays |
| `backend/src/modules/presentation/presentation.service.ts` | Orchestrates fetch → build → generate → save |
| `backend/src/modules/presentation/presentation.controller.ts` | Auth routing, request parsing, response shaping |
| `backend/src/modules/presentation/presentation.routes.ts` | Route declarations |
| `backend/src/modules/presentation/__tests__/presenton.client.test.ts` | Unit tests for Presenton client |
| `backend/src/modules/presentation/__tests__/presentation.slides.test.ts` | Unit tests for slide builder |
| `backend/src/modules/presentation/__tests__/presentation.service.test.ts` | Unit tests for presentation service |

### Modified — Backend
| Path | Change |
|------|--------|
| `backend/src/app.ts` | Register `presentationRouter` before the catch-all `clientRouter` |
| `backend/.env.example` | Add `PRESENTON_API_URL` |

### New — Frontend
| Path | Responsibility |
|------|----------------|
| `src/lib/presentationApi.ts` | `generatePresentation(req)` → calls `/api/presentations/generate` |
| `src/components/presentation/ExportPresentationModal.tsx` | Period picker + Generate button + loading + download link |
| `src/components/presentation/ExportPresentationButton.tsx` | Trigger button that opens the modal |

### Modified — Frontend
| Path | Change |
|------|--------|
| `src/pages/portal/PortalOverview.tsx` | Add "Export Client Report" button in page header |
| `src/pages/portal/PortalProcessDashboard.tsx` | Add "Export Process Report" button in process header |
| `src/pages/portal/SuperAdminClientPortalAccess.tsx` | Add both buttons when impersonating |

### New — Infrastructure
| Path | Responsibility |
|------|----------------|
| `docker-compose.presenton.yml` | Presenton Docker sidecar, standalone file |

---

## Task 1: Docker Sidecar + Env Vars

**Files:**
- Create: `docker-compose.presenton.yml`
- Modify: `backend/.env.example`

**Interfaces:**
- Produces: Presenton accessible at `http://localhost:8000`

- [ ] **Step 1: Create docker-compose.presenton.yml**

```yaml
# docker-compose.presenton.yml
# Run with: docker compose -f docker-compose.presenton.yml up -d
# Presenton runs on loopback only — never expose port 8000 to the internet.
version: "3.8"

services:
  presenton:
    image: presenton/presenton:latest
    container_name: hrms_presenton
    restart: unless-stopped
    ports:
      - "127.0.0.1:8000:8000"
    environment:
      - DISABLE_AUTH=true
      - LLM=ollama
      - OLLAMA_URL=http://host.docker.internal:11434
      - OLLAMA_MODEL=${PRESENTON_OLLAMA_MODEL:-llama3.2}
      - APP_DATA_DIR=/app_data
    volumes:
      - presenton_data:/app_data
    extra_hosts:
      - "host.docker.internal:host-gateway"

volumes:
  presenton_data:
```

- [ ] **Step 2: Add env vars to backend/.env.example**

Open `backend/.env.example`. After the `OPENAI_API_KEY=` line, add:

```
# Presenton sidecar (self-hosted AI presentation generator)
PRESENTON_API_URL=http://localhost:8000
PRESENTON_OLLAMA_MODEL=llama3.2
```

Also add to your actual `backend/.env`:
```
PRESENTON_API_URL=http://localhost:8000
PRESENTON_OLLAMA_MODEL=llama3.2
```
Replace `llama3.2` with whatever model name your Ollama instance has loaded (run `ollama list` to check).

- [ ] **Step 3: Start Presenton and verify it responds**

```bash
docker compose -f docker-compose.presenton.yml up -d
sleep 5
curl -s http://localhost:8000/api/v1/ppt/health || curl -s http://localhost:8000/health
```

Expected: some JSON response (200 OK). If it returns anything other than a connection error, Presenton is running.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.presenton.yml backend/.env.example
git commit -m "chore: add Presenton Docker sidecar and env vars"
```

---

## Task 2: Presenton HTTP Client

**Files:**
- Create: `backend/src/modules/presentation/presenton.client.ts`
- Create: `backend/src/modules/presentation/__tests__/presenton.client.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  presentonClient.generateAsync(slidesMarkdown: string[], summary: string): Promise<string>
  // returns taskId

  presentonClient.pollUntilDone(taskId: string, maxMs?: number): Promise<string>
  // returns file path like "/app_data/exports/users/.../file.pptx"

  presentonClient.downloadFile(filePath: string): Promise<Buffer>
  ```

- [ ] **Step 1: Write the failing tests**

Create `backend/src/modules/presentation/__tests__/presenton.client.test.ts`:

```typescript
import { jest } from '@jest/globals'

// We mock global fetch so no real HTTP is made
const mockFetch = jest.fn()
global.fetch = mockFetch as any

import { presenton } from '../presenton.client.js'

beforeEach(() => {
  jest.clearAllMocks()
  process.env.PRESENTON_API_URL = 'http://localhost:8000'
})

describe('presenton.generateAsync', () => {
  it('posts to async generate endpoint and returns taskId', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'task-abc123', status: 'pending' }),
    } as any)

    const taskId = await presenton.generateAsync(
      ['# Slide 1\ncontent', '# Slide 2\ncontent'],
      'Test summary'
    )

    expect(taskId).toBe('task-abc123')
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8000/api/v1/ppt/presentation/generate/async',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('throws PresentonUnavailableError when fetch rejects', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    await expect(
      presenton.generateAsync(['# Slide\ncontent'], 'summary')
    ).rejects.toThrow('Presentation service temporarily unavailable')
  })
})

describe('presenton.pollUntilDone', () => {
  it('returns path when task completes', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'task-abc123',
        status: 'completed',
        data: { path: '/app_data/exports/users/1/file.pptx' },
      }),
    } as any)

    const path = await presenton.pollUntilDone('task-abc123')
    expect(path).toBe('/app_data/exports/users/1/file.pptx')
  })

  it('throws on task error status', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'task-abc123',
        status: 'error',
        error: { detail: 'LLM failed' },
      }),
    } as any)

    await expect(presenton.pollUntilDone('task-abc123')).rejects.toThrow('Generation failed')
  })
})

describe('presenton.downloadFile', () => {
  it('returns a Buffer with the file bytes', async () => {
    const fakeBytes = Buffer.from('PK fake pptx bytes')
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => fakeBytes.buffer,
    } as any)

    const buf = await presenton.downloadFile('/app_data/exports/users/1/file.pptx')
    expect(buf).toBeInstanceOf(Buffer)
    expect(buf.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd backend
npx jest src/modules/presentation/__tests__/presenton.client.test.ts --no-coverage 2>&1 | tail -10
```

Expected: `Cannot find module '../presenton.client.js'`

- [ ] **Step 3: Implement presenton.client.ts**

Create `backend/src/modules/presentation/presenton.client.ts`:

```typescript
import { env } from '../../config/env.js'

export class PresentonUnavailableError extends Error {
  constructor() { super('Presentation service temporarily unavailable') }
}
export class PresentonGenerationError extends Error {
  constructor(detail: string) { super(`Generation failed: ${detail}`) }
}
export class PresentonTimeoutError extends Error {
  constructor() { super('Generation timed out, please retry') }
}

function baseUrl(): string {
  return (process.env.PRESENTON_API_URL ?? 'http://localhost:8000').replace(/\/$/, '')
}

async function safeFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch {
    throw new PresentonUnavailableError()
  }
}

export const presenton = {
  async generateAsync(slidesMarkdown: string[], summary: string): Promise<string> {
    const res = await safeFetch(`${baseUrl()}/api/v1/ppt/presentation/generate/async`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: summary,
        slides_markdown: slidesMarkdown,
        tone: 'professional',
        verbosity: 'standard',
        export_as: 'pptx',
        include_title_slide: false,
      }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new PresentonGenerationError(`HTTP ${res.status}: ${text.slice(0, 200)}`)
    }
    const body = (await res.json()) as { id: string }
    return body.id
  },

  async pollUntilDone(taskId: string, maxMs = 60_000): Promise<string> {
    const deadline = Date.now() + maxMs
    const INTERVAL = 2_000

    while (Date.now() < deadline) {
      const res = await safeFetch(`${baseUrl()}/api/v1/async-tasks/status/${taskId}`)
      if (!res.ok) throw new PresentonGenerationError(`Poll HTTP ${res.status}`)

      const task = (await res.json()) as {
        status: string
        data?: { path?: string }
        error?: { detail?: string }
      }

      if (task.status === 'completed') {
        const path = task.data?.path
        if (!path) throw new PresentonGenerationError('Completed but no path returned')
        return path
      }
      if (task.status === 'error') {
        throw new PresentonGenerationError(task.error?.detail ?? 'Unknown error')
      }
      // status is 'pending' — wait and retry
      await new Promise(r => setTimeout(r, INTERVAL))
    }

    throw new PresentonTimeoutError()
  },

  async downloadFile(filePath: string): Promise<Buffer> {
    const res = await safeFetch(`${baseUrl()}${filePath}`)
    if (!res.ok) throw new PresentonGenerationError(`Download HTTP ${res.status}`)
    const ab = await res.arrayBuffer()
    return Buffer.from(ab)
  },
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd backend
npx jest src/modules/presentation/__tests__/presenton.client.test.ts --no-coverage 2>&1 | tail -10
```

Expected: `Tests: 5 passed`

- [ ] **Step 5: Type-check**

```bash
cd backend && npx tsc --noEmit 2>&1 | head -20
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/presentation/presenton.client.ts \
        backend/src/modules/presentation/__tests__/presenton.client.test.ts
git commit -m "feat(presentation): add Presenton HTTP client with async generate + poll"
```

---

## Task 3: Slide Content Builder

**Files:**
- Create: `backend/src/modules/presentation/presentation.slides.ts`
- Create: `backend/src/modules/presentation/__tests__/presentation.slides.test.ts`

**Interfaces:**
- Consumes: types from `../portal/portal.types.js` — `ProcessCard`, `AttritionData`, `TrainingComplianceData`, `ActionPlanItem`, `GovernanceActivity`, `Commentary`, `GlidePathsResult`, `PortalRag`
- Produces:
  ```typescript
  buildClientSummarySlides(input: ClientSummaryInput): string[]
  buildProcessDeckSlides(input: ProcessDeckInput): string[]

  interface ClientSummaryInput {
    clientName: string
    periodLabel: string
    processCards: ProcessCard[]
    attritionByProcess: Array<{ processName: string; data: AttritionData | null }>
    trainingByProcess: Array<{ processName: string; data: TrainingComplianceData | null }>
    allActionPlans: ActionPlanItem[]
    governanceByProcess: Array<{ processName: string; activities: GovernanceActivity[] }>
    latestCommentary: Commentary | null
  }

  interface ProcessDeckInput {
    clientName: string
    processName: string
    periodLabel: string
    kpis: Array<{
      metric_name: string; actual: number | null; target: number;
      rag: string; no_data_reason: string | null; unit: string
    }>
    glidePaths: GlidePathsResult
    attrition: AttritionData | null
    trainingCompliance: TrainingComplianceData | null
    actionPlans: ActionPlanItem[]
    governance: GovernanceActivity[]
    commentary: Commentary | null
  }
  ```

- [ ] **Step 0: Verify GlidePath field names**

Before writing code, confirm the exact `GlidePath` type fields in `backend/src/modules/portal/portal.types.ts`:

```bash
grep -A 10 "interface GlidePath" backend/src/modules/portal/portal.types.ts
```

The slides builder uses `p.data_points` and `d.period`, `d.actual`, `d.committed`, `d.target`. If the actual fields are named differently (e.g. `points`, `month`, `value`), update the `buildProcessDeckSlides` trend slide accordingly before running tests.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/modules/presentation/__tests__/presentation.slides.test.ts`:

```typescript
import { buildClientSummarySlides, buildProcessDeckSlides } from '../presentation.slides.js'
import type { ClientSummaryInput, ProcessDeckInput } from '../presentation.slides.js'

const minimalClientInput: ClientSummaryInput = {
  clientName: 'Acme Corp',
  periodLabel: 'August 2026',
  processCards: [
    {
      process_id: 'p1',
      process_name: 'Inbound',
      client_name: 'Acme Corp',
      rag: 'green',
      headline_metrics: [],
      last_updated: null,
    },
  ],
  attritionByProcess: [{ processName: 'Inbound', data: null }],
  trainingByProcess: [{ processName: 'Inbound', data: null }],
  allActionPlans: [],
  governanceByProcess: [{ processName: 'Inbound', activities: [] }],
  latestCommentary: null,
}

const minimalProcessInput: ProcessDeckInput = {
  clientName: 'Acme Corp',
  processName: 'Inbound',
  periodLabel: 'August 2026',
  kpis: [
    { metric_name: 'CSAT', actual: 85, target: 90, rag: 'amber', no_data_reason: null, unit: '%' },
    { metric_name: 'AHT',  actual: null, target: 300, rag: 'no_data', no_data_reason: 'No data loaded', unit: 'sec' },
  ],
  glidePaths: { hasConfiguredMetrics: false, paths: [] },
  attrition: null,
  trainingCompliance: null,
  actionPlans: [],
  governance: [],
  commentary: null,
}

describe('buildClientSummarySlides', () => {
  it('returns 8 slides', () => {
    const slides = buildClientSummarySlides(minimalClientInput)
    expect(slides).toHaveLength(8)
  })

  it('slide 1 contains client name and period', () => {
    const slides = buildClientSummarySlides(minimalClientInput)
    expect(slides[0]).toContain('Acme Corp')
    expect(slides[0]).toContain('August 2026')
  })

  it('each slide is a non-empty string', () => {
    const slides = buildClientSummarySlides(minimalClientInput)
    slides.forEach(s => expect(s.trim().length).toBeGreaterThan(10))
  })
})

describe('buildProcessDeckSlides', () => {
  it('returns 10 slides', () => {
    const slides = buildProcessDeckSlides(minimalProcessInput)
    expect(slides).toHaveLength(10)
  })

  it('slide 1 contains process name and client name', () => {
    const slides = buildProcessDeckSlides(minimalProcessInput)
    expect(slides[0]).toContain('Inbound')
    expect(slides[0]).toContain('Acme Corp')
  })

  it('renders no_data_reason for metrics with no actual', () => {
    const slides = buildProcessDeckSlides(minimalProcessInput)
    const kpiSlide = slides[1]
    expect(kpiSlide).toContain('AHT')
    expect(kpiSlide).toContain('Data not available')
  })

  it('renders actual value for metrics with data', () => {
    const slides = buildProcessDeckSlides(minimalProcessInput)
    const kpiSlide = slides[1]
    expect(kpiSlide).toContain('CSAT')
    expect(kpiSlide).toContain('85')
  })
})
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd backend
npx jest src/modules/presentation/__tests__/presentation.slides.test.ts --no-coverage 2>&1 | tail -10
```

Expected: `Cannot find module '../presentation.slides.js'`

- [ ] **Step 3: Implement presentation.slides.ts**

Create `backend/src/modules/presentation/presentation.slides.ts`:

```typescript
import type {
  ProcessCard, AttritionData, TrainingComplianceData,
  ActionPlanItem, GovernanceActivity, Commentary, GlidePathsResult, PortalRag,
} from '../portal/portal.types.js'

export interface ClientSummaryInput {
  clientName: string
  periodLabel: string
  processCards: ProcessCard[]
  attritionByProcess: Array<{ processName: string; data: AttritionData | null }>
  trainingByProcess: Array<{ processName: string; data: TrainingComplianceData | null }>
  allActionPlans: ActionPlanItem[]
  governanceByProcess: Array<{ processName: string; activities: GovernanceActivity[] }>
  latestCommentary: Commentary | null
}

export interface ProcessDeckInput {
  clientName: string
  processName: string
  periodLabel: string
  kpis: Array<{
    metric_name: string
    actual: number | null
    target: number
    rag: string
    no_data_reason: string | null
    unit: string
  }>
  glidePaths: GlidePathsResult
  attrition: AttritionData | null
  trainingCompliance: TrainingComplianceData | null
  actionPlans: ActionPlanItem[]
  governance: GovernanceActivity[]
  commentary: Commentary | null
}

function ragEmoji(rag: string): string {
  if (rag === 'green') return '🟢'
  if (rag === 'amber') return '🟡'
  if (rag === 'red') return '🔴'
  return '⚪'
}

function naOr(val: number | null | undefined, suffix = ''): string {
  return val == null ? 'Data not available for this period' : `${val}${suffix}`
}

function pctOr(val: number | null | undefined): string {
  return val == null ? 'Data not available for this period' : `${val.toFixed(1)}%`
}

export function buildClientSummarySlides(input: ClientSummaryInput): string[] {
  const { clientName, periodLabel, processCards, attritionByProcess,
          trainingByProcess, allActionPlans, governanceByProcess, latestCommentary } = input

  // Slide 1 — Cover
  const cover = `# ${clientName} — Monthly Performance Review\n## ${periodLabel}\n\nPrepared by MAS Callnet PeopleOS\n\n*Confidential — for client use only*`

  // Slide 2 — Executive Summary
  const green = processCards.filter(p => p.rag === 'green').map(p => p.process_name)
  const amber = processCards.filter(p => p.rag === 'amber').map(p => p.process_name)
  const red   = processCards.filter(p => p.rag === 'red').map(p => p.process_name)
  const execSummary = [
    `# Executive Summary`,
    `## ${periodLabel}`,
    green.length ? `**On Track (🟢):** ${green.join(', ')}` : '',
    amber.length ? `**Needs Attention (🟡):** ${amber.join(', ')}` : '',
    red.length   ? `**At Risk (🔴):** ${red.join(', ')}` : '',
    `\n*Overall: ${processCards.length} process${processCards.length !== 1 ? 'es' : ''} reviewed*`,
  ].filter(Boolean).join('\n')

  // Slide 3 — Process Scorecard
  const scorecardRows = processCards.map(p =>
    `| ${p.process_name} | ${ragEmoji(p.rag)} ${p.rag.toUpperCase()} |`
  ).join('\n')
  const scorecard = `# Process Scorecard\n## ${periodLabel}\n\n| Process | Status |\n|---------|--------|\n${scorecardRows}`

  // Slide 4 — Headcount & Attrition
  const attrRows = attritionByProcess.map(({ processName, data }) => {
    if (!data) return `| ${processName} | Data not available for this period | — | — |`
    return `| ${processName} | ${data.headcount} | ${data.attrition_pct.toFixed(1)}% | ${data.avg_tenure_months.toFixed(1)} mo |`
  }).join('\n')
  const attrition = `# Headcount & Attrition\n## ${periodLabel}\n\n| Process | Headcount | Attrition | Avg Tenure |\n|---------|-----------|-----------|------------|\n${attrRows}`

  // Slide 5 — Training Compliance
  const trainRows = trainingByProcess.map(({ processName, data }) => {
    if (!data) return `| ${processName} | Data not available for this period | — | — |`
    return `| ${processName} | ${pctOr(data.compliance_pct)} | ${data.pending_mandatory_count} | ${data.breached_count} |`
  }).join('\n')
  const training = `# Training Compliance\n## ${periodLabel}\n\n| Process | Compliance | Pending Mandatory | Breached |\n|---------|------------|-------------------|----------|\n${trainRows}`

  // Slide 6 — Open Action Plans
  const openPlans = allActionPlans.filter(a => a.status !== 'done')
  const planRows = openPlans.length
    ? openPlans.map(a => `| ${a.metric_name} | ${a.action_text} | ${a.owner_name} | ${a.due_date} | ${a.status} |`).join('\n')
    : '| — | No open action plans | — | — | — |'
  const actions = `# Open Action Plans\n## ${periodLabel}\n\n| Metric | Action | Owner | Due | Status |\n|--------|--------|-------|-----|--------|\n${planRows}`

  // Slide 7 — Governance Calendar
  const govRows = governanceByProcess.flatMap(({ processName, activities }) =>
    activities.length === 0
      ? [`| ${processName} | Data not available for this period | — |`]
      : activities.map(g => `| ${processName} — ${g.activity_name} | ${g.completion_pct.toFixed(0)}% | ${ragEmoji(g.rag)} |`)
  ).join('\n')
  const governance = `# Governance Calendar\n## ${periodLabel}\n\n| Activity | Completion | Status |\n|----------|------------|--------|\n${govRows}`

  // Slide 8 — Next Review / Closing
  const commentaryText = latestCommentary
    ? `> "${latestCommentary.body}"\n> — ${latestCommentary.author_name}, ${latestCommentary.author_designation}`
    : '*No published commentary for this period.*'
  const closing = `# Next Steps & Closing\n\n${commentaryText}\n\n---\n\n*Thank you for your partnership. Next review: ${periodLabel}.*\n\nMAS Callnet PeopleOS`

  return [cover, execSummary, scorecard, attrition, training, actions, governance, closing]
}

export function buildProcessDeckSlides(input: ProcessDeckInput): string[] {
  const { clientName, processName, periodLabel, kpis, glidePaths,
          attrition, trainingCompliance, actionPlans, governance, commentary } = input

  // Slide 1 — Cover
  const cover = `# ${processName}\n## ${clientName} | ${periodLabel}\n\nProcess Performance Review\n\nPrepared by MAS Callnet PeopleOS`

  // Slide 2 — KPI Scorecard
  const kpiRows = kpis.map(k => {
    const actual = k.actual == null ? 'Data not available for this period' : `${k.actual} ${k.unit}`
    const target = `${k.target} ${k.unit}`
    return `| ${k.metric_name} | ${actual} | ${target} | ${ragEmoji(k.rag)} |`
  }).join('\n')
  const kpiSlide = `# KPI Scorecard\n## ${processName} | ${periodLabel}\n\n| Metric | Actual | Target | Status |\n|--------|--------|--------|--------|\n${kpiRows}`

  // Slide 3 — Performance Trend (Glide Paths)
  let trendContent: string
  if (!glidePaths.hasConfiguredMetrics || glidePaths.paths.length === 0) {
    trendContent = '*No glide path data configured for this process.*'
  } else {
    trendContent = glidePaths.paths.map(p => {
      const rows = p.data_points.map(d =>
        `| ${d.period} | ${d.actual ?? '—'} | ${d.committed ?? '—'} | ${d.target ?? '—'} |`
      ).join('\n')
      return `### ${p.metric_name}\n\n| Period | Actual | Committed | Target |\n|--------|--------|-----------|--------|\n${rows}`
    }).join('\n\n')
  }
  const trend = `# Performance Trend\n## ${processName} | ${periodLabel}\n\n${trendContent}`

  // Slide 4 — Workforce
  const workforce = attrition
    ? `# Workforce Overview\n## ${processName} | ${periodLabel}\n\n- **Headcount:** ${attrition.headcount}\n- **Sanctioned Strength:** ${attrition.sanctioned_strength ?? 'Not configured'}\n- **Open Positions:** ${attrition.open_positions ?? '—'}\n- **Avg Tenure:** ${attrition.avg_tenure_months.toFixed(1)} months`
    : `# Workforce Overview\n## ${processName} | ${periodLabel}\n\n*Data not available for this period.*`

  // Slide 5 — Attrition
  let attrSlide: string
  if (!attrition) {
    attrSlide = `# Attrition\n## ${processName} | ${periodLabel}\n\n*Data not available for this period.*`
  } else {
    const exitReasons = attrition.top_exit_reasons.length
      ? attrition.top_exit_reasons.map(r => `- ${r.reason}: ${r.count}`).join('\n')
      : '*No exit reason data available.*'
    attrSlide = `# Attrition\n## ${processName} | ${periodLabel}\n\n**Attrition Rate:** ${attrition.attrition_pct.toFixed(1)}%\n\n**Voluntary:** ${attrition.voluntary_count} | **Involuntary:** ${attrition.involuntary_count}\n\n**Top Exit Reasons:**\n${exitReasons}`
  }

  // Slide 6 — Training Compliance
  let trainSlide: string
  if (!trainingCompliance) {
    trainSlide = `# Training Compliance\n## ${processName} | ${periodLabel}\n\n*Data not available for this period.*`
  } else {
    const bySev = trainingCompliance.by_severity.length
      ? trainingCompliance.by_severity.map(s => `- **${s.severity}:** ${s.active_count} active`).join('\n')
      : ''
    trainSlide = `# Training Compliance\n## ${processName} | ${periodLabel}\n\n- **Compliance:** ${pctOr(trainingCompliance.compliance_pct)}\n- **Pending Mandatory:** ${trainingCompliance.pending_mandatory_count}\n- **Breached:** ${trainingCompliance.breached_count}\n\n${bySev}`
  }

  // Slide 7 — Quality & Operations (KPI subset)
  const qualKpis = kpis.filter(k =>
    ['csat', 'fcr', 'quality', 'qas', 'fatal'].some(q => k.metric_name.toLowerCase().includes(q))
  )
  const qualContent = qualKpis.length
    ? qualKpis.map(k => `- **${k.metric_name}:** ${k.actual == null ? 'Data not available for this period' : `${k.actual} ${k.unit}`} (target ${k.target} ${k.unit}) ${ragEmoji(k.rag)}`).join('\n')
    : '*No quality KPIs configured for this process.*'
  const quality = `# Quality & Operations\n## ${processName} | ${periodLabel}\n\n${qualContent}`

  // Slide 8 — Action Plans
  const openPlans = actionPlans.filter(a => a.status !== 'done')
  const planRows = openPlans.length
    ? openPlans.map(a => `| ${a.metric_name} | ${a.action_text} | ${a.owner_name} | ${a.due_date} | ${a.status} |`).join('\n')
    : '| — | No open action plans | — | — | — |'
  const actionsSlide = `# Action Plans\n## ${processName} | ${periodLabel}\n\n| Metric | Action | Owner | Due | Status |\n|--------|--------|-------|-----|--------|\n${planRows}`

  // Slide 9 — Client Commentary
  const commentarySlide = commentary
    ? `# Client Commentary\n## ${processName} | ${periodLabel}\n\n> "${commentary.body}"\n> — ${commentary.author_name}, ${commentary.author_designation}\n\n*Published: ${commentary.published_at}*`
    : `# Client Commentary\n## ${processName} | ${periodLabel}\n\n*No published commentary for this period.*`

  // Slide 10 — Next Steps
  const nextStepsItems = openPlans.slice(0, 5)
    .map(a => `- ${a.action_text} *(${a.owner_name}, due ${a.due_date})*`)
    .join('\n')
  const nextSteps = `# Next Steps\n## ${processName} | ${periodLabel}\n\n${nextStepsItems || '*No pending action items.*'}\n\n---\n\n*MAS Callnet PeopleOS — Confidential*`

  return [cover, kpiSlide, trend, workforce, attrSlide, trainSlide, quality, actionsSlide, commentarySlide, nextSteps]
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd backend
npx jest src/modules/presentation/__tests__/presentation.slides.test.ts --no-coverage 2>&1 | tail -10
```

Expected: `Tests: 8 passed`

- [ ] **Step 5: Type-check**

```bash
cd backend && npx tsc --noEmit 2>&1 | head -20
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/presentation/presentation.slides.ts \
        backend/src/modules/presentation/__tests__/presentation.slides.test.ts
git commit -m "feat(presentation): add slide content builder for client summary and process decks"
```

---

## Task 4: Presentation Service

**Files:**
- Create: `backend/src/modules/presentation/presentation.service.ts`
- Create: `backend/src/modules/presentation/__tests__/presentation.service.test.ts`

**Interfaces:**
- Consumes:
  - `presenton.generateAsync`, `presenton.pollUntilDone`, `presenton.downloadFile` from `./presenton.client.js`
  - `buildClientSummarySlides`, `buildProcessDeckSlides` from `./presentation.slides.js`
  - `portalOverviewService.getOverview` from `../portal/portal.overview.service.js`
  - `portalKpiService.getScorecards` from `../portal/portal.kpi.service.js`
  - `portalAttritionService.getAttrition` from `../portal/portal.attrition.service.js`
  - `portalTrainingComplianceService.getTrainingCompliance` from `../portal/portal.training-compliance.service.js`
  - `portalActionsService.list` from `../portal/portal.actions.service.js`
  - `portalGovernanceService.getChecklist` from `../portal/portal.governance.service.js`
  - `portalCommentaryService.get` from `../portal/portal.commentary.service.js`
  - `portalGlideService.getGlidePaths` from `../portal/portal.glide.service.js`
  - `db` pool from `../../db/mysql.js`
- Produces:
  ```typescript
  interface PresentationResult { fileUrl: string; filename: string }

  presentationService.resolvePeriod(
    periodType: 'last_month' | 'current_month' | 'custom',
    customPeriod?: string
  ): { period: string; label: string }

  presentationService.generateClientSummary(
    clientId: string,
    period: string,
    periodLabel: string,
    actorProcessIds: string[]
  ): Promise<PresentationResult>

  presentationService.generateProcessDeck(
    processId: string,
    clientId: string,
    period: string,
    periodLabel: string,
    actorProcessIds: string[]
  ): Promise<PresentationResult>
  ```

- [ ] **Step 1: Verify DB table for client→process mapping**

Before implementing, verify the table name:

```bash
mysql -u root -p mas_hrms -e "SHOW TABLES LIKE 'portal%';" 2>/dev/null
mysql -u root -p mas_hrms -e "DESCRIBE portal_client;" 2>/dev/null
```

You need to find how clients map to processes. Look for a table like `portal_client_process` or a `client_id` column in a `process` or `portal_process` table. If unsure, run:

```bash
mysql -u root -p mas_hrms -e "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME LIKE '%process%';" 2>/dev/null
```

Note the table name — you will use it in the `getClientProcessIds` helper in Step 3.

- [ ] **Step 2: Write the failing tests**

Create `backend/src/modules/presentation/__tests__/presentation.service.test.ts`:

```typescript
import { jest } from '@jest/globals'

// Mock all dependencies before importing the service
jest.mock('../presenton.client.js', () => ({
  presenton: {
    generateAsync: jest.fn().mockResolvedValue('task-abc'),
    pollUntilDone: jest.fn().mockResolvedValue('/app_data/exports/file.pptx'),
    downloadFile: jest.fn().mockResolvedValue(Buffer.from('fake pptx')),
  },
  PresentonUnavailableError: class extends Error {},
  PresentonTimeoutError: class extends Error {},
}))

jest.mock('../../db/mysql.js', () => ({
  db: {
    execute: jest.fn().mockResolvedValue([[{ process_id: 'p1', client_name: 'Acme', process_name: 'Inbound' }], []]),
  },
}))

jest.mock('../portal/portal.overview.service.js', () => ({
  portalOverviewService: {
    getOverview: jest.fn().mockResolvedValue([
      { process_id: 'p1', process_name: 'Inbound', client_name: 'Acme', rag: 'green', headline_metrics: [], last_updated: null }
    ]),
  },
}))

jest.mock('../portal/portal.kpi.service.js', () => ({
  portalKpiService: { getScorecards: jest.fn().mockResolvedValue([]) },
}))
jest.mock('../portal/portal.attrition.service.js', () => ({
  portalAttritionService: { getAttrition: jest.fn().mockRejectedValue(new Error('no data')) },
}))
jest.mock('../portal/portal.training-compliance.service.js', () => ({
  portalTrainingComplianceService: { getTrainingCompliance: jest.fn().mockRejectedValue(new Error('no data')) },
}))
jest.mock('../portal/portal.actions.service.js', () => ({
  portalActionsService: { list: jest.fn().mockResolvedValue([]) },
}))
jest.mock('../portal/portal.governance.service.js', () => ({
  portalGovernanceService: { getChecklist: jest.fn().mockResolvedValue([]) },
}))
jest.mock('../portal/portal.commentary.service.js', () => ({
  portalCommentaryService: { get: jest.fn().mockResolvedValue(null) },
}))
jest.mock('../portal/portal.glide.service.js', () => ({
  portalGlideService: { getGlidePaths: jest.fn().mockResolvedValue({ hasConfiguredMetrics: false, paths: [] }) },
}))
jest.mock('fs', () => ({
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
}))

import { presentationService } from '../presentation.service.js'

describe('presentationService.resolvePeriod', () => {
  it('last_month returns YYYY-MM of previous month', () => {
    const { period } = presentationService.resolvePeriod('last_month')
    const now = new Date()
    const expected = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      .toISOString().slice(0, 7)
    expect(period).toBe(expected)
  })

  it('current_month returns this YYYY-MM', () => {
    const { period } = presentationService.resolvePeriod('current_month')
    expect(period).toBe(new Date().toISOString().slice(0, 7))
  })

  it('custom returns provided period', () => {
    const { period } = presentationService.resolvePeriod('custom', '2026-06')
    expect(period).toBe('2026-06')
  })

  it('custom without period throws', () => {
    expect(() => presentationService.resolvePeriod('custom')).toThrow()
  })
})

describe('presentationService.generateClientSummary', () => {
  it('returns fileUrl and filename', async () => {
    const result = await presentationService.generateClientSummary(
      '1', '2026-08', 'August 2026', ['p1']
    )
    expect(result.fileUrl).toMatch(/\/api\/presentations\/download\/1\//)
    expect(result.filename).toMatch(/\.pptx$/)
  })
})

describe('presentationService.generateProcessDeck', () => {
  it('returns fileUrl and filename', async () => {
    const result = await presentationService.generateProcessDeck(
      'p1', '1', '2026-08', 'August 2026', ['p1']
    )
    expect(result.fileUrl).toMatch(/\/api\/presentations\/download\/1\//)
    expect(result.filename).toMatch(/\.pptx$/)
  })
})
```

- [ ] **Step 3: Run tests — expect failure**

```bash
cd backend
npx jest src/modules/presentation/__tests__/presentation.service.test.ts --no-coverage 2>&1 | tail -10
```

Expected: `Cannot find module '../presentation.service.js'`

- [ ] **Step 4: Implement presentation.service.ts**

Create `backend/src/modules/presentation/presentation.service.ts`:

```typescript
import fs from 'fs'
import path from 'path'
import { db } from '../../db/mysql.js'
import { presenton, PresentonUnavailableError, PresentonTimeoutError } from './presenton.client.js'
import { buildClientSummarySlides, buildProcessDeckSlides } from './presentation.slides.js'
import { portalOverviewService } from '../portal/portal.overview.service.js'
import { portalKpiService } from '../portal/portal.kpi.service.js'
import { portalAttritionService } from '../portal/portal.attrition.service.js'
import { portalTrainingComplianceService } from '../portal/portal.training-compliance.service.js'
import { portalActionsService } from '../portal/portal.actions.service.js'
import { portalGovernanceService } from '../portal/portal.governance.service.js'
import { portalCommentaryService } from '../portal/portal.commentary.service.js'
import { portalGlideService } from '../portal/portal.glide.service.js'

export interface PresentationResult { fileUrl: string; filename: string }

function formatMonthLabel(period: string): string {
  // period is "YYYY-MM"
  const [year, month] = period.split('-')
  const date = new Date(parseInt(year), parseInt(month) - 1, 1)
  return date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
}

function safeClientName(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-').slice(0, 40)
}

async function safeGet<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn() } catch { return null }
}

async function getClientProcessIds(clientId: string): Promise<string[]> {
  // IMPORTANT: verify table name with: SHOW TABLES LIKE 'portal%';
  // Adjust the query below if your table/column names differ.
  const [rows] = await db.execute<any[]>(
    `SELECT pp.process_id
     FROM portal_process pp
     JOIN portal_client pc ON pc.id = ?
     WHERE pp.client_id = pc.id`,
    [clientId]
  )
  return rows.map((r: any) => String(r.process_id))
}

async function getClientAndProcessName(
  clientId: string, processId: string
): Promise<{ clientName: string; processName: string }> {
  const [rows] = await db.execute<any[]>(
    `SELECT pc.client_name, pp.process_name
     FROM portal_process pp
     JOIN portal_client pc ON pc.id = pp.client_id
     WHERE pp.process_id = ? AND pc.id = ?
     LIMIT 1`,
    [processId, clientId]
  )
  if (!rows.length) return { clientName: 'Client', processName: 'Process' }
  return { clientName: rows[0].client_name, processName: rows[0].process_name }
}

async function getClientName(clientId: string): Promise<string> {
  const [rows] = await db.execute<any[]>(
    `SELECT client_name FROM portal_client WHERE id = ? LIMIT 1`,
    [clientId]
  )
  return rows[0]?.client_name ?? 'Client'
}

function saveFile(buffer: Buffer, clientId: string, filename: string): string {
  const dir = path.join(process.cwd(), 'uploads', 'presentations', clientId)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, filename), buffer)
  return `/api/presentations/download/${clientId}/${filename}`
}

export const presentationService = {
  resolvePeriod(
    periodType: 'last_month' | 'current_month' | 'custom',
    customPeriod?: string
  ): { period: string; label: string } {
    const now = new Date()
    if (periodType === 'current_month') {
      const period = now.toISOString().slice(0, 7)
      const today = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
      return { period, label: `${formatMonthLabel(period)} (as of ${today})` }
    }
    if (periodType === 'last_month') {
      const d = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const period = d.toISOString().slice(0, 7)
      return { period, label: formatMonthLabel(period) }
    }
    // custom
    if (!customPeriod || !/^\d{4}-\d{2}$/.test(customPeriod)) {
      throw new Error('periodStart must be "YYYY-MM" for custom period')
    }
    return { period: customPeriod, label: formatMonthLabel(customPeriod) }
  },

  async generateClientSummary(
    clientId: string,
    period: string,
    periodLabel: string,
    actorProcessIds: string[]
  ): Promise<PresentationResult> {
    const processIds = actorProcessIds.length ? actorProcessIds : await getClientProcessIds(clientId)
    if (!processIds.length) throw Object.assign(new Error('No portal data found for the selected period'), { status: 422 })

    const clientName = await getClientName(clientId)

    // Fetch all data in parallel — failures return null (graceful degradation)
    const [processCards, ...perProcessData] = await Promise.all([
      portalOverviewService.getOverview(processIds),
      ...processIds.map(pid =>
        Promise.all([
          safeGet(() => portalAttritionService.getAttrition(pid, period, processIds)),
          safeGet(() => portalTrainingComplianceService.getTrainingCompliance(pid, period, processIds)),
          safeGet(() => portalActionsService.list(pid)),
          safeGet(() => portalGovernanceService.getChecklist(pid, period)),
        ])
      ),
    ])

    // processCards may be empty if all processes have no_data
    if (!processCards.length) throw Object.assign(new Error('No portal data found for the selected period'), { status: 422 })

    const processNameMap = Object.fromEntries(processCards.map(p => [p.process_id, p.process_name]))

    const attritionByProcess = processIds.map((pid, i) => ({
      processName: processNameMap[pid] ?? pid,
      data: (perProcessData[i] as any)[0],
    }))
    const trainingByProcess = processIds.map((pid, i) => ({
      processName: processNameMap[pid] ?? pid,
      data: (perProcessData[i] as any)[1],
    }))
    const allActionPlans = (perProcessData as any[]).flatMap(d => d[2] ?? [])
    const governanceByProcess = processIds.map((pid, i) => ({
      processName: processNameMap[pid] ?? pid,
      activities: (perProcessData[i] as any)[3] ?? [],
    }))

    const latestCommentary = await safeGet(() => portalCommentaryService.get(processIds[0], period))

    const slides = buildClientSummarySlides({
      clientName, periodLabel, processCards,
      attritionByProcess, trainingByProcess,
      allActionPlans, governanceByProcess, latestCommentary,
    })

    const taskId = await presenton.generateAsync(slides, `Monthly portal report for ${clientName} — ${periodLabel}`)
    const filePath = await presenton.pollUntilDone(taskId)
    const buffer = await presenton.downloadFile(filePath)

    const filename = `${safeClientName(clientName)}-Summary-${period}.pptx`
    const fileUrl = saveFile(buffer, clientId, filename)
    return { fileUrl, filename }
  },

  async generateProcessDeck(
    processId: string,
    clientId: string,
    period: string,
    periodLabel: string,
    actorProcessIds: string[]
  ): Promise<PresentationResult> {
    const { clientName, processName } = await getClientAndProcessName(clientId, processId)

    const [kpis, glidePaths, attrition, trainingCompliance, actionPlans, governance, commentary] =
      await Promise.all([
        safeGet(() => portalKpiService.getScorecards(processId, period, actorProcessIds)),
        safeGet(() => portalGlideService.getGlidePaths(processId, period)),
        safeGet(() => portalAttritionService.getAttrition(processId, period, actorProcessIds)),
        safeGet(() => portalTrainingComplianceService.getTrainingCompliance(processId, period, actorProcessIds)),
        safeGet(() => portalActionsService.list(processId)),
        safeGet(() => portalGovernanceService.getChecklist(processId, period)),
        safeGet(() => portalCommentaryService.get(processId, period)),
      ])

    const slides = buildProcessDeckSlides({
      clientName, processName, periodLabel,
      kpis: (kpis ?? []) as any[],
      glidePaths: glidePaths ?? { hasConfiguredMetrics: false, paths: [] },
      attrition,
      trainingCompliance,
      actionPlans: actionPlans ?? [],
      governance: governance ?? [],
      commentary,
    })

    const taskId = await presenton.generateAsync(slides, `${processName} process report for ${clientName} — ${periodLabel}`)
    const filePath = await presenton.pollUntilDone(taskId)
    const buffer = await presenton.downloadFile(filePath)

    const filename = `${safeClientName(clientName)}-${safeClientName(processName)}-${period}.pptx`
    const fileUrl = saveFile(buffer, clientId, filename)
    return { fileUrl, filename }
  },
}
```

- [ ] **Step 5: Run tests — expect pass**

```bash
cd backend
npx jest src/modules/presentation/__tests__/presentation.service.test.ts --no-coverage 2>&1 | tail -15
```

Expected: `Tests: 4 passed`

- [ ] **Step 6: Type-check**

```bash
cd backend && npx tsc --noEmit 2>&1 | head -20
```

Expected: zero errors. If you see errors about `portal_process` or table queries — these are runtime issues, not type errors.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/presentation/presentation.service.ts \
        backend/src/modules/presentation/__tests__/presentation.service.test.ts
git commit -m "feat(presentation): add presentation service orchestrating data fetch and Presenton generation"
```

---

## Task 5: Routes, Controller, and App Registration

**Files:**
- Create: `backend/src/modules/presentation/presentation.controller.ts`
- Create: `backend/src/modules/presentation/presentation.routes.ts`
- Modify: `backend/src/app.ts` — register route before catch-all `clientRouter`

**Interfaces:**
- Consumes: `presentationService.resolvePeriod`, `presentationService.generateClientSummary`, `presentationService.generateProcessDeck`
- Produces:
  - `POST /api/presentations/generate` — accepts portal JWT or admin JWT
  - `GET /api/presentations/download/:clientId/:filename` — serves the file with auth

- [ ] **Step 1: Create presentation.controller.ts**

```typescript
// backend/src/modules/presentation/presentation.controller.ts
import { Request, Response } from 'express'
import path from 'path'
import fs from 'fs'
import { presentationService } from './presentation.service.js'
import { PresentonUnavailableError, PresentonTimeoutError } from './presenton.client.js'
import type { ClientAuthRequest } from '../../middleware/requireClientAuth.js'
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js'

function isPortalRequest(req: Request): req is ClientAuthRequest {
  return !!(req as ClientAuthRequest).portalUser
}

export const presentationController = {
  async generate(req: Request, res: Response): Promise<void> {
    try {
      const body = req.body as {
        clientId?: string
        processId?: string | null
        scope: 'client' | 'process'
        periodType: 'last_month' | 'current_month' | 'custom'
        customPeriod?: string
      }

      if (!body.scope || !body.periodType) {
        res.status(400).json({ success: false, error: 'scope and periodType are required' })
        return
      }

      let clientId: string
      let actorProcessIds: string[]

      if (isPortalRequest(req)) {
        // Portal JWT: clientId is fixed to the authenticated client — ignore body.clientId
        clientId = (req as ClientAuthRequest).portalUser!.clientId
        actorProcessIds = (req as ClientAuthRequest).portalUser!.processIds
      } else {
        // Admin JWT: clientId comes from body, validated downstream via DB
        if (!body.clientId) {
          res.status(400).json({ success: false, error: 'clientId required for admin requests' })
          return
        }
        clientId = body.clientId
        actorProcessIds = [] // service will look up from DB
      }

      const { period, label } = presentationService.resolvePeriod(body.periodType, body.customPeriod)

      let result
      if (body.scope === 'client') {
        result = await presentationService.generateClientSummary(clientId, period, label, actorProcessIds)
      } else {
        if (!body.processId) {
          res.status(400).json({ success: false, error: 'processId required for process scope' })
          return
        }
        result = await presentationService.generateProcessDeck(body.processId, clientId, period, label, actorProcessIds)
      }

      res.json({ success: true, data: result })
    } catch (err: any) {
      if (err instanceof PresentonUnavailableError) {
        res.status(503).json({ success: false, error: err.message })
      } else if (err instanceof PresentonTimeoutError) {
        res.status(504).json({ success: false, error: err.message })
      } else if (err.status === 422) {
        res.status(422).json({ success: false, error: err.message })
      } else if (err.status === 404) {
        res.status(404).json({ success: false, error: err.message })
      } else {
        console.error('[presentation] generate error', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
      }
    }
  },

  async download(req: Request, res: Response): Promise<void> {
    const { clientId, filename } = req.params

    // Security: verify the requesting actor can access this clientId
    if (isPortalRequest(req)) {
      const portalClientId = (req as ClientAuthRequest).portalUser!.clientId
      if (portalClientId !== clientId) {
        res.status(403).json({ success: false, error: 'Access denied' })
        return
      }
    }
    // Admin roles have access to any clientId — no extra check needed (requireRole enforced in route)

    // Sanitise filename to prevent path traversal
    const safe = path.basename(filename)
    if (!safe.endsWith('.pptx')) {
      res.status(400).json({ success: false, error: 'Invalid file' })
      return
    }

    const filePath = path.join(process.cwd(), 'uploads', 'presentations', clientId, safe)
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ success: false, error: 'File not found' })
      return
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
    res.setHeader('Content-Disposition', `attachment; filename="${safe}"`)
    res.sendFile(filePath)
  },
}
```

- [ ] **Step 2: Create presentation.routes.ts**

```typescript
// backend/src/modules/presentation/presentation.routes.ts
import { Router } from 'express'
import { requireAuth } from '../../middleware/authMiddleware.js'
import { requireRole } from '../../middleware/requireRole.js'
import { requireClientAuth } from '../../middleware/requireClientAuth.js'
import { presentationController as c } from './presentation.controller.js'

const router = Router()
const h = (fn: (req: any, res: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) => fn(req, res).catch(next)

// Admin path: staff JWT with super_admin or hr_admin role
router.post('/generate', requireAuth, requireRole('super_admin', 'hr_admin'), h(c.generate))

// Portal path: portal JWT (client role) — clientId fixed by JWT, no role check needed
router.post('/generate/portal', requireClientAuth, h(c.generate))

// File download — portal JWT
router.get('/download/:clientId/:filename', requireClientAuth, h(c.download))

// File download — admin JWT (same handler, different auth)
router.get('/admin/download/:clientId/:filename', requireAuth, requireRole('super_admin', 'hr_admin'), h(c.download))

export { router as presentationRouter }
```

- [ ] **Step 3: Register in backend/src/app.ts**

Open `backend/src/app.ts` and find the line `app.use("/api/portal", portalRouter)` (around line 526).

Add the following **before** that block (or immediately after it, as long as it is before the catch-all `app.use("/api", clientRouter)` line):

```typescript
import { presentationRouter } from './modules/presentation/presentation.routes.js'
// ... (add with the other imports at the top of the file)

// In the route registration section:
app.use('/api/presentations', presentationRouter)
```

- [ ] **Step 4: Type-check**

```bash
cd backend && npx tsc --noEmit 2>&1 | head -20
```

Fix any errors before continuing. Common issues:
- `AuthenticatedRequest` import path — verify against what `requireAuth` middleware exports
- `portalAuthService.verifyToken` — check the actual export name in `portal.auth.service.ts`

- [ ] **Step 5: Quick smoke-test the route (Presenton not required)**

```bash
# Start the backend
cd backend && npm run dev &
sleep 5

# Should return 401 (auth check working, not 404)
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:5055/api/presentations/generate
# Expected: 401

# Should return 401
curl -s -o /dev/null -w "%{http_code}" http://localhost:5055/api/presentations/download/1/test.pptx
# Expected: 401
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/presentation/presentation.controller.ts \
        backend/src/modules/presentation/presentation.routes.ts \
        backend/src/app.ts
git commit -m "feat(presentation): add routes, controller, and app registration for presentation export"
```

---

## Task 6: Frontend API Helper + Export Modal

**Files:**
- Create: `src/lib/presentationApi.ts`
- Create: `src/components/presentation/ExportPresentationModal.tsx`

**Interfaces:**
- Produces:
  ```typescript
  // src/lib/presentationApi.ts
  generatePresentation(req: GeneratePresentationRequest): Promise<{ fileUrl: string; filename: string }>

  interface GeneratePresentationRequest {
    clientId?: string   // omit for portal users (backend ignores it anyway)
    processId?: string | null
    scope: 'client' | 'process'
    periodType: 'last_month' | 'current_month' | 'custom'
    customPeriod?: string  // "YYYY-MM"
  }

  // ExportPresentationModal props
  interface ExportPresentationModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    clientId?: string       // for admin use; portal users don't need it
    processId?: string      // present = process deck; absent = client summary
    scope: 'client' | 'process'
    isAdminMode?: boolean   // true when opened from SuperAdminClientPortalAccess
  }
  ```

- [ ] **Step 1: Create src/lib/presentationApi.ts**

```typescript
// src/lib/presentationApi.ts

export interface GeneratePresentationRequest {
  clientId?: string
  processId?: string | null
  scope: 'client' | 'process'
  periodType: 'last_month' | 'current_month' | 'custom'
  customPeriod?: string
}

export async function generatePresentation(
  req: GeneratePresentationRequest,
  isPortalUser: boolean
): Promise<{ fileUrl: string; filename: string }> {
  const token = localStorage.getItem(isPortalUser ? 'portalToken' : 'authToken') ?? ''
  const endpoint = isPortalUser
    ? '/api/presentations/generate/portal'
    : '/api/presentations/generate'

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(req),
  })

  const body = await res.json()
  if (!body.success) throw new Error(body.error ?? 'Failed to generate presentation')
  return body.data
}
```

> **Note:** Verify the localStorage key names for portal token (`portalToken`) and staff token (`authToken`) by checking `src/lib/portalApi.ts` and `src/lib/api.ts` — use whatever key the existing app already sets. Update if different.

- [ ] **Step 2: Create src/components/presentation/ExportPresentationModal.tsx**

```tsx
// src/components/presentation/ExportPresentationModal.tsx
import { useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Loader2, Download, FilePresentation } from 'lucide-react'
import { generatePresentation } from '@/lib/presentationApi'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  clientId?: string
  processId?: string
  scope: 'client' | 'process'
  isAdminMode?: boolean
}

type PeriodType = 'last_month' | 'current_month' | 'custom'

const MONTHS = ['January','February','March','April','May','June',
                 'July','August','September','October','November','December']

const currentYear = new Date().getFullYear()
const YEARS = Array.from({ length: 5 }, (_, i) => String(currentYear - i))

export function ExportPresentationModal({
  open, onOpenChange, clientId, processId, scope, isAdminMode = false
}: Props) {
  const [periodType, setPeriodType] = useState<PeriodType>('last_month')
  const [customMonth, setCustomMonth] = useState(String(new Date().getMonth() + 1).padStart(2, '0'))
  const [customYear, setCustomYear] = useState(String(currentYear))
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [fileUrl, setFileUrl] = useState<string>('')
  const [filename, setFilename] = useState<string>('')
  const [errorMsg, setErrorMsg] = useState<string>('')

  const customPeriod = `${customYear}-${customMonth}`

  async function handleGenerate() {
    setStatus('loading')
    setErrorMsg('')
    try {
      const result = await generatePresentation(
        { clientId, processId, scope, periodType, customPeriod: periodType === 'custom' ? customPeriod : undefined },
        !isAdminMode
      )
      setFileUrl(result.fileUrl)
      setFilename(result.filename)
      setStatus('done')
    } catch (e: any) {
      setErrorMsg(e.message ?? 'Generation failed')
      setStatus('error')
    }
  }

  function handleClose() {
    setStatus('idle')
    setFileUrl('')
    setFilename('')
    setErrorMsg('')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FilePresentation className="h-5 w-5 text-blue-600" />
            Export as Presentation
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Period type selector */}
          <div className="space-y-1.5">
            <Label>Period</Label>
            <Select value={periodType} onValueChange={v => setPeriodType(v as PeriodType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="last_month">Last completed month</SelectItem>
                <SelectItem value="current_month">Current month (partial)</SelectItem>
                <SelectItem value="custom">Custom month</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Custom month/year pickers — only shown for 'custom' */}
          {periodType === 'custom' && (
            <div className="flex gap-3">
              <div className="flex-1 space-y-1.5">
                <Label>Month</Label>
                <Select value={customMonth} onValueChange={setCustomMonth}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m, i) => (
                      <SelectItem key={m} value={String(i + 1).padStart(2, '0')}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 space-y-1.5">
                <Label>Year</Label>
                <Select value={customYear} onValueChange={setCustomYear}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {YEARS.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* Scope label (read-only, shows what will be generated) */}
          <p className="text-sm text-slate-500">
            {scope === 'client'
              ? 'Generates a client summary deck covering all processes.'
              : 'Generates a per-process drilldown deck.'}
          </p>

          {status === 'error' && (
            <p className="text-sm text-red-600 bg-red-50 rounded p-2">{errorMsg}</p>
          )}

          {status === 'done' && (
            <a
              href={fileUrl}
              download={filename}
              className="flex items-center gap-2 text-sm text-blue-700 bg-blue-50 rounded p-2 hover:bg-blue-100 transition-colors"
            >
              <Download className="h-4 w-4" />
              Download {filename}
            </a>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          {status !== 'done' && (
            <Button onClick={handleGenerate} disabled={status === 'loading'}>
              {status === 'loading' ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Generating…</>
              ) : 'Generate'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 3: Frontend build check**

```bash
npm run build 2>&1 | tail -10
```

Expected: zero TypeScript errors. Fix any import path issues.

- [ ] **Step 4: Commit**

```bash
git add src/lib/presentationApi.ts src/components/presentation/ExportPresentationModal.tsx
git commit -m "feat(presentation): add frontend API helper and export modal with period picker"
```

---

## Task 7: Wire Buttons Into Portal Pages

**Files:**
- Create: `src/components/presentation/ExportPresentationButton.tsx`
- Modify: `src/pages/portal/PortalOverview.tsx`
- Modify: `src/pages/portal/PortalProcessDashboard.tsx`
- Modify: `src/pages/portal/SuperAdminClientPortalAccess.tsx`

**Interfaces:**
- Consumes: `ExportPresentationModal` from `./ExportPresentationModal`
- Produces: `ExportPresentationButton` component with props `{ label, clientId?, processId?, scope, isAdminMode? }`

- [ ] **Step 1: Create ExportPresentationButton.tsx**

```tsx
// src/components/presentation/ExportPresentationButton.tsx
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { FilePresentation } from 'lucide-react'
import { ExportPresentationModal } from './ExportPresentationModal'

interface Props {
  label?: string
  clientId?: string
  processId?: string
  scope: 'client' | 'process'
  isAdminMode?: boolean
  variant?: 'default' | 'outline' | 'ghost'
  size?: 'default' | 'sm'
}

export function ExportPresentationButton({
  label,
  clientId,
  processId,
  scope,
  isAdminMode = false,
  variant = 'outline',
  size = 'sm',
}: Props) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)}>
        <FilePresentation className="h-4 w-4 mr-2" />
        {label ?? (scope === 'client' ? 'Export Client Report' : 'Export Process Report')}
      </Button>
      <ExportPresentationModal
        open={open}
        onOpenChange={setOpen}
        clientId={clientId}
        processId={processId}
        scope={scope}
        isAdminMode={isAdminMode}
      />
    </>
  )
}
```

- [ ] **Step 2: Open PortalOverview.tsx and find the page header area**

Read the file to find where the page header / action area is rendered. Look for a `<div>` or `<header>` at the top of the JSX return, typically containing the page title or filter controls.

Add the import at the top:
```tsx
import { ExportPresentationButton } from '@/components/presentation/ExportPresentationButton'
```

Add the button in the page header action area, alongside any existing buttons:
```tsx
<ExportPresentationButton scope="client" />
```

The portal overview page uses `req.portalUser.clientId` server-side; the client is already scoped by their JWT so no `clientId` prop is needed for portal users.

- [ ] **Step 3: Open PortalProcessDashboard.tsx and find the process header area**

Read the file to find where the process name / header is rendered. Look for where `processId` comes from (likely `useParams()` or a prop).

Add the import:
```tsx
import { ExportPresentationButton } from '@/components/presentation/ExportPresentationButton'
```

Add the button in the process header, passing the processId:
```tsx
<ExportPresentationButton scope="process" processId={processId} />
```

Where `processId` is whatever variable holds the current process ID from the route params.

- [ ] **Step 4: Open SuperAdminClientPortalAccess.tsx and find the impersonation controls area**

Read the file to find where impersonation controls are rendered (typically has client selector + "access" button). Add both buttons here:

```tsx
import { ExportPresentationButton } from '@/components/presentation/ExportPresentationButton'

// In the JSX, after or alongside the impersonation controls:
<ExportPresentationButton
  scope="client"
  clientId={selectedClientId}   // use whatever state var holds the selected client
  isAdminMode={true}
/>
<ExportPresentationButton
  scope="process"
  clientId={selectedClientId}
  processId={selectedProcessId}  // add a process selector if not already present
  isAdminMode={true}
/>
```

> If there is no process selector in this component, add a `Select` for `processId` using the same shadcn `Select` pattern as the rest of the page. Look at what data is already available (client's process list may already be fetched).

- [ ] **Step 5: Frontend build check**

```bash
npm run build 2>&1 | tail -10
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/presentation/ExportPresentationButton.tsx \
        src/pages/portal/PortalOverview.tsx \
        src/pages/portal/PortalProcessDashboard.tsx \
        src/pages/portal/SuperAdminClientPortalAccess.tsx
git commit -m "feat(presentation): wire Export as Presentation buttons into portal pages"
```

---

## Task 8: End-to-End Verification

**Files:** No new files — verification only.

- [ ] **Step 1: Backend TypeScript check**

```bash
cd backend && npx tsc --noEmit 2>&1 | head -20
```

Expected: zero errors.

- [ ] **Step 2: Frontend build**

```bash
npm run build 2>&1 | tail -10
```

Expected: zero errors.

- [ ] **Step 3: Verify Presenton is running**

```bash
docker ps | grep presenton
curl -s http://localhost:8000/api/v1/ppt/health 2>/dev/null || echo "health endpoint not found"
```

If not running: `docker compose -f docker-compose.presenton.yml up -d`

- [ ] **Step 4: Verify DB table names**

```bash
mysql -u root -p mas_hrms -e "SHOW TABLES LIKE 'portal%';"
```

If the tables used in `presentation.service.ts` (`portal_process`, `portal_client`) don't match, update the SQL queries in `getClientProcessIds`, `getClientAndProcessName`, and `getClientName` to use the actual table and column names.

- [ ] **Step 5: End-to-end API test**

Get a portal JWT token (log in as a portal client user):
```bash
TOKEN=$(curl -s -X POST http://localhost:5055/api/portal/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"<portal_user_email>","password":"<password>"}' | jq -r .data.token)

curl -s -X POST http://localhost:5055/api/presentations/generate/portal \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"scope":"client","periodType":"last_month"}' | jq .
```

Expected: `{ "success": true, "data": { "fileUrl": "/api/presentations/download/...", "filename": "..." } }`

If you get 503: Presenton isn't running — check Docker. 
If you get 422: No portal data exists for that period — try `"periodType":"current_month"`.
If you get 500: Check `cd backend && npm run dev` logs.

- [ ] **Step 6: Download the generated file**

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:5055/api/presentations/download/<clientId>/<filename> \
  -o /tmp/test_presentation.pptx

file /tmp/test_presentation.pptx
```

Expected: `Microsoft PowerPoint 2007+` or `Zip archive data`

- [ ] **Step 7: Final commit if any fixes were made**

```bash
git add -p  # stage only your own changes
git commit -m "fix(presentation): post-verification fixes"
```

---

## Spec Coverage Check

| Spec Requirement | Task |
|---|---|
| Docker sidecar at localhost:8000 | Task 1 |
| PRESENTON_API_URL env var | Task 1 |
| Presenton HTTP client (generate, poll, download) | Task 2 |
| Client summary deck (8 slides) | Task 3 |
| Per-process deck (10 slides) | Task 3 |
| No-data graceful handling | Task 3 |
| Period resolution (last_month, current_month, custom) | Task 4 |
| Portal JWT → clientId fixed to own client | Task 5 |
| Admin JWT → any clientId | Task 5 |
| File saved to uploads/presentations/<clientId>/ | Task 4 |
| File served via authenticated GET route | Task 5 |
| ExportPresentationButton + Modal with period picker | Tasks 6–7 |
| Button in PortalOverview | Task 7 |
| Button in PortalProcessDashboard | Task 7 |
| Button in SuperAdminClientPortalAccess | Task 7 |
| 503 on Presenton unavailable | Tasks 2, 5 |
| 504 on generation timeout | Tasks 2, 5 |
| 422 on no data | Task 4 |
| Period picker dropdowns (not free text) | Task 6 |
| Phase 2 schedulable — service signature supports it | Task 4 |
