import type { KpiTone } from "@/components/process-performance/DashboardKit";
import {
  DASH,
  fmtHc,
  fmtNum,
  fmtPct,
  type ManpowerSection,
  type Matrix,
} from "./onfidoReportShared";

/**
 * Headline tiles for the Overview tab. Every value comes from the report the Overview
 * already loads (manpower snapshot plus the latest bucket of each trend), so the strip adds
 * no request and shows exactly the numbers in the tables below it. A figure with no source
 * is a dash, never an invented number.
 */

export interface LatestPoint {
  value: number;
  bucket: string;
}

/** The most recent non-null value of one matrix row, with the bucket (period) it belongs to. */
export function latestPoint(
  matrix: Matrix | null | undefined,
  rowIndex = 0,
): LatestPoint | null {
  const row = matrix?.rows[rowIndex];
  if (!matrix || !row) return null;
  for (let i = row.values.length - 1; i >= 0; i--) {
    const value = row.values[i];
    if (value !== null && value !== undefined)
      return { value, bucket: matrix.buckets[i] ?? "" };
  }
  return null;
}

export type OnfidoKpiKey =
  | "activeHc"
  | "approvedHc"
  | "buffer"
  | "shortfall"
  | "attrition"
  | "shrinkage"
  | "docAht"
  | "poaAht";

export interface OnfidoKpi {
  key: OnfidoKpiKey;
  label: string;
  value: string;
  sub?: string;
  tone: KpiTone;
}

export interface OverviewKpiInput {
  manpower: ManpowerSection | null | undefined;
  attrition: Matrix | null | undefined;
  shrinkage: Matrix | null | undefined;
  docAht: Matrix | null | undefined;
  poaAht: Matrix | null | undefined;
}

export function buildOverviewKpis(input: OverviewKpiInput): OnfidoKpi[] {
  const mp = input.manpower;
  const attrition = latestPoint(input.attrition);
  const shrinkage = latestPoint(input.shrinkage);
  const docAht = latestPoint(input.docAht);
  const poaAht = latestPoint(input.poaAht);
  const seconds = (p: LatestPoint | null) =>
    p ? `${fmtNum(p.value, 0)}s` : DASH;

  return [
    {
      key: "activeHc",
      label: "Active HC",
      value: fmtHc(mp?.activeHc),
      sub: mp?.asOf ? `as on ${mp.asOf}` : undefined,
      tone: "sky",
    },
    {
      key: "approvedHc",
      label: "Approved HC",
      value: fmtHc(mp?.approvedHc),
      tone: "indigo",
    },
    {
      key: "buffer",
      label: "Buffer %",
      value: fmtPct(mp?.bufferPct),
      tone:
        mp?.bufferPct !== null &&
        mp?.bufferPct !== undefined &&
        mp.bufferPct < 0
          ? "rose"
          : "emerald",
    },
    {
      key: "shortfall",
      label: "Shortfall",
      value: fmtHc(mp?.shortfall),
      tone: "amber",
    },
    {
      key: "attrition",
      label: "Attrition %",
      value: attrition ? fmtPct(attrition.value) : DASH,
      sub: attrition?.bucket,
      tone: "rose",
    },
    {
      key: "shrinkage",
      label: "Shrinkage %",
      value: shrinkage ? fmtPct(shrinkage.value) : DASH,
      sub: shrinkage?.bucket,
      tone: "violet",
    },
    {
      key: "docAht",
      label: "Doc AHT",
      value: seconds(docAht),
      sub: docAht?.bucket,
      tone: "teal",
    },
    {
      key: "poaAht",
      label: "POA AHT",
      value: seconds(poaAht),
      sub: poaAht?.bucket,
      tone: "cyan",
    },
  ];
}
