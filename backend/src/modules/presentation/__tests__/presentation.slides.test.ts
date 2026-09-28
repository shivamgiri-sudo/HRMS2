import { describe, it, expect } from 'vitest'
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
