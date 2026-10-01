import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { actionsForKind, approveDisabledReason, canQuickApprove } from "../actions";
import { RequestList } from "../RequestList";
import { normalizeSwap } from "../normalize";

const swap = (extra: object = {}) => normalizeSwap({ id: "u", requester_employee_id: "e", swap_date: "2026-10-03", created_at: "2026-10-02T09:00:00Z", requester_name: "Asha", ...extra } as any);
const impact = (blockers: string[] = []) => ({ blockers, warnings: [], locked: false, rest: [], sameDayHeadcount: null, week: [] });

describe("actionsForKind", () => {
  it("matches the backend table", () => {
    const names = (k: any) => actionsForKind(k).map((a) => a.action);
    expect(names("swap")).toEqual(["approve", "reject"]);
    expect(names("weekoff_rejection")).toEqual(["approve", "reject", "realign", "escalate"]);
    expect(names("dispute")).toEqual(["approve", "reject"]);
    expect(names("conflict")).toEqual(["approve"]);
  });
  it("only swap approve needs no reason", () => {
    expect(actionsForKind("swap")[0].needsReason).toBe(false);
    expect(actionsForKind("dispute")[0].needsReason).toBe(true);
  });
});

describe("approveDisabledReason", () => {
  it("disables with blockers", () => {
    expect(approveDisabledReason(swap(), impact(["Rest violation"]))).toContain("Rest violation");
  });
  it("disables until impact loaded", () => { expect(approveDisabledReason(swap(), undefined)).toBeTruthy(); });
  it("disables for unaccepted counterpart unless forced", () => {
    const s = swap({ counterpart_status: "pending" });
    expect(approveDisabledReason(s, impact())).toBe("Counterpart has not accepted");
    expect(approveDisabledReason(s, impact(), true)).toBeNull();
    expect(approveDisabledReason(s, impact(["x"]), true)).toContain("x");
  });
  it("allows clean accepted swap", () => { expect(approveDisabledReason(swap({ counterpart_status: "accepted" }), impact())).toBeNull(); });
  it("quick approve only for reasonless kinds", () => {
    expect(canQuickApprove(swap(), impact())).toBe(true);
    expect(canQuickApprove(swap(), impact(["b"]))).toBe(false);
  });
});

describe("RequestList bulk checkbox", () => {
  it("renders only when onToggle is provided", () => {
    const r = swap();
    expect(renderToStaticMarkup(<RequestList requests={[r]} selectedKey={null} onSelect={() => {}} />)).not.toContain('type="checkbox"');
    const html = renderToStaticMarkup(<RequestList requests={[r]} selectedKey={null} onSelect={() => {}} checkedKeys={new Set([r.key])} onToggle={() => {}} />);
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("checked");
  });
});
