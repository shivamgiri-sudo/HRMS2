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
import type { ProcessCard } from '../portal/portal.types.js'

export interface PresentationResult { fileUrl: string; filename: string }

// Re-export error classes so controller can import from one place
export { PresentonUnavailableError, PresentonTimeoutError }

function formatMonthLabel(period: string): string {
  const [year, month] = period.split('-')
  const date = new Date(parseInt(year, 10), parseInt(month, 10) - 1, 1)
  return date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
}

function safeClientName(name: string): string {
  return name.replace(/[^a-zA-Z0-9\-_ ]/g, '').replace(/\s+/g, '-').slice(0, 40)
}

async function safeGet<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn() } catch { return null }
}

async function getClientProcessIds(clientId: string): Promise<string[]> {
  const [rows] = await db.execute<any[]>(
    `SELECT id AS process_id FROM process_master WHERE client_id = ?`,
    [clientId]
  )
  return rows.map((r: any) => String(r.process_id))
}

async function getClientAndProcessName(
  clientId: string, processId: string
): Promise<{ clientName: string; processName: string }> {
  const [rows] = await db.execute<any[]>(
    `SELECT pm.process_name, cm.client_name
     FROM process_master pm
     JOIN client_master cm ON cm.id = pm.client_id
     WHERE pm.id = ? AND pm.client_id = ?
     LIMIT 1`,
    [processId, clientId]
  )
  if (!rows.length) return { clientName: 'Client', processName: 'Process' }
  return { clientName: rows[0].client_name, processName: rows[0].process_name }
}

async function getClientName(clientId: string): Promise<string> {
  const [rows] = await db.execute<any[]>(
    `SELECT client_name FROM client_master WHERE id = ? LIMIT 1`,
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
    if (!processIds.length) {
      throw Object.assign(new Error('No portal data found for the selected period'), { status: 422 })
    }

    const clientName = await getClientName(clientId)

    // Fetch all data in parallel — failures return null (graceful degradation)
    const overviewPromise = portalOverviewService.getOverview(processIds)
    const perProcessPromises = processIds.map(pid =>
      Promise.all([
        safeGet(() => portalAttritionService.getAttrition(pid, period, processIds)),
        safeGet(() => portalTrainingComplianceService.getTrainingCompliance(pid, period, processIds)),
        safeGet(() => portalActionsService.list(pid)),
        safeGet(() => portalGovernanceService.getChecklist(pid, period)),
      ])
    )

    const [processCards, ...perProcessData] = await Promise.all([
      overviewPromise,
      ...perProcessPromises,
    ]) as [ProcessCard[], ...Array<[any, any, any, any]>]

    if (!processCards.length) {
      throw Object.assign(new Error('No portal data found for the selected period'), { status: 422 })
    }

    const processNameMap = Object.fromEntries(processCards.map(p => [p.process_id, p.process_name]))

    const attritionByProcess = processIds.map((pid, i) => ({
      processName: processNameMap[pid] ?? pid,
      data: perProcessData[i][0],
    }))
    const trainingByProcess = processIds.map((pid, i) => ({
      processName: processNameMap[pid] ?? pid,
      data: perProcessData[i][1],
    }))
    const allActionPlans = perProcessData.flatMap(d => d[2] ?? [])
    const governanceByProcess = processIds.map((pid, i) => ({
      processName: processNameMap[pid] ?? pid,
      activities: perProcessData[i][3] ?? [],
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
