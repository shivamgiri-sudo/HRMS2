import { describe, expect, it } from "vitest";
import { EMAIL_WA_PRIMARY, emailFallbackOn, REINSTATE_EMAIL_SQL } from "../qualified-followup.rules.js";

describe("invite email fallback mode", () => {
  it("is on by default and off only for HE_EMAIL_INVITE_MODE=always", () => {
    expect(emailFallbackOn({} as NodeJS.ProcessEnv)).toBe(true);
    expect(emailFallbackOn({ HE_EMAIL_INVITE_MODE: "" } as NodeJS.ProcessEnv)).toBe(true);
    expect(emailFallbackOn({ HE_EMAIL_INVITE_MODE: "fallback" } as NodeJS.ProcessEnv)).toBe(true);
    expect(emailFallbackOn({ HE_EMAIL_INVITE_MODE: " Always " } as NodeJS.ProcessEnv)).toBe(false);
  });

  it("reinstates only a parked, not-stopped row that has an address", () => {
    expect(REINSTATE_EMAIL_SQL).toContain(`email_error = '${EMAIL_WA_PRIMARY}'`);
    expect(REINSTATE_EMAIL_SQL).toContain("email_status = 'skipped'");
    expect(REINSTATE_EMAIL_SQL).toContain("stopped_reason IS NULL");
    expect(REINSTATE_EMAIL_SQL).toContain("email IS NOT NULL");
  });
});
