/**
 * "Appointment Letter (signed)" panel on the employee's Joining Documents page.
 */
import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { getBlob: vi.fn() } }));
const { SignedAppointmentLetterPanel } = await import("./SignedAppointmentLetterPanel");

const render = (letters: Array<Record<string, unknown>>) =>
  renderToStaticMarkup(React.createElement(SignedAppointmentLetterPanel, { employeeId: "emp-1", letters: letters as never }));

describe("SignedAppointmentLetterPanel", () => {
  it("shows the letter number, a Signed-by-employee badge, timestamp, short hash and View / Download", () => {
    const html = render([{
      issue_id: "i1", letter_number: "MCN-AL-2026-000002", status: "issued",
      accepted_at: new Date(2026, 8, 24, 11, 5).toISOString(), sha256_short: "ab12cd34ef56",
    }]);
    expect(html).toContain("Appointment Letter (signed)");
    expect(html).toContain("MCN-AL-2026-000002");
    expect(html).toContain("Signed by employee");
    expect(html).toContain("24/09/2026 11:05");
    expect(html).toContain("ab12cd34ef56");
    expect(html).toContain("View");
    expect(html).toContain("Download");
    expect(html).not.toContain("Revoked");
  });

  it("marks a revoked letter (HR only ever receives one)", () => {
    expect(render([{ issue_id: "i1", letter_number: "X", status: "revoked", accepted_at: null, sha256_short: null }])).toContain("Revoked");
  });

  it("keeps the section with a compact None placeholder when there is no signed letter", () => {
    const html = render([]);
    expect(html).toContain("Appointment Letter (signed)");
    expect(html).toContain("None");
    expect(html).not.toContain("<button");
  });
});
