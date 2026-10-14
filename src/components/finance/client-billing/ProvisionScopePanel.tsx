// src/components/finance/client-billing/ProvisionScopePanel.tsx
/**
 * The legacy proforma screen's "Category / <month> / Total Revenue" strip: which provision
 * this proforma will draw from, its balance, and whether the taxable total fits. The server
 * enforces the same rule (client-billing-provision.service.ts drawDownForInvoice); this panel
 * only tells the user before they press Create.
 */
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { getProvisionForScope } from "@/lib/clientBillingApi";
import { money } from "./shared";

export function ProvisionScopePanel({
  costCentreId, financeYear, monthLabel, taxableTotal, alreadyDrawn = 0,
}: {
  costCentreId: string;
  financeYear: string;
  monthLabel: string;
  taxableTotal: number;
  /** On edit, what this invoice already drew (given back before re-drawing). */
  alreadyDrawn?: number;
}) {
  const enabled = Boolean(costCentreId && financeYear && monthLabel);
  const q = useQuery({
    queryKey: ["client-billing", "provision-scope", costCentreId, financeYear, monthLabel],
    queryFn: () => getProvisionForScope(costCentreId, financeYear, monthLabel),
    enabled,
  });
  if (!enabled) {
    return (
      <div className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
        Pick cost centre and month to see the provision this proforma draws from.
      </div>
    );
  }
  if (q.isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking provision…
      </div>
    );
  }
  const p = q.data?.data ?? null;
  const required = q.data?.required ?? true;
  const approved = p?.provision_status === "approved";
  const balance = approved ? Number(p!.provision_balance) + alreadyDrawn : 0;
  const fits = approved && taxableTotal <= balance;
  const blocking = required && (!approved || !fits);
  const tone = blocking ? "border-amber-300 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900";

  return (
    <div className={`rounded-md border px-3 py-2 text-xs ${tone}`} role="status" aria-live="polite">
      <div className="flex items-center gap-2 font-semibold">
        {blocking ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
        Provision · {monthLabel} ({financeYear})
      </div>
      {!p && <p className="mt-1">No provision raised for this cost centre and month. Create it in the Provision tab and get it approved first.</p>}
      {p && !approved && <p className="mt-1">Provision of {money(p.provision_amount)} is <b>pending approval</b> — it can be drawn only after approval.</p>}
      {p && approved && (
        <div className="mt-1 grid grid-cols-3 gap-2 tabular-nums">
          <span>Provision: <b>{money(p.provision_amount)}</b></span>
          <span>Available: <b>{money(balance)}</b></span>
          <span>This proforma: <b>{money(taxableTotal)}</b></span>
        </div>
      )}
      {p && approved && !fits && <p className="mt-1">Taxable total is more than the available balance. Edit the provision amount first.</p>}
      {!required && blocking && <p className="mt-1 opacity-80">Provision is not enforced on this server, so the proforma will still save.</p>}
    </div>
  );
}
