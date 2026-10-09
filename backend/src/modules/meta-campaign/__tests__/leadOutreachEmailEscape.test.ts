import { describe, expect, it } from "vitest";
import { buildLegacyInviteEmail, legacySubject, type LeadContext } from "../lead-outreach-email.js";

const ctx = (o: Partial<LeadContext> = {}): LeadContext => ({
  id: "L1", name: "Asha Rao", phone: "9876543210", email: "a@x.in", designation: "CSE", branch: "NOIDA-2", requisitionCode: "R1", bmiUrl: null,
  branchAddress: "C-27, Sector 62\nNoida", branchCity: "Noida", branchLat: null, branchLng: null, salaryMin: null, salaryMax: null, ...o,
});
const slot = { date: "2026-10-10", time: "11:00:00", dateLabel: "Sat 10 Oct", timeLabel: "11:00 AM" };

describe("legacy invitation email escaping (M6)", () => {
  it("the branch address is HTML-escaped; line breaks still become <br>", () => {
    const { html } = buildLegacyInviteEmail(ctx({ branchAddress: `<img src=x onerror=alert(1)> & "Tower"\nNoida` }), slot, null, { stopLink: false });
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt; &amp; &quot;Tower&quot;<br>Noida");
    expect(html).not.toContain("<img src=x");
  });
  it("a normal address is unchanged (byte-identical output)", () => {
    expect(buildLegacyInviteEmail(ctx(), slot, null, { stopLink: false }).html).toContain("C-27, Sector 62<br>Noida");
  });
  it("the subject never carries CR / LF (no header injection), normal values unchanged", () => {
    expect(legacySubject(ctx({ name: "Asha\r\nBcc: x@y.z", designation: "CSE\nX" }))).toBe("Congratulations Asha Bcc:! Shortlisted for CSE X at Mas Callnet");
    expect(legacySubject(ctx())).toBe("Congratulations Asha! Shortlisted for CSE at Mas Callnet");
  });
});
