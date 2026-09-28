/**
 * Process Live Dashboard routes — dialler_db live metrics.
 * All routes are read-only GET endpoints.
 *
 * B-3 IB (Inbound):
 *   GET /api/process-live/inbound/summary
 *   GET /api/process-live/inbound/monthly
 *   GET /api/process-live/inbound/daily
 *   GET /api/process-live/inbound/hourly?date=YYYY-MM-DD
 *   GET /api/process-live/inbound/agents
 *   GET /api/process-live/inbound/apr
 *   GET /api/process-live/inbound/disposition
 *   GET /api/process-live/inbound/repeat
 *
 * Reginald Cart:
 *   GET /api/process-live/reginald-cart/summary
 *   GET /api/process-live/reginald-cart/monthly
 *   GET /api/process-live/reginald-cart/daily
 *   GET /api/process-live/reginald-cart/analysts
 *   GET /api/process-live/reginald-cart/apr
 *
 * Molecular Email APR:
 *   GET /api/process-live/molecular-email/summary
 *   GET /api/process-live/molecular-email/daily
 *   GET /api/process-live/molecular-email/agents
 *
 * Reginald Email APR:
 *   GET /api/process-live/reginald-email/summary
 *   GET /api/process-live/reginald-email/daily
 *   GET /api/process-live/reginald-email/agents
 *
 * All query params: from=YYYY-MM-DD&to=YYYY-MM-DD (defaults to current month)
 */

import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireLiveScope } from './live-dashboard-scope.js';
import {
  getInboundSummary, getInboundMonthly, getInboundDaily, getInboundHourly,
  getInboundAgents, getInboundApr, getInboundDisposition, getInboundRepeat,
} from './inbound.service.js';
import {
  getCartSummary, getCartDaily, getCartMonthly, getCartAnalysts, getCartApr, getCartSales,
} from './reginald-cart.service.js';
import {
  getAprSummary, getAprDaily, getAprAgents, type EmailProcess,
} from './apr.service.js';
import { getEmailTickets } from './email-ticket.service.js';
import { getBillingDashboard } from './domestic-billing.service.js';
import { getGs1Overview, getGs1Email, getGs1DataKart, getGs1Approval } from './gs1.service.js';
import {
  getCdrStagingSummary, getCdrStagingDaily, getCdrStagingMonthly,
  type CdrClientCode,
} from './cdr-staging.service.js';
import {
  getDalmiaOverview, getDalmiaScenarios, getDalmiaLeadSources,
  getDalmiaRegions, getDalmiaAfterHourDaily, getDalmiaOutboundStatus,
} from './dalmia.service.js';

const router = Router();
// Role + branch scope per endpoint group — see live-dashboard-scope.ts.
router.use(requireAuth, requireLiveScope);

function wrap(fn: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      const data = await fn(req, res);
      res.json({ ok: true, data });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[process-live]', msg);
      res.status(500).json({ ok: false, error: msg });
    }
  };
}

type Q = Record<string, string>;

// ── Inbound (BLA BLI BLU B-3 IB) ─────────────────────────────────────────────
router.get('/inbound/summary',     wrap(req => getInboundSummary(req.query as Q)));
router.get('/inbound/monthly',     wrap(req => getInboundMonthly(req.query as Q)));
router.get('/inbound/daily',       wrap(req => getInboundDaily(req.query as Q)));
router.get('/inbound/hourly',      wrap(req => getInboundHourly(req.query as Q)));
router.get('/inbound/agents',      wrap(req => getInboundAgents(req.query as Q)));
router.get('/inbound/apr',         wrap(req => getInboundApr(req.query as Q)));
router.get('/inbound/disposition', wrap(req => getInboundDisposition(req.query as Q)));
router.get('/inbound/repeat',      wrap(req => getInboundRepeat(req.query as Q)));

// ── Reginald Abandoned Cart ───────────────────────────────────────────────────
router.get('/reginald-cart/summary',  wrap(req => getCartSummary(req.query as Q)));
router.get('/reginald-cart/monthly',  wrap(req => getCartMonthly(req.query as Q)));
router.get('/reginald-cart/daily',    wrap(req => getCartDaily(req.query as Q)));
router.get('/reginald-cart/analysts', wrap(req => getCartAnalysts(req.query as Q)));
router.get('/reginald-cart/apr',      wrap(req => getCartApr(req.query as Q)));
// Sales from mas_hrms (uploaded via REGINALD_ABANDONED_CART_SALES bulk upload)
router.get('/reginald-cart/sales',    wrap(req => getCartSales(req.query as Q)));

// ── Email ticket actuals (uploaded via EMAIL_TICKET_DAILY bulk upload) ────────
router.get('/molecular-email/tickets',    wrap(req => getEmailTickets('MOLECULAR', req.query as Q)));
router.get('/reginald-email/tickets',     wrap(req => getEmailTickets('REGINALD_MEN', req.query as Q)));

// ── Email processes APR (from dialler_db vicidial_agent_log_10_25) ───────────
const emailH = (p: EmailProcess) => ({
  summary: wrap(req => getAprSummary(p, req.query as Q)),
  daily:   wrap(req => getAprDaily(p, req.query as Q)),
  agents:  wrap(req => getAprAgents(p, req.query as Q)),
});

const mol = emailH('molecular');
router.get('/molecular-email/summary', mol.summary);
router.get('/molecular-email/daily',   mol.daily);
router.get('/molecular-email/agents',  mol.agents);

const reg = emailH('reginald-email');
router.get('/reginald-email/summary', reg.summary);
router.get('/reginald-email/daily',   reg.daily);
router.get('/reginald-email/agents',  reg.agents);

// ── GS1 India ─────────────────────────────────────────────────────────────────
router.get('/gs1/overview',  wrap(req => getGs1Overview(req.query as Q)));
router.get('/gs1/email',     wrap(req => getGs1Email(req.query as Q)));
router.get('/gs1/datakart',  wrap(req => getGs1DataKart(req.query as Q)));
router.get('/gs1/approval',  wrap(req => getGs1Approval(req.query as Q)));

// ── Domestic Billing Dashboard ────────────────────────────────────────────────
router.get('/billing/dashboard', wrap(req => getBillingDashboard(req.query as Q)));

// ── CDR Staging Dashboards (inbound_cdr_daily_actual) ─────────────────────────
// GNC, Bella-Vita, Neemans, Viega, Exicom, DU Digital — data pre-synced from dialer_db
// by inbound-cdr-sync.service. Clovia is also available but has additional data
// sources (email/chat tables) so it gets its own service in future.
function cdrRoutes(prefix: string, code: CdrClientCode) {
  router.get(`/${prefix}/summary`, wrap(req => getCdrStagingSummary(code, req.query as Q)));
  router.get(`/${prefix}/daily`,   wrap(req => getCdrStagingDaily(code, req.query as Q)));
  router.get(`/${prefix}/monthly`, wrap(req => getCdrStagingMonthly(code, req.query as Q)));
}

cdrRoutes('gnc',          'GNC');
cdrRoutes('bella-vita',   'BELLAVITA');
cdrRoutes('clovia',       'CLOVIA');
cdrRoutes('neemans',      'NEEMANS');
cdrRoutes('viega',        'VIEGA');
cdrRoutes('exicom',       'EXICOM');
cdrRoutes('du-digital',   'DU_BANGLADESH');

// ── Finnable APR (vicidial_agent_log_10_25, campaign_id = 'FINNABLE') ────────
const fin = emailH('finnable');
router.get('/finnable/summary', fin.summary);
router.get('/finnable/daily',   fin.daily);
router.get('/finnable/agents',  fin.agents);

// ── Dalmia Cement Analytics (from bulk-uploaded MIS tables) ──────────────────
router.get('/dalmia/overview',        wrap(req => getDalmiaOverview(req.query as Q)));
router.get('/dalmia/scenarios',       wrap(req => getDalmiaScenarios(req.query as Q)));
router.get('/dalmia/lead-sources',    wrap(req => getDalmiaLeadSources(req.query as Q)));
router.get('/dalmia/regions',         wrap(req => getDalmiaRegions(req.query as Q)));
router.get('/dalmia/after-hour-daily',wrap(req => getDalmiaAfterHourDaily(req.query as Q)));
router.get('/dalmia/outbound-status', wrap(req => getDalmiaOutboundStatus(req.query as Q)));

export default router;
