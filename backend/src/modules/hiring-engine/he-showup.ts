/**
 * Show-up prediction (pure). Probability that an invited/confirmed candidate actually walks in, from base rates and
 * multipliers. Defaults are conservative industry-style numbers; once real outcomes exist the learned values from
 * he_model_param replace them (see he-showup.service.ts), so the model improves with every drive.
 */
export interface ShowFacts {
  state: "invited" | "confirmed" | string;
  walkedBefore: boolean;
  pastNoShows: number;
  distanceKm: number | null;
  sharedLocation: boolean;
  repliedPositive: boolean;
}

export type ShowParams = Record<string, number>;

export const SHOW_DEFAULTS: ShowParams = {
  "show.base.invited": 0.3,
  "show.base.confirmed": 0.55,
  "show.mult.walked_before": 1.15,
  "show.mult.past_no_show": 0.7,
  "show.mult.far": 0.8,
  "show.mult.location_shared": 1.5,
  "show.mult.replied_positive": 1.2,
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function pShow(f: ShowFacts, learned: ShowParams = {}): number {
  const p = (k: string) => learned[k] ?? SHOW_DEFAULTS[k];
  let v = f.state === "confirmed" ? p("show.base.confirmed") : p("show.base.invited");
  if (f.walkedBefore) v *= p("show.mult.walked_before");
  if (f.pastNoShows > 0) v *= Math.pow(p("show.mult.past_no_show"), Math.min(3, f.pastNoShows));
  if (f.distanceKm != null && f.distanceKm > 15) v *= p("show.mult.far");
  if (f.sharedLocation) v *= p("show.mult.location_shared");
  if (f.repliedPositive && f.state !== "confirmed") v *= p("show.mult.replied_positive");
  return Math.round(clamp(v, 0.02, 0.97) * 1000) / 1000;
}

/** How many more invites are needed to reach the target number of shows, given what is already booked. */
export function invitesToClose(targetShows: number, expectedShows: number, pNewInvite: number): number {
  const gap = targetShows - expectedShows;
  if (gap <= 0) return 0;
  return Math.ceil(gap / clamp(pNewInvite, 0.05, 1));
}

/** Learned value for a bucket = observed rate (base) or ratio to the overall rate (multiplier); null if too few samples. */
export function learnRate(shows: number, total: number, minSample = 30): number | null {
  return total >= minSample ? Math.round((shows / total) * 1000) / 1000 : null;
}
export function learnMultiplier(bucketShows: number, bucketTotal: number, overallRate: number, minSample = 30): number | null {
  if (bucketTotal < minSample || overallRate <= 0) return null;
  return Math.round(clamp(bucketShows / bucketTotal / overallRate, 0.2, 3) * 1000) / 1000;
}
