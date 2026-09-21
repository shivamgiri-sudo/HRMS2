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
  const token = isPortalUser
    ? localStorage.getItem('portal_token') ?? ''
    : localStorage.getItem('hrms_access_token') ?? ''
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
