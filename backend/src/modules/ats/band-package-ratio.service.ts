import { db } from '../../db/mysql.js';
import { RowDataPacket } from 'mysql2/promise';

export interface BandPct {
  basicPct: number;
  hraPct: number;
  /** 'package_master' when a real row backed this; 'default' only when the
   *  band has no usable salary_package_master row at all. */
  source: 'package_master' | 'default';
}

/**
 * Derive the basic/HRA split for an offer's band from salary_package_master --
 * the canonical master Payroll Head's tools read (payrollMasters.service.ts,
 * PackageBuilderDialog) -- instead of salary_band_master.basic_pct/hra_pct.
 *
 * Those two columns do not exist on salary_band_master (it only has
 * band_code/band_name/slab_from/slab_to), so every prior lookup there threw,
 * was swallowed by a .catch(), and silently fell back to a hardcoded 40/40
 * split for every band regardless of what the real master says.
 *
 * package_amount is stored in the same unit as an offer's own offered_ctc
 * once converted to monthly (both come out of the same calculateSalary()
 * annual/12 convention), so the row whose package_amount is numerically
 * closest to the candidate's monthly CTC is the best real match for "this
 * band, this pay level" -- ties broken toward active rows. Its own
 * basic/gross and hra/basic ratio is used as-is; nothing here invents a
 * percentage that is not backed by an actual master row.
 *
 * Real data is uneven -- some low bands (A/B) hold packages with basic ==
 * gross and hra == 0 (no HRA component at that pay level), and even within
 * one band different package rows carry different ratios. That is read
 * faithfully, not smoothed over, because the goal is parity with what the
 * canonical master would produce, not a cleaner-looking number.
 */
export async function resolveBandPct(
  bandCode: string | null | undefined,
  monthlyCtc: number,
): Promise<BandPct> {
  const DEFAULT: BandPct = { basicPct: 40, hraPct: 40, source: 'default' };
  if (!bandCode || !Number.isFinite(monthlyCtc)) return DEFAULT;

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT basic, hra, gross FROM salary_package_master
      WHERE band_code = ? AND gross > 0 AND basic > 0
      ORDER BY (active_status = 1) DESC, ABS(package_amount - ?) ASC
      LIMIT 1`,
    [bandCode, monthlyCtc],
  ).catch(() => [[] as RowDataPacket[]]);

  const row = (rows as RowDataPacket[])[0];
  if (!row) return DEFAULT; // this band has no package_master row to derive from at all

  const gross = Number(row.gross);
  const basic = Number(row.basic);
  const hra = Number(row.hra);

  return {
    basicPct: gross > 0 ? (basic / gross) * 100 : DEFAULT.basicPct,
    hraPct: basic > 0 ? (hra / basic) * 100 : 0, // a real row can legitimately carry 0 HRA
    source: 'package_master',
  };
}
