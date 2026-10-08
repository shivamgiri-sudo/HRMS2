import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RejoinDecisionBarView, type DecisionBarViewProps } from "../RejoinDecisionBar";
import { decide } from "../rejoinDecisionRules";
import type { RehireVerdict } from "../rejoinTypes";

const eligible: RehireVerdict = { status: "eligible", reasons: [], requiresFreshOnboarding: false, requiresAbscondingAck: false };
const absconder: RehireVerdict = {
  status: "review",
  reasons: [{ code: "ABSCONDING", severity: "review", message: "Left by absconding." }],
  requiresFreshOnboarding: false,
  requiresAbscondingAck: true,
};
const blocked: RehireVerdict = {
  status: "blocked",
  reasons: [{ code: "TERMINATED", severity: "blocked", message: "Terminated employees cannot rejoin." }],
  requiresFreshOnboarding: false,
  requiresAbscondingAck: false,
};

const noop = () => {};

function render(over: { eligibility?: RehireVerdict; status?: string; remarks?: string; ack?: boolean } & Partial<DecisionBarViewProps> = {}) {
  const remarks = over.remarks ?? "";
  const acknowledged = over.ack ?? false;
  const state = decide({ requestStatus: over.status ?? "pending", eligibility: over.eligibility ?? eligible, remarks, abscondingAcknowledged: acknowledged });
  return renderToStaticMarkup(
    <RejoinDecisionBarView
      state={state}
      remarks={remarks}
      acknowledged={acknowledged}
      pendingAction={over.pendingAction ?? null}
      error={over.error ?? null}
      onRemarksChange={noop}
      onAcknowledgedChange={noop}
      onApprove={noop}
      onReject={noop}
    />,
  );
}

/** The opening tag of the button whose visible text is `label`. */
const button = (html: string, label: string) => {
  const at = html.indexOf(`>${label}<`);
  expect(at, `no ${label} button`).toBeGreaterThan(-1);
  const start = html.lastIndexOf("<button", at);
  return html.slice(start, html.indexOf(">", start) + 1);
};
/** The real attribute, not Tailwind's `disabled:` variant classes. */
const disabled = (tag: string) => /\sdisabled(="")?[\s>]/.test(tag);

describe("RejoinDecisionBarView", () => {
  it("empty remarks: both buttons disabled, counter and reason shown", () => {
    const out = render();
    expect(disabled(button(out, "Approve"))).toBe(true);
    expect(disabled(button(out, "Reject"))).toBe(true);
    expect(out).toContain("0/5 min");
    expect(out).toContain("Remarks need at least 5 characters (0/5).");
    expect(out).not.toContain("absconding-ack");
  });

  it("enough remarks on an eligible request: both enabled, no reason line", () => {
    const out = render({ remarks: "Good record, approve" });
    expect(disabled(button(out, "Approve"))).toBe(false);
    expect(disabled(button(out, "Reject"))).toBe(false);
    expect(out).not.toContain("Remarks need at least");
  });

  it("absconder: shows the acknowledgement and requires it plus 20 characters", () => {
    const out = render({ eligibility: absconder, remarks: "short but ok" });
    expect(out).toContain('id="absconding-ack"');
    expect(out).toContain("absconded");
    expect(disabled(button(out, "Approve"))).toBe(true);
    expect(disabled(button(out, "Reject"))).toBe(false);
    expect(out).toContain("12/20 min to approve");
    expect(out).toContain("tick the acknowledgement");
  });

  it("absconder acknowledged with long remarks: Approve enabled", () => {
    const out = render({ eligibility: absconder, remarks: "Spoke to the employee, family emergency.", ack: true });
    expect(disabled(button(out, "Approve"))).toBe(false);
  });

  it("blocked: Approve disabled with the blocking reason, Reject still allowed", () => {
    const out = render({ eligibility: blocked, remarks: "Not possible, terminated" });
    expect(disabled(button(out, "Approve"))).toBe(true);
    expect(disabled(button(out, "Reject"))).toBe(false);
    expect(out).toContain("Rejoin is blocked: Terminated employees cannot rejoin. You can still reject.");
  });

  it("not pending: both disabled with the reason once", () => {
    const out = render({ status: "approved", remarks: "Whatever remarks here" });
    expect(disabled(button(out, "Approve"))).toBe(true);
    expect(disabled(button(out, "Reject"))).toBe(true);
    expect(out.split("no longer pending").length - 1).toBe(1);
  });

  it("legacy 'branch_head_approved': the branch head can still approve or reject", () => {
    const out = render({ status: "branch_head_approved", remarks: "Good record, approve" });
    expect(disabled(button(out, "Approve"))).toBe(false);
    expect(disabled(button(out, "Reject"))).toBe(false);
    expect(out).not.toContain("no longer pending");
  });

  it("while a decision is in flight both buttons are disabled", () => {
    const out = render({ remarks: "Good record, approve", pendingAction: "approved" });
    expect(disabled(button(out, "Approving…"))).toBe(true);
    expect(disabled(button(out, "Reject"))).toBe(true);
  });

  it("shows the backend message inline as an alert", () => {
    const out = render({ remarks: "Good record, approve", error: "Terminated employees cannot rejoin." });
    expect(out).toContain('role="alert"');
    expect(out).toContain("Terminated employees cannot rejoin.");
  });

  it("sticks to the bottom below md (the scroll container already clears the mobile nav) and is a normal card from md", () => {
    const out = render();
    expect(out).toContain("max-md:sticky");
    expect(out).toContain("max-md:bottom-0");
    expect(out).not.toMatch(/(^|\s)sticky(\s|")/);
  });
});
