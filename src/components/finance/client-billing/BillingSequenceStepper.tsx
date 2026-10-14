// src/components/finance/client-billing/BillingSequenceStepper.tsx
/**
 * The legacy I-Spark invoicing order, shown as a clickable step bar above the tabs:
 * Provision -> Proforma -> Approve Proforma -> Invoice Approval -> Download.
 * Each step opens the tab where that work happens; the counts are what is waiting there.
 */
import { CheckCircle2, ClipboardList, Download, FileSignature, FilePlus2, Stamp, Wallet } from "lucide-react";
import type { ComponentType } from "react";

export type BillingTab = "provisions" | "proformas" | "invoice-approval" | "invoices" | "receipts" | "credit-notes";

interface Step {
  tab: BillingTab;
  title: string;
  hint: string;
  icon: ComponentType<{ className?: string }>;
}

const STEPS: Step[] = [
  { tab: "provisions", title: "Provision", hint: "Create & approve", icon: ClipboardList },
  { tab: "proformas", title: "Proforma", hint: "Create from provision", icon: FilePlus2 },
  { tab: "proformas", title: "Approve Proforma", hint: "Check figures", icon: FileSignature },
  { tab: "invoice-approval", title: "Invoice Approval", hint: "Bill no. generated", icon: Stamp },
  { tab: "invoices", title: "Download", hint: "PDF · Letter head · Export", icon: Download },
  { tab: "receipts", title: "Received", hint: "Receipts · TDS · bank", icon: Wallet },
];

export function BillingSequenceStepper({
  active, onSelect, counts,
}: {
  active: BillingTab;
  onSelect: (tab: BillingTab) => void;
  /** Waiting items per step index (pending provisions, -, awaiting proforma approval, awaiting invoice approval, -). */
  counts: Array<number | undefined>;
}) {
  return (
    <nav aria-label="Invoicing steps" className="border-b bg-white px-4 py-2">
      <ol className="flex gap-1 overflow-x-auto">
        {STEPS.map((step, i) => {
          const isActive = step.tab === active;
          const Icon = step.icon;
          const count = counts[i];
          return (
            <li key={step.title} className="flex min-w-0 flex-1 items-center">
              <button
                type="button"
                onClick={() => onSelect(step.tab)}
                aria-current={isActive ? "step" : undefined}
                className={`flex w-full min-w-[150px] cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                  isActive
                    ? "border-blue-300 bg-blue-50 text-blue-900"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                }`}
              >
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                  isActive ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"
                }`}>
                  {i + 1}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1 text-xs font-semibold">
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{step.title}</span>
                  </span>
                  <span className="block truncate text-[11px] text-slate-500">{step.hint}</span>
                </span>
                {count !== undefined && (
                  count > 0 ? (
                    <span className="ml-auto rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800" title={`${count} waiting`}>
                      {count}
                    </span>
                  ) : (
                    <CheckCircle2 className="ml-auto h-3.5 w-3.5 shrink-0 text-emerald-600" aria-label="Nothing waiting" />
                  )
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
