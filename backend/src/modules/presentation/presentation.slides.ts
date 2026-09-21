import type {
  ProcessCard, AttritionData, TrainingComplianceData,
  ActionPlanItem, GovernanceActivity, Commentary, GlidePathsResult,
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
  // Uses GlidePath.points (array of GlidePoint) and GlidePoint.month (not data_points/period)
  let trendContent: string
  if (!glidePaths.hasConfiguredMetrics || glidePaths.paths.length === 0) {
    trendContent = '*No glide path data configured for this process.*'
  } else {
    trendContent = glidePaths.paths.map(p => {
      const rows = p.points.map(d =>
        `| ${d.month} | ${d.actual ?? '—'} | ${d.committed ?? '—'} | ${d.target ?? '—'} |`
      ).join('\n')
      return `### ${p.metric_name}\n\n| Month | Actual | Committed | Target |\n|-------|--------|-----------|--------|\n${rows}`
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
