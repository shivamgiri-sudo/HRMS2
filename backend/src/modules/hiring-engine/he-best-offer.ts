/**
 * One candidate, one best offer (pure). A person with open follow-up rows in several requisitions gets one invite at a time: a row that
 * has already started keeps the offer, otherwise the best fit by distance band, match score, seats left, qualified time and id. Holds
 * are computed on every run and never stored; a decline on a requisition or the best row stopping releases the next one.
 */
export const DISTANCE_BAND_KM = 5;

export interface OfferRow {
  rowId: string;
  requisitionId: string;
  requisitionCode: string;
  qualifiedAt: string;
  started: boolean;
  declined: boolean;
  distanceKm: number | null;
  score: number | null;
  headcountRemaining: number | null;
}

export type OfferWhy = "already_offered" | "nearer" | "higher_score" | "more_urgent" | "earlier";

export interface OfferDecision { rowId: string; held: boolean; bestRowId: string | null; why: OfferWhy | null }

const num = (v: number | null): number | null => (v != null && Number.isFinite(v) ? v : null);
const band = (r: OfferRow): number | null => { const k = num(r.distanceKm); return k != null && k >= 0 ? Math.floor(k / DISTANCE_BAND_KM) : null; };
// Ascending with unknown last; returns 0 when equal.
const asc = (a: number | null, b: number | null) => (a === b ? 0 : a == null ? 1 : b == null ? -1 : a - b);
const str = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const CRITERIA: Array<[OfferWhy, (a: OfferRow, b: OfferRow) => number]> = [
  ["nearer", (a, b) => asc(band(a), band(b))],
  ["higher_score", (a, b) => asc(num(a.score) == null ? null : -num(a.score)!, num(b.score) == null ? null : -num(b.score)!)],
  ["more_urgent", (a, b) => asc(num(a.headcountRemaining), num(b.headcountRemaining))],
  ["earlier", (a, b) => str(a.qualifiedAt, b.qualifiedAt)],
  ["earlier", (a, b) => str(a.rowId, b.rowId)],
];
const byTime = (a: OfferRow, b: OfferRow) => str(a.qualifiedAt, b.qualifiedAt) || str(a.rowId, b.rowId);

export function rankOffers(rows: OfferRow[]): OfferDecision[] {
  const open = rows.filter((r) => !r.declined);
  const started = open.filter((r) => r.started).sort(byTime);
  let best: OfferRow | undefined;
  let whyOf: (r: OfferRow) => OfferWhy;
  if (started.length) {
    best = started[0];
    whyOf = () => "already_offered";
  } else {
    best = [...open].sort((a, b) => { for (const [, c] of CRITERIA) { const d = c(a, b); if (d) return d; } return 0; })[0];
    whyOf = (r) => CRITERIA.find(([, c]) => c(best!, r) !== 0)?.[0] ?? "earlier";
  }
  return rows.map((r) => {
    if (r.declined) return { rowId: r.rowId, held: false, bestRowId: null, why: null };
    if (r === best) return { rowId: r.rowId, held: false, bestRowId: r.rowId, why: null };
    return { rowId: r.rowId, held: true, bestRowId: best!.rowId, why: whyOf(r) };
  });
}

export interface HeldOfferDecision {
  mobile10: string; rowId: string; requisitionId: string; requisitionCode: string; bestRowId: string; bestRequisitionCode: string; why: OfferWhy;
}

/** The held rows of every mobile with at least two open rows, with the requisition holding them (for the held list). */
export function heldOffers(byMobile: Map<string, OfferRow[]>): HeldOfferDecision[] {
  const out: HeldOfferDecision[] = [];
  for (const [mobile10, rows] of byMobile) {
    if (rows.length < 2) continue;
    const idx = new Map(rows.map((r) => [r.rowId, r]));
    for (const d of rankOffers(rows)) {
      if (!d.held || !d.bestRowId || !d.why) continue;
      const r = idx.get(d.rowId)!;
      out.push({ mobile10, rowId: r.rowId, requisitionId: r.requisitionId, requisitionCode: r.requisitionCode, bestRowId: d.bestRowId, bestRequisitionCode: idx.get(d.bestRowId)!.requisitionCode, why: d.why });
    }
  }
  return out;
}

const STARTED = (a: string) => `(${a}.email_status IS NOT NULL OR ${a}.wa_status IS NOT NULL OR ${a}.call_state <> 'pending')`;
/** SQL expression: this follow-up row has started (any step attempted, sending or finished). */
export const OFFER_STARTED_SQL = STARTED("qf");

/**
 * Appended to a step's WHERE after `qf.owner = 'pipeline'`: skips a row while another open pipeline row of the same person and tag has
 * started (and has not been declined), unless both started and this one is the earlier. Held rows then never crowd the LIMIT.
 */
export function bestOfferSkipSql(on: boolean): string {
  if (!on) return "";
  return ` AND NOT EXISTS (SELECT 1 FROM qualified_followup o WHERE o.mobile10 = qf.mobile10 AND o.id <> qf.id AND o.mode_at_enqueue = qf.mode_at_enqueue AND o.owner = 'pipeline' AND o.stopped_reason IS NULL AND ${STARTED("o")} AND (NOT ${STARTED("qf")} OR o.qualified_at < qf.qualified_at OR (o.qualified_at = qf.qualified_at AND o.id < qf.id)) AND NOT EXISTS (SELECT 1 FROM he_lead hl JOIN he_match hm ON hm.lead_id = hl.id AND hm.requisition_id = o.requisition_id WHERE hl.mobile10 = o.mobile10 AND hm.state = 'declined'))`;
}
