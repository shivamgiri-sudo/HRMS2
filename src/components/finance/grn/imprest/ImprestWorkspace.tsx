import { useState } from "react";
import { GrnSegmented } from "@/components/finance/grn/grn-ui";
import { ImprestApprovalQueue } from "@/components/finance/grn/ImprestApprovalQueue";
import { ImprestAllocationPanel } from "@/components/finance/grn/imprest/ImprestAllocationPanel";
import { ImprestReportPanel } from "@/components/finance/grn/imprest/ImprestReportPanel";
import { ImprestManagerPanel } from "@/components/finance/grn/imprest/ImprestManagerPanel";

/**
 * The four imprest surfaces, under one tab.
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
 */

type Pane = "approvals" | "allocation" | "report" | "managers";

export function ImprestWorkspace() {
  const [pane, setPane] = useState<Pane>("approvals");

  return (
    <div className="space-y-4">
      <GrnSegmented<Pane>
        label="Imprest view"
        value={pane}
        onChange={setPane}
        options={[
          { value: "approvals", label: "Approvals" },
          { value: "allocation", label: "Allocation" },
          { value: "report", label: "Report" },
          { value: "managers", label: "Managers" },
        ]}
      />
      {pane === "approvals" && <ImprestApprovalQueue />}
      {pane === "allocation" && <ImprestAllocationPanel />}
      {pane === "report" && <ImprestReportPanel />}
      {pane === "managers" && <ImprestManagerPanel />}
    </div>
  );
}
