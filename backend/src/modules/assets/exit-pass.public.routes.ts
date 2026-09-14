import { Router, type Request, type Response, type NextFunction } from 'express';
import { findPassForVerificationByQrToken, ExitPassError } from './exit-pass.service.js';

export const exitPassPublicRouter = Router();

const h = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { void fn(req, res).catch(next); };

/**
 * Public (no-auth) gate pass lookup by QR token.
 *
 * Called by the /verify/gp frontend page which the QR code on the printed
 * pass links to. The guard scanning the QR on their phone needs to see the
 * pass status without first logging into HRMS.
 *
 * Only returns data that is already printed on the physical document:
 * pass_number, status, verdict, carrier_name, items (name + qty),
 * planned_exit_at, movement_type, branch_name.
 *
 * Recording the actual exit is a separate authenticated POST — this is
 * a read-only display endpoint.
 */
exitPassPublicRouter.get('/t/:token', h(async (req, res) => {
  try {
    const rawUntyped = await findPassForVerificationByQrToken(req.params.token);
    // shapeForVerification spreads a RowDataPacket; cast to access named columns.
    const raw = rawUntyped as Record<string, unknown> & {
      pass_number: string; status: string; verdict: string; movement_type: string;
      carrier_name: string | null; carrier_type: string; branch_name: string;
      planned_exit_at: string; expected_return_at: string | null;
      exit_verified_at: string | null; is_overdue: boolean;
      items: Array<{ item_name: string; asset_id?: string | null; quantity: number; category: string }>;
    };
    // Expose only what the printed document already shows. No employee IDs,
    // no internal branch_id, no salary or PII beyond names on the pass.
    const safe = {
      pass_number:     raw.pass_number,
      status:          raw.status,
      verdict:         raw.verdict,
      movement_type:   raw.movement_type,
      carrier_name:    raw.carrier_name,
      carrier_type:    raw.carrier_type,
      branch_name:     raw.branch_name,
      planned_exit_at: raw.planned_exit_at,
      expected_return_at: raw.expected_return_at,
      exit_verified_at:   raw.exit_verified_at,
      is_overdue:      raw.is_overdue,
      items: raw.items.map(it => ({
        item_name: it.item_name, asset_id: it.asset_id ?? null,
        quantity: it.quantity, category: it.category,
      })),
    };
    return res.json({ success: true, data: safe });
  } catch (err) {
    if (err instanceof ExitPassError) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    console.error('[exit-pass-public]', err);
    return res.status(500).json({ success: false, message: 'Could not verify this pass.' });
  }
}));
