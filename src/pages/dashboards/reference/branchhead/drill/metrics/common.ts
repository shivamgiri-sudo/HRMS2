import type { BranchHeadHealthPayload, BranchOverview } from "../../../../../../../backend/src/modules/branch-head-health/types";
import type { DrillTarget } from "../../drill";

/** What every metric view receives: the branch overview, the payload (process joins) and the swap callback. */
export interface MetricProps {
  overview: BranchOverview;
  payload: BranchHeadHealthPayload;
  /** Trend values per backend metric (useBranchTrends). */
  trends: Record<string, Array<number | null>>;
  /** Opens another view in the same drawer (a process row swaps the content, with Back). */
  onOpen: (target: DrillTarget) => void;
}

/** VisualProps for the sections' select helpers, routed into the drawer. */
export const asVisual = (p: MetricProps) => ({ overview: p.overview, payload: p.payload, onSelect: p.onOpen });
