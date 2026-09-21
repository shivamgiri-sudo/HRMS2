import { vi, beforeEach, describe, it, expect } from 'vitest'

// We mock global fetch so no real HTTP is made
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { presenton } from '../presenton.client.js'

beforeEach(() => {
  vi.clearAllMocks()
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
