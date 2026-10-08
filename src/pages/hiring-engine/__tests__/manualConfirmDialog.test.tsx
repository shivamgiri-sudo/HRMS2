/** Manual "mark confirmed": model + static markup of the form (node env). Submitting needs the live check. */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { get: vi.fn(), post: vi.fn() } }));

import { ManualConfirmForm } from "../responses/ManualConfirmDialog";
import { formErrors, initialForm, manualBody, slotLine, type ManualForm } from "../responses/manualConfirmModel";

const RID = "11111111-1111-1111-1111-111111111111";
const noop = () => undefined;
const form = (o: Partial<ManualForm> = {}): ManualForm => ({ requisitionId: RID, answer: "confirm", via: "phone_call", note: "Said yes on call", ...o });

describe("manual confirm model", () => {
  it("requisition and a 3..300 character note are required", () => {
    expect(formErrors(form())).toEqual([]);
    expect(formErrors(form({ requisitionId: "", note: "ok" }))).toEqual(["Pick the requisition", "Write a note of 3 to 300 characters (what the candidate said)"]);
    expect(formErrors(form({ note: "x".repeat(301) }))).toHaveLength(1);
  });
  it("prefills the requisition when known or when there is only one choice", () => {
    expect(initialForm({ name: "A", requisitionId: RID }, []).requisitionId).toBe(RID);
    expect(initialForm({ name: "A" }, [{ id: "X", label: "x" }]).requisitionId).toBe("X");
    expect(initialForm({ name: "A" }, [{ id: "X", label: "x" }, { id: "Y", label: "y" }]).requisitionId).toBe("");
  });
  it("body carries the person ids it has, the note trimmed", () => {
    expect(manualBody({ name: "A", leadId: "L1" }, form({ note: "  yes  " }))).toEqual({ requisitionId: RID, answer: "confirm", via: "phone_call", note: "yes", leadId: "L1" });
    expect(manualBody({ name: "A", metaLeadId: "ML1" }, form())).toMatchObject({ metaLeadId: "ML1" });
  });
  it("says what happens to the booking before saving", () => {
    expect(slotLine({ name: "A", slotAt: "2026-10-09 10:30:00" }, form())).toBe("The slot 9 Oct, 10:30 is confirmed and the reminders start.");
    expect(slotLine({ name: "A" }, form())).toMatch(/nearest free slot/);
    expect(slotLine({ name: "A" }, form({ answer: "decline" }))).toMatch(/Nothing is booked/);
    expect(slotLine({ name: "A", slotAt: "2026-10-09 10:30:00" }, form({ answer: "reschedule" }))).toMatch(/released and new times are offered/);
  });
});

describe("ManualConfirmForm", () => {
  const html = (p: Partial<React.ComponentProps<typeof ManualConfirmForm>> = {}) => renderToStaticMarkup(
    <ManualConfirmForm target={{ name: "Asha", leadId: "L1" }} choices={[{ id: RID, label: "REQ-1 Agent" }]} form={form()} errors={[]} showErrors={false} busy={false} serverError={null}
      onChange={noop} onSubmit={noop} onCancel={noop} {...p} />);
  it("labelled fields, three answers as radios, 44px targets, the slot line", () => {
    const h = html();
    expect(h).toContain("REQ-1 Agent");
    expect((h.match(/type="radio"/g) ?? []).length).toBe(3);
    expect(h).toContain("Note (required)");
    expect(h).toContain("min-h-11");
    expect(h).toContain("data-slot-line");
    expect(h).toContain("Save answer");
  });
  it("a known requisition is shown, not picked", () => {
    const h = html({ target: { name: "Asha", requisitionId: RID } });
    expect(h).not.toMatch(/-req"/);
    expect(h).toContain("Requisition: </span>REQ-1 Agent");
    expect(html()).toMatch(/<select id="mc-[^"]*-req"/);
  });
  it("errors after a try, and the server's message", () => {
    const h = html({ errors: ["Pick the requisition"], showErrors: true, serverError: "Requisition not found" });
    expect(h).toContain("Pick the requisition");
    expect(h).toContain("Requisition not found");
  });
});
