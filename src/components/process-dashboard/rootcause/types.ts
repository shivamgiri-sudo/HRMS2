export type WhyDimension = "tl" | "lob" | "agent" | "hour";
export const WHY_DIMENSIONS: Array<{ key: WhyDimension; label: string }> = [
  { key: "tl", label: "Team leader" }, { key: "lob", label: "LOB" }, { key: "agent", label: "Agent" }, { key: "hour", label: "Hour" },
];
export interface WhySegment {
  key: string; label: string; status: "both" | "new" | "gone" | "unattributed";
  a: number | null; b: number | null; delta: number | null; contribution: number; contributionPct: number | null;
  rateEffect: number | null; mixEffect: number | null; volumeA: number; volumeB: number; shareA: number | null; shareB: number | null; lowSample: boolean; tl?: string | null;
}
export interface WhyTotal { a: number | null; b: number | null; delta: number | null; deltaPct: number | null }
export interface SumCheck { sum: number | null; expected: number | null; diff: number | null; ok: boolean }
/** a = baseline (comparison) period, b = current (selected) period, delta = b - a. */
export interface WhyResponse {
  metric: { key: string; label: string; unit: string; direction: "higher" | "lower"; kind: "additive" | "ratio" };
  dimension: WhyDimension; periods: { current: { from: string; to: string }; baseline: { from: string; to: string } };
  total: WhyTotal; segments: WhySegment[]; explanation: string[]; sumCheck: SumCheck; segmentCount: number;
  volumeUnit: string | null; minVolume: number | null; warnings: string[];
}
