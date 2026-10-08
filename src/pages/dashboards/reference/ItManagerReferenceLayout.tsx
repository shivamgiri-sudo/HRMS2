import type { ReactNode } from "react";
import { useState } from "react";
import { Headphones, HardDrive, Server, ShieldX, Upload, Users } from "lucide-react";

import { ActionCenter, DashHero, InsightGrid, LazySection, SectionTitle, SignalList, formatUnit } from "../kit";
import { ReferenceMetricGrid, ReferenceQuickLink } from "../ReferenceDashboardUI";
import type { ReferenceDashboardData } from "../reference-dashboard-model";
import { asRecord, metricDetail, metricUnavailableReason, metricValue } from "../reference-dashboard-model";
import { ExitPipelinePanel, OnboardingFunnelPanel } from "./ReferenceSharedPanels";
import { TodayCelebrationsWidget } from "@/components/dashboard/TodayCelebrationsWidget";
import { ProvisioningTab } from "./itmanager/ProvisioningTab";
import { HelpdeskTab } from "./itmanager/TicketsTab";
import { EmployeeDirectoryTab } from "./itmanager/EmployeeDirectoryTab";
import { BulkUploadTab } from "./itmanager/BulkUploadTab";
import { MetricStrip, SlaBoard } from "./itmanager/SlaBoard";

type Tab = "provisioning" | "helpdesk" | "employees" | "bulk_upload";
const TABS: Array<[Tab, string, typeof Server]> = [["provisioning", "Provisioning Queue", Server], ["helpdesk", "Helpdesk Tickets", Headphones], ["employees", "Employee IT Directory", Users], ["bulk_upload", "Bulk Upload", Upload]];

export function ItManagerReferenceLayout({ data, filters }: { data: ReferenceDashboardData; filters?: ReactNode }) {
  const m = data.metrics;
  const drill: (key: string) => { onDrilldown?: () => void } = data.drilldownFor ?? (() => ({}));
  const [tab, setTab] = useState<Tab>("provisioning");
  const ins = data.insights;
  const loading = Boolean(data.insightsLoading);
  const kpis = ins?.kpis ?? [];
  const by = (keys: string[]) => keys.map((k) => kpis.find((x) => x.key === k)).filter((x): x is NonNullable<typeof x> => Boolean(x));
  const onDrill = (k: { drill?: { metricCode: string; filters?: Record<string, string> }; label: string }) => k.drill && data.openDrill?.(k.drill.metricCode, k.label, k.drill.filters);

  const itProv = data.itProvisioning ?? {};
  const itFull = asRecord(data.itDashboard);
  const provData = asRecord(itFull.provisioning ?? itProv);
  const helpdesk = asRecord(itFull.helpdesk);
  const employees = Array.isArray(itFull.employees) ? (itFull.employees as Record<string, unknown>[]) : [];
  const f = (key: string) => { const k = kpis.find((x) => x.key === key); const v = formatUnit(k?.value ?? null, k?.unit); return `${v.text}${v.suffix}`; };
  const breached = kpis.find((x) => x.key === "sla_overdue")?.value ?? null;
  const exitsPending = kpis.find((x) => x.key === "pending_exit_tasks")?.value ?? null;

  return (
    <div className="space-y-5">
      <DashHero
        accent="cyan" icon={Server} eyebrow="IT Manager View" title="IT Operations Board"
        subtitle="Provisioning SLAs, leaver access, assets and helpdesk"
        headline={{ label: "Joiner tasks past SLA", value: loading ? "…" : f("sla_overdue"), caption: breached === 0 ? "Every joiner task is inside its SLA." : breached === null ? "Provisioning source unavailable" : "New joiners are waiting beyond the committed time." }}
        health={undefined}
        stats={[
          { label: "Joiner tasks pending", value: f("pending_joiner_tasks"), href: "/provisioning/it" },
          { label: "Leavers with access", value: f("pending_exit_tasks"), tone: exitsPending ? "bad" : "good", href: "/provisioning/it" },
          { label: "Joining in 7d", value: f("joiners_week"), href: "/provisioning/it" },
          { label: "Open tickets", value: f("open_tickets"), href: "/helpdesk" },
          { label: "SLA met (tickets)", value: f("tickets_sla"), href: "/helpdesk" },
          { label: "Assets registered", value: f("assets_total"), href: "/assets-manager" },
        ]}
        right={filters}
      />
      <TodayCelebrationsWidget />

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <div><SectionTitle hint="live queues, click a lane to work it">SLA board</SectionTitle><div className="mt-3"><SlaBoard actions={ins?.actions} loading={loading} /></div></div>
        <ActionCenter actions={ins?.actions} loading={loading} error={data.insightsError} title="Work queue by urgency" limit={6} />
      </div>

      <SectionTitle>Provisioning demand (from the IT bundle)</SectionTitle>
      <ReferenceMetricGrid columns={3} loading={data.loading} metrics={[
        { label: "Incoming Joiners", value: metricDetail(m, "onb", "pending") ?? metricValue(m, "onb"), helper: "accounts and assets to provision", icon: Users, tone: "amber", href: "/provisioning/it", unavailableReason: metricUnavailableReason(m, "onb"), ...drill("onb") },
        { label: "Exits To Deprovision", value: metricDetail(m, "resign", "totalActive") ?? metricValue(m, "resign"), helper: "revoke access and recover assets", icon: ShieldX, tone: "red", href: "/provisioning/it", unavailableReason: metricUnavailableReason(m, "resign"), ...drill("resign") },
        { label: "Active Headcount", value: metricDetail(m, "hc", "active") ?? metricValue(m, "hc"), helper: "accounts under management", icon: HardDrive, tone: "blue", unavailableReason: metricUnavailableReason(m, "hc"), ...drill("hc") },
      ]} />

      <SectionTitle>Helpdesk</SectionTitle>
      <MetricStrip kpis={by(["open_tickets", "tickets_aged", "tickets_sla", "tickets_fcr", "tickets_avg_res", "joiners_week"])} onDrill={onDrill} />
      <SectionTitle>Assets, warranty and devices</SectionTitle>
      <MetricStrip kpis={by(["assets_total", "assets_available", "assets_assigned", "assets_repair", "assets_lost", "warranty_30d", "biometric_devices", "biometric_enrolled"])} onDrill={onDrill} />

      <LazySection><SignalList signals={ins?.signals} loading={loading} title="Risks and insights" /></LazySection>
      <InsightGrid series={ins?.series} tables={ins?.tables} loading={loading} />

      <SectionTitle hint="provisioning detail, helpdesk history, directory and bulk sync">Workbench</SectionTitle>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex overflow-x-auto border-b border-slate-200" role="tablist">
          {TABS.map(([key, label, Icon]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
              className={`flex shrink-0 items-center gap-2 px-5 py-3 text-sm font-medium ${tab === key ? "border-b-2 border-cyan-600 bg-cyan-50 text-cyan-800" : "text-slate-500 hover:bg-slate-50"}`}>
              <Icon className="h-4 w-4" />{label}
            </button>
          ))}
        </div>
        <div className="p-4">
          {tab === "provisioning" && <ProvisioningTab it={provData} itProv={itProv} available={data.itProvisioningAvailable !== false} />}
          {tab === "helpdesk" && <HelpdeskTab helpdesk={helpdesk} />}
          {tab === "employees" && <EmployeeDirectoryTab employees={employees} />}
          {tab === "bulk_upload" && <BulkUploadTab />}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ReferenceQuickLink href="/provisioning/it" title="IT Provisioning Queue" icon={Server} />
        <ReferenceQuickLink href="/helpdesk" title="Helpdesk" icon={Headphones} />
        <ReferenceQuickLink href="/assets-manager" title="Assets Manager" icon={HardDrive} />
        <ReferenceQuickLink href="/it-provisioning" title="Provisioning Tracker" icon={Users} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <OnboardingFunnelPanel data={data} />
        <ExitPipelinePanel data={data} />
      </div>
    </div>
  );
}
