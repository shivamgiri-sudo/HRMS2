/**
 * Funnel depth: on the Summary, the three-drive comparison, each drive's journey, every campaign's progress and the footfall plans;
 * inside a drive section, the same pieces for that drive only (DriveFunnelDepth).
 */
import type { ReactNode } from "react";
import type { DriveAnalytics, SourceType } from "./driveCommandTypes";
import { SOURCE_TYPES } from "./driveCommandModel";
import JourneyCompare from "./charts/JourneyCompare";
import JourneyFunnel from "./charts/JourneyFunnel";
import CampaignProgressTable from "./CampaignProgressTable";
import FootfallPlan from "./FootfallPlan";
import ResponseChannels from "./ResponseChannels";

export function SummaryFunnelDepth({ analytics, planHref }: { analytics: DriveAnalytics; planHref?: string }) {
  return (
    <div className="space-y-4" data-funnel-depth="summary">
      <JourneyCompare analytics={analytics} />
      <ResponseChannels analytics={analytics} />
      <div className="grid gap-4 lg:grid-cols-3">
        {SOURCE_TYPES.map((t) => <JourneyFunnel key={t} analytics={analytics} type={t} />)}
      </div>
      <CampaignProgressTable analytics={analytics} />
      <div className="grid gap-4 lg:grid-cols-3">
        {SOURCE_TYPES.map((t) => <FootfallPlan key={t} analytics={analytics} type={t} planHref={planHref} />)}
      </div>
    </div>
  );
}

/** One drive: its journey (unless the section already shows it), its footfall plan, its insights and its campaigns (Meta drives only). */
export function DriveFunnelDepth({ analytics, type, insights, planHref, withFunnel = true }: { analytics: DriveAnalytics; type: SourceType; insights?: ReactNode; planHref?: string; withFunnel?: boolean }) {
  return (
    <div className="space-y-4" data-funnel-depth={type}>
      <div className={withFunnel ? "grid gap-4 lg:grid-cols-2" : ""}>
        {withFunnel && <JourneyFunnel analytics={analytics} type={type} />}
        <FootfallPlan analytics={analytics} type={type} planHref={planHref} />
      </div>
      <ResponseChannels analytics={analytics} only={type} />
      {insights}
      {type !== "he" && <CampaignProgressTable analytics={analytics} only={type} title="Campaign progress for this drive" />}
    </div>
  );
}
