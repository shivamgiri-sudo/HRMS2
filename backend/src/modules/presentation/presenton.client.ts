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
        template: 'general',
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
