import { vi, describe, it, expect } from 'vitest'

// Mock all dependencies before importing the service.
// Paths are relative to this test file in __tests__/, so portal services are one extra `..` away.

vi.mock('../presenton.client.js', () => ({
  presenton: {
    generateAsync: vi.fn().mockResolvedValue('task-abc'),
    pollUntilDone: vi.fn().mockResolvedValue('/app_data/exports/file.pptx'),
    downloadFile: vi.fn().mockResolvedValue(Buffer.from('fake pptx')),
  },
  PresentonUnavailableError: class extends Error {},
  PresentonTimeoutError: class extends Error {},
}))

// db path from __tests__/: ../../../db/mysql.js => src/db/mysql.js
vi.mock('../../../db/mysql.js', () => ({
  db: {
    execute: vi.fn().mockResolvedValue([
      [{ process_id: 'p1', client_name: 'Acme', process_name: 'Inbound', id: 'p1' }],
      [],
    ]),
  },
}))

// Portal service paths from __tests__/: ../../portal/... => src/modules/portal/...
vi.mock('../../portal/portal.overview.service.js', () => ({
  portalOverviewService: {
    getOverview: vi.fn().mockResolvedValue([
      { process_id: 'p1', process_name: 'Inbound', client_name: 'Acme', rag: 'green', headline_metrics: [], last_updated: null },
    ]),
  },
}))

vi.mock('../../portal/portal.kpi.service.js', () => ({
  portalKpiService: { getScorecards: vi.fn().mockResolvedValue([]) },
}))

vi.mock('../../portal/portal.attrition.service.js', () => ({
  portalAttritionService: { getAttrition: vi.fn().mockRejectedValue(new Error('no data')) },
}))

vi.mock('../../portal/portal.training-compliance.service.js', () => ({
  portalTrainingComplianceService: { getTrainingCompliance: vi.fn().mockRejectedValue(new Error('no data')) },
}))

vi.mock('../../portal/portal.actions.service.js', () => ({
  portalActionsService: { list: vi.fn().mockResolvedValue([]) },
}))

vi.mock('../../portal/portal.governance.service.js', () => ({
  portalGovernanceService: { getChecklist: vi.fn().mockResolvedValue([]) },
}))

vi.mock('../../portal/portal.commentary.service.js', () => ({
  portalCommentaryService: { get: vi.fn().mockResolvedValue(null) },
}))

vi.mock('../../portal/portal.glide.service.js', () => ({
  portalGlideService: { getGlidePaths: vi.fn().mockResolvedValue({ hasConfiguredMetrics: false, paths: [] }) },
}))

vi.mock('fs', () => ({
  default: {
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    existsSync: vi.fn().mockReturnValue(false),
  },
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(false),
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
