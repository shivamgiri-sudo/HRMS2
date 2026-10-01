import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RequestList } from "../RequestList";
import { normalizeSwap } from "../normalize";

const now = new Date("2026-10-02T10:00:00Z");
const swap = (extra: object = {}) => normalizeSwap({ id: "u", requester_employee_id: "e", target_employee_id: "f", swap_date: "2026-10-03", status: "pending", created_at: "2026-10-02T09:00:00Z", requester_name: "Asha", target_name: "Ravi", reason: "family event", ...extra } as any, now);
const urgent = swap();

describe("RequestList", () => {
  it("renders employee, kind label, reason and SLA chip", () => {
    const html = renderToStaticMarkup(<RequestList requests={[urgent]} selectedKey={null} onSelect={() => {}} />);
    expect(html).toContain("Asha");
    expect(html).toContain("Shift swap");
    expect(html).toContain("family event");
    expect(html).toContain("Urgent");
  });
  it("shows an empty state", () => {
    const html = renderToStaticMarkup(<RequestList requests={[]} selectedKey={null} onSelect={() => {}} />);
    expect(html).toContain("No pending roster requests");
  });
  it("marks the selected row", () => {
    const html = renderToStaticMarkup(<RequestList requests={[urgent]} selectedKey="swap:u" onSelect={() => {}} />);
    expect(html).toContain('aria-selected="true"');
  });
  it("badges swap counterpart state", () => {
    const render = (s: any) => renderToStaticMarkup(<RequestList requests={[s]} selectedKey={null} onSelect={() => {}} />);
    expect(render(swap({ counterpart_status: "pending" }))).toContain("Awaiting counterpart");
    expect(render(swap({ counterpart_status: "declined" }))).toContain("Counterpart declined");
    const accepted = render(swap({ counterpart_status: "accepted" }));
    expect(accepted).not.toContain("Awaiting counterpart");
    expect(accepted).not.toContain("Counterpart declined");
    expect(render(urgent)).not.toContain("counterpart");
  });
});
