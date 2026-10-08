/**
 * The candidate must be sent the 10-step onboarding form, not a portal login.
 *
 * /onboard-full is where DigiLocker, penny-drop and PAN verification live.
 * issueCandidatePortalAccess emailed /candidate-portal/login with a temporary
 * password instead — a destination nobody has ever used successfully:
 * ats_candidate_portal_login holds zero rows across the system's whole history,
 * while /onboard-full has 282 tokens issued and 36 completed submissions.
 *
 * One candidate received both, two days apart, pointing at different places.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ATS = path.resolve(__dirname, "..", "modules", "ats");
const interview = fs.readFileSync(path.join(ATS, "interview.service.ts"), "utf8");
const templates = fs.readFileSync(path.join(ATS, "email.templates.ts"), "utf8");

describe("selection email sends the onboarding form", () => {
  it("builds an /onboard-full link carrying a token", () => {
    const at = interview.indexOf("export async function issueCandidatePortalAccess");
    expect(at).toBeGreaterThan(-1);
    const body = interview.slice(at, at + 4000);
    expect(body).toContain("/onboard-full?token=");
  });

  it("reuses an unexpired token rather than minting a second one", () => {
    // Two live links to the same form is fine; replacing the token would break
    // the link in the earlier onboarding email.
    const at = interview.indexOf("export async function issueCandidatePortalAccess");
    const body = interview.slice(at, at + 4000);
    expect(body).toContain("onboarding_token_expires_at > NOW()");
  });

  it("falls back to the portal only when no live token exists", () => {
    const at = interview.indexOf("export async function issueCandidatePortalAccess");
    const body = interview.slice(at, at + 4000);
    expect(body).toMatch(/liveToken\s*\n?\s*\?\s*`\$\{base\}\/onboard-full/);
    expect(body).toContain("/candidate-portal/login");
  });

  it("omits the password when the link needs none", () => {
    const at = interview.indexOf("export async function issueCandidatePortalAccess");
    const body = interview.slice(at, at + 4000);
    expect(body).toContain("tempPassword: liveToken ? null : tempPassword");
  });
});

describe("the email never shows an empty credentials box", () => {
  it("renders the password block only when a password exists", () => {
    // Previously interpolated unconditionally, so a null would print "null"
    // beside the words "Temporary Password".
    expect(templates).toMatch(/\$\{data\.tempPassword \? `/);
  });

  it("tells a tokenised recipient no password is needed", () => {
    expect(templates).toContain("needs no password");
  });

  it("names what the form will actually ask for", () => {
    expect(templates).toMatch(/DigiLocker.*PAN.*bank account/s);
  });
});
