import type { Request, Response } from 'express'
import path from 'path'
import fs from 'fs'
import { presentationService } from './presentation.service.js'
import { PresentonUnavailableError, PresentonTimeoutError } from './presenton.client.js'
import type { ClientAuthRequest } from '../../middleware/requireClientAuth.js'

function isPortalRequest(req: Request): boolean {
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
        clientId = (req as ClientAuthRequest).portalUser!.clientId
        actorProcessIds = (req as ClientAuthRequest).portalUser!.processIds ?? []
      } else {
        if (!body.clientId) {
          res.status(400).json({ success: false, error: 'clientId required for admin requests' })
          return
        }
        clientId = body.clientId
        actorProcessIds = []
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
    } catch (err: unknown) {
      if (err instanceof PresentonUnavailableError) {
        res.status(503).json({ success: false, error: (err as Error).message })
      } else if (err instanceof PresentonTimeoutError) {
        res.status(504).json({ success: false, error: (err as Error).message })
      } else if ((err as any).status === 422) {
        res.status(422).json({ success: false, error: (err as Error).message })
      } else if ((err as any).status === 404) {
        res.status(404).json({ success: false, error: (err as Error).message })
      } else {
        console.error('[presentation] generate error', err)
        res.status(500).json({ success: false, error: 'Internal server error' })
      }
    }
  },

  async download(req: Request, res: Response): Promise<void> {
    const { clientId, filename } = req.params

    // Portal users can only access their own client's files
    if ((req as any).portalUser) {
      const portalClientId = (req as any).portalUser.clientId
      if (portalClientId !== clientId) {
        res.status(403).json({ success: false, error: 'Access denied' })
        return
      }
    }
    // Staff users with requirePortalOrStaffAuth — if req.authUser is set, they passed
    // requireAuth. No clientId restriction for admins (they can access any client).

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
