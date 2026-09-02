import { useState } from "react";
import { useHasRole } from "@/hooks/useUserRole";
import { GrnSegmented } from "@/components/finance/grn/grn-ui";
import { ImprestApprovalQueue } from "@/components/finance/grn/ImprestApprovalQueue";
import { ImprestAllocationPanel } from "@/components/finance/grn/imprest/ImprestAllocationPanel";
import { ImprestReportPanel } from "@/components/finance/grn/imprest/ImprestReportPanel";
import { ImprestManagerPanel } from "@/components/finance/grn/imprest/ImprestManagerPanel";
import { ImprestAdjustmentPanel } from "@/components/finance/grn/imprest/ImprestAdjustmentPanel";

/**
 * The five imprest surfaces, under one tab.
 *
 * Approvals, allocation and the report are one workflow read three ways — a reviewer clearing
 * vouchers wants the float balance behind them, and someone topping a float up wants to see
 * what it was spent on. Splitting them across three top-level tabs (or three routed pages)
 * would put a page load between questions that get asked together, and would need three more
 * page codes, three nav entries and three sets of role grants to stay reachable.
 *
 * Approvals leads because it is the only one with work waiting in it. Managers sits last: it
 * is set up once and then rarely touched — but nothing else here functions until it has a row,
 * since an allocation needs a holder to credit and an approved voucher needs one to debit.
 *
 * Adjustment is deliberately its own pane, not a mode of Allocation: a correcting entry with no
 * bank transfer behind it is a different mental model from a real funded top-up, and this is the
 * literal screen fix-imprest-rebalance.ts's own output already tells Finance to use ("post
 * correcting credits via the Imprest Adjustment entry in the UI") — it did not exist before.
 */

type Pane = "approvals" | "allocation" | "adjustment" | "report" | "managers";

export function ImprestWorkspace() {
  const [pane, setPane] = useState<Pane>("approvals");
  // Same authority as posting the adjustment itself (Owner ruling 2026-08-17) — a role that
  // would only get a 403 from the endpoint should not be offered the tab at all.
  const canAdjust = useHasRole("finance_head", "super_admin");

  return (
    <div className="space-y-4">
      <GrnSegmented<Pane>
        label="Imprest view"
        value={pane}
        onChange={setPane}
        options={[
          { value: "approvals", label: "Approvals" },
          { value: "allocation", label: "Allocation" },
          ...(canAdjust ? [{ value: "adjustment" as const, label: "Adjustment" }] : []),
          { value: "report", label: "Report" },
          { value: "managers", label: "Managers" },
        ]}
      />
      {pane === "approvals" && <ImprestApprovalQueue />}
      {pane === "allocation" && <ImprestAllocationPanel />}
      {pane === "adjustment" && canAdjust && <ImprestAdjustmentPanel />}
      {pane === "report" && <ImprestReportPanel />}
      {pane === "managers" && <ImprestManagerPanel />}
    </div>
  );
}
