/** Arrival ETA + the "expecting N within 30 min" window for the branch board. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** City travel: straight-line x 1.35 road factor at ~22 km/h average. Minutes, rounded up. */
export function etaMinutes(distanceKm: number, avgKmh = 22, roadFactor = 1.35): number {
  if (!(distanceKm >= 0)) return Number.POSITIVE_INFINITY;
  return Math.ceil(((distanceKm * roadFactor) / avgKmh) * 60);
}

export interface ExpectedCandidate {
  slotAt: Date | null; // confirmed slot
  pingAt: Date | null; // last consented location ping
  etaMin: number | null; // from the last ping
}

export const STALE_PING_MS = 10 * 60_000;

/** Expected arrival instant: fresh ping ETA wins over the booked slot. */
export function expectedArrival(c: ExpectedCandidate, now: Date): Date | null {
  if (c.pingAt && c.etaMin != null && now.getTime() - c.pingAt.getTime() <= STALE_PING_MS) {
    return new Date(c.pingAt.getTime() + c.etaMin * 60_000);
  }
  return c.slotAt;
}

export function countExpectedWithin(cands: ExpectedCandidate[], now: Date, windowMin = 30): number {
  const end = now.getTime() + windowMin * 60_000;
  let n = 0;
  for (const c of cands) {
    const a = expectedArrival(c, now);
    if (a && a.getTime() >= now.getTime() - 15 * 60_000 && a.getTime() <= end) n++;
  }
  return n;
}

export const ARRIVAL_RADIUS_KM = 0.15;
export const isValidCoord = (lat: unknown, lng: unknown): boolean =>
  typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

export interface ExpectedRow extends ExpectedCandidate { confirmed: boolean }

/** Branch-board numbers for the alert: total expected in the window, how many are confirmed, how many are tracked live. */
export function summarizeExpected(rows: ExpectedRow[], now: Date, windowMin = 30): { expected: number; confirmed: number; live: number } {
  const end = now.getTime() + windowMin * 60_000;
  const start = now.getTime() - 15 * 60_000;
  let expected = 0, confirmed = 0, live = 0;
  for (const r of rows) {
    const a = expectedArrival(r, now);
    if (!a || a.getTime() < start || a.getTime() > end) continue;
    expected++;
    if (r.confirmed) confirmed++;
    if (r.pingAt && r.etaMin != null && now.getTime() - r.pingAt.getTime() <= STALE_PING_MS) live++;
  }
  return { expected, confirmed, live };
}
