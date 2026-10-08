export type EtmQueueKey = "doc" | "poa";

export interface EtmQueueSeriesPoint { bucket: string; count: number }

/** Reduce the mixed DOC+POA trend rows to the single selected ETM queue. */
export function pickEtmQueueSeries(
  points: Array<{ bucket: string; doc: number; poa: number }>,
  queue: EtmQueueKey,
): EtmQueueSeriesPoint[] {
  return points.map((p) => ({ bucket: p.bucket, count: Number(p[queue] ?? 0) }));
}

export function etmTrendTitle(queueLabel: string, granularity: "daily" | "weekly" | "monthly"): string {
  const g = granularity === "daily" ? "Day-wise" : granularity === "weekly" ? "Week-wise" : "Month-wise";
  return `${queueLabel} · ${g} Trend`;
}
