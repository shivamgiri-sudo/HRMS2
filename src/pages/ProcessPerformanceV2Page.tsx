import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { BellavitaMasmisUploader } from "@/components/process-performance/BellavitaMasmisUploader";
import {
  Activity, ChevronLeft, ChevronRight, LayoutDashboard, Upload,
  ShoppingBag, MessageSquare, ShoppingCart, Target, Users,
} from "lucide-react";

type CompanyKey = "bellavita" | "gnc" | "neemans";
type SectionKey = "dashboards" | "uploader";

const COMPANIES: Array<{ key: CompanyKey; label: string }> = [
  { key: "bellavita", label: "Bellavita" },
  { key: "gnc", label: "GNC" },
  { key: "neemans", label: "Neemans" },
];

/**
 * Stub dashboard entries — same "nothing built yet" state Bellavita/GNC's
 * single Dashboards stub already shows, just split into the 2 named cards
 * requested for Neemans. No real dashboard exists anywhere in this page
 * yet, so these intentionally render the same placeholder, not mock data.
 */
const NEEMANS_DASHBOARDS = [
  { key: "sale", label: "Sale Dashboard", description: "Coming soon" },
  { key: "allocation", label: "Allocation Dashboard", description: "Coming soon" },
];

const SECTIONS: Array<{ key: SectionKey; label: string; description: string }> = [
  { key: "dashboards", label: "Dashboards", description: "Coming soon" },
  { key: "uploader", label: "Uploader", description: "Bulk data uploaders" },
];

/**
 * Bellavita's 4 live uploaders only — the other 3 db_masmis upload types this process
 * already has (Repeat CDR, Repeat Allocation, Shopify Order Export) are deliberately
 * left out here per explicit scope; they remain reachable from the main Bulk Upload
 * Hub's template dropdown.
 */
const BELLAVITA_UPLOADERS = [
  { code: "BB_SALE_MASMIS", label: "Sale Data", description: "Upload Bellavita sale data", icon: ShoppingBag },
  { code: "BB_APR_MASMIS",  label: "APR Data",  description: "Upload Bellavita APR data",  icon: Activity },
  { code: "BB_CHAT_MASMIS", label: "Chat Data", description: "Upload Bellavita chat data", icon: MessageSquare },
  { code: "BB_CART_MASMIS", label: "Cart Data", description: "Upload Bellavita cart data", icon: ShoppingCart },
];

/** GNC's 3 live db_masmis uploaders (gnc_sale, gnc_apr, gnc_allocation). */
const GNC_UPLOADERS = [
  { code: "GNC_SALE_MASMIS",       label: "Sale Data",       description: "Upload GNC sale data",       icon: ShoppingBag },
  { code: "GNC_APR",               label: "APR Data",        description: "Upload GNC APR data",        icon: Activity },
  { code: "GNC_ALLOCATION_MASMIS", label: "Allocation Data", description: "Upload GNC allocation data", icon: ShoppingCart },
];

/** Neemans' 5 live db_masmis uploaders. Cart (neemans_cart, 0 rows, never
 * used) is deliberately left out here per explicit scope, same as
 * Bellavita's own left-out extras above; still reachable from the main
 * Bulk Upload Hub. */
const NEEMANS_UPLOADERS = [
  { code: "NEEMANS_SALE_RAW_MASMIS",       label: "Sale Raw",       description: "Upload Neemans sale raw data",     icon: ShoppingBag },
  { code: "NEEMANS_ALLOCATION_MASMIS",     label: "Allocation",     description: "Upload Neemans allocation data",   icon: ShoppingCart },
  { code: "NEEMANS_APR_MASMIS",            label: "APR",            description: "Upload Neemans APR data",          icon: Activity },
  { code: "NEEMANS_MONTH_TARGET_MASMIS",   label: "Target",         description: "Upload Neemans monthly target",    icon: Target },
  { code: "NEEMANS_AGENT_DETAILS_MASMIS",  label: "Agent Details",  description: "Upload Neemans agent roster",      icon: Users },
];

function BoxGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{children}</div>;
}

function Box({
  icon: Icon, label, description, onClick,
}: { icon: React.ComponentType<{ className?: string }>; label: string; description: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-indigo-300 hover:shadow-md"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-white">
          <Icon className="h-4.5 w-4.5" />
        </span>
        <div>
          <div className="text-sm font-bold text-slate-900">{label}</div>
          <div className="text-xs text-slate-500">{description}</div>
        </div>
      </div>
      <ChevronRight className="h-4 w-4 text-slate-300" />
    </button>
  );
}

function Breadcrumb({ parts, onBack }: { parts: string[]; onBack: () => void }) {
  return (
    <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
      <button type="button" onClick={onBack} className="flex items-center gap-1 hover:text-slate-900">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span>{parts.join(" / ")}</span>
    </div>
  );
}

export default function ProcessPerformanceV2Page() {
  const [company, setCompany] = useState<CompanyKey | null>(null);
  const [section, setSection] = useState<SectionKey | null>(null);
  const [selectedUploader, setSelectedUploader] = useState<{ code: string; label: string } | null>(null);
  const [selectedDashboard, setSelectedDashboard] = useState<{ key: string; label: string } | null>(null);

  const companyLabel = COMPANIES.find((c) => c.key === company)?.label ?? "";
  const sectionLabel = SECTIONS.find((s) => s.key === section)?.label ?? "";

  const reset = () => { setCompany(null); setSection(null); setSelectedUploader(null); setSelectedDashboard(null); };
  const backToCompany = () => { setSection(null); setSelectedUploader(null); setSelectedDashboard(null); };
  const backToUploaderGrid = () => setSelectedUploader(null);
  const backToDashboardGrid = () => setSelectedDashboard(null);

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
            <Activity className="h-4.5 w-4.5" />
          </span>
          <div>
            <h1 className="text-lg font-bold text-slate-900">Process Performance V2</h1>
            <p className="text-xs text-slate-500">
              {company ? (section ? `${companyLabel} / ${sectionLabel}` : companyLabel) : "Select a process"}
            </p>
          </div>
        </div>

        {/* Level 1: company picker */}
        {!company && (
          <BoxGrid>
            {COMPANIES.map((c) => (
              <Box
                key={c.key}
                icon={ShoppingBag}
                label={c.label}
                description="Open process"
                onClick={() => setCompany(c.key)}
              />
            ))}
          </BoxGrid>
        )}

        {/* Level 2: section picker (Dashboards / Uploader) */}
        {company && !section && (
          <div className="space-y-4">
            <Breadcrumb parts={[companyLabel]} onBack={reset} />
            <BoxGrid>
              {SECTIONS.map((s) => (
                <Box
                  key={s.key}
                  icon={s.key === "dashboards" ? LayoutDashboard : Upload}
                  label={s.label}
                  description={s.description}
                  onClick={() => setSection(s.key)}
                />
              ))}
            </BoxGrid>
          </div>
        )}

        {/* Level 3: Dashboards — blank for now (Bellavita/GNC: single stub) */}
        {(company === "bellavita" || company === "gnc") && section === "dashboards" && (
          <div className="space-y-4">
            <Breadcrumb parts={[companyLabel, "Dashboards"]} onBack={backToCompany} />
            <div className="flex items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white p-16 text-sm text-slate-400">
              Nothing here yet
            </div>
          </div>
        )}

        {/* Level 3: Dashboards — Neemans has 2 named stubs, same "nothing built yet" state */}
        {company === "neemans" && section === "dashboards" && !selectedDashboard && (
          <div className="space-y-4">
            <Breadcrumb parts={[companyLabel, "Dashboards"]} onBack={backToCompany} />
            <BoxGrid>
              {NEEMANS_DASHBOARDS.map((d) => (
                <Box
                  key={d.key}
                  icon={LayoutDashboard}
                  label={d.label}
                  description={d.description}
                  onClick={() => setSelectedDashboard({ key: d.key, label: d.label })}
                />
              ))}
            </BoxGrid>
          </div>
        )}

        {company === "neemans" && section === "dashboards" && selectedDashboard && (
          <div className="space-y-4">
            <Breadcrumb parts={[companyLabel, "Dashboards", selectedDashboard.label]} onBack={backToDashboardGrid} />
            <div className="flex items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white p-16 text-sm text-slate-400">
              Nothing here yet
            </div>
          </div>
        )}

        {/* Level 3: Uploader — pick a data type, then upload right here */}
        {company === "bellavita" && section === "uploader" && !selectedUploader && (
          <div className="space-y-4">
            <Breadcrumb parts={[companyLabel, "Data Uploader"]} onBack={backToCompany} />
            <BoxGrid>
              {BELLAVITA_UPLOADERS.map((u) => (
                <Box
                  key={u.code}
                  icon={u.icon}
                  label={u.label}
                  description={u.description}
                  onClick={() => setSelectedUploader({ code: u.code, label: u.label })}
                />
              ))}
            </BoxGrid>
          </div>
        )}

        {company === "bellavita" && section === "uploader" && selectedUploader && (
          <div className="space-y-4">
            <Breadcrumb parts={[companyLabel, "Data Uploader", selectedUploader.label]} onBack={backToUploaderGrid} />
            <BellavitaMasmisUploader templateCode={selectedUploader.code} label={selectedUploader.label} />
          </div>
        )}

        {company === "gnc" && section === "uploader" && !selectedUploader && (
          <div className="space-y-4">
            <Breadcrumb parts={[companyLabel, "Data Uploader"]} onBack={backToCompany} />
            <BoxGrid>
              {GNC_UPLOADERS.map((u) => (
                <Box
                  key={u.code}
                  icon={u.icon}
                  label={u.label}
                  description={u.description}
                  onClick={() => setSelectedUploader({ code: u.code, label: u.label })}
                />
              ))}
            </BoxGrid>
          </div>
        )}

        {company === "gnc" && section === "uploader" && selectedUploader && (
          <div className="space-y-4">
            <Breadcrumb parts={[companyLabel, "Data Uploader", selectedUploader.label]} onBack={backToUploaderGrid} />
            <BellavitaMasmisUploader templateCode={selectedUploader.code} label={selectedUploader.label} />
          </div>
        )}

        {company === "neemans" && section === "uploader" && !selectedUploader && (
          <div className="space-y-4">
            <Breadcrumb parts={[companyLabel, "Data Uploader"]} onBack={backToCompany} />
            <BoxGrid>
              {NEEMANS_UPLOADERS.map((u) => (
                <Box
                  key={u.code}
                  icon={u.icon}
                  label={u.label}
                  description={u.description}
                  onClick={() => setSelectedUploader({ code: u.code, label: u.label })}
                />
              ))}
            </BoxGrid>
          </div>
        )}

        {company === "neemans" && section === "uploader" && selectedUploader && (
          <div className="space-y-4">
            <Breadcrumb parts={[companyLabel, "Data Uploader", selectedUploader.label]} onBack={backToUploaderGrid} />
            <BellavitaMasmisUploader templateCode={selectedUploader.code} label={selectedUploader.label} />
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
