// WS3 D3: seat-based caps on shortlist preview runs. A requisition takes at most ceil(seats left x invites per seat) new people a day
// (policy.shortlist.invites_per_seat, default 4 = about a 25% show rate), minus the people already approved or enrolled for it today,
// so a 1-seat requisition never pulls 28k upload rows. Picks over the cap are stored as 'capped': never approved, seen again next run.
export const DEFAULT_INVITES_PER_SEAT = 4;
export const INVITES_PER_SEAT_KEY = "policy.shortlist.invites_per_seat";

export function dailySeatCap(a: { seatsLeft: number; perSeat: number; alreadyToday: number }): number {
  return Math.max(0, Math.ceil(Math.max(0, a.seatsLeft) * Math.max(0, a.perSeat)) - Math.max(0, a.alreadyToday));
}

/** The first `cap` picks stay picked (HR includes first, then score; ties keep their order); the other picks become 'capped'. */
export function applySeatCap<T extends { status: string; score: number; include: boolean }>(rows: T[], cap: number): T[] {
  const order = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.status === "picked")
    .sort((x, y) => Number(y.r.include) - Number(x.r.include) || y.r.score - x.r.score || x.i - y.i);
  const keep = new Set(order.slice(0, Math.max(0, cap)).map(({ i }) => i));
  return rows.map((r, i) => (r.status === "picked" && !keep.has(i) ? { ...r, status: "capped" } : r));
}
