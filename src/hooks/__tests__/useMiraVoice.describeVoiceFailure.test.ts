import { afterEach, describe, expect, it, vi } from "vitest";
import { describeVoiceFailure } from "../useMiraVoice";

/**
 * Chrome reports "the site is blocked", "the prompt was dismissed", "no prompt
 * can be shown at all", "no microphone exists" and "another app holds it" all
 * as the same `not-allowed` / NotAllowedError. describeVoiceFailure probes the
 * browser to tell them apart; these tests drive that probe with stubbed
 * Permissions/MediaDevices, which is all the Node-environment harness
 * (vitest.config.ts: environment: "node") can exercise. The capture flow
 * around it still needs a real browser — same accepted limitation as the
 * pickRecorderMimeType tests alongside this file.
 */

function stubBrowser(options: {
  secure?: boolean;
  permission?: PermissionState | 'throws' | 'absent';
  audioInputs?: number;
}) {
  const { secure = true, permission = 'prompt', audioInputs = 1 } = options;
  vi.stubGlobal("window", { isSecureContext: secure });
  vi.stubGlobal("navigator", {
    mediaDevices: {
      enumerateDevices: async () => Array.from({ length: audioInputs }, () => ({ kind: "audioinput" })),
    },
    permissions: permission === 'absent' ? undefined : {
      query: async () => {
        if (permission === 'throws') throw new TypeError("microphone is not a valid permission name");
        return { state: permission };
      },
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("describeVoiceFailure", () => {
  it("names the real cause when the site is blocked, and says where to unblock it", async () => {
    stubBrowser({ permission: "denied" });
    const message = await describeVoiceFailure("not-allowed");
    expect(message).toContain("blocked for this site");
    expect(message).toContain("Site settings");
  });

  it("distinguishes a never-granted prompt from an outright block, and calls out automated windows", async () => {
    stubBrowser({ permission: "prompt" });
    const message = await describeVoiceFailure("not-allowed");
    expect(message).toContain("choose Allow");
    expect(message).toContain("automated or embedded browser window");
    expect(message).not.toContain("Site settings");
  });

  it("blames another app, not the user, when permission is already granted", async () => {
    stubBrowser({ permission: "granted" });
    const message = await describeVoiceFailure("not-allowed");
    expect(message).toContain("another app or browser tab");
  });

  it("reports a missing microphone rather than a permission problem", async () => {
    stubBrowser({ permission: "prompt", audioInputs: 0 });
    const message = await describeVoiceFailure("not-allowed");
    expect(message).toContain("No microphone was found");
  });

  it("reports a missing microphone from the error code alone, without probing", async () => {
    stubBrowser({ permission: "granted" });
    await expect(describeVoiceFailure("NotFoundError")).resolves.toContain("No microphone was found");
    await expect(describeVoiceFailure("audio-capture")).resolves.toContain("No microphone was found");
  });

  it("points at http, not at permissions, on an insecure origin", async () => {
    stubBrowser({ secure: false, permission: "denied" });
    const message = await describeVoiceFailure("not-allowed");
    expect(message).toContain("secure (https)");
  });

  it("keeps the non-permission SpeechRecognition codes as their own messages", async () => {
    stubBrowser({});
    await expect(describeVoiceFailure("no-speech")).resolves.toContain("No speech was detected");
    await expect(describeVoiceFailure("network")).resolves.toContain("internet connection");
    await expect(describeVoiceFailure("service-not-allowed")).resolves.toContain("speech service is unavailable");
  });

  it("still returns an actionable message when the Permissions API is unusable", async () => {
    stubBrowser({ permission: "throws" });
    await expect(describeVoiceFailure("not-allowed")).resolves.toContain("browser settings");
    stubBrowser({ permission: "absent" });
    await expect(describeVoiceFailure("not-allowed")).resolves.toContain("browser settings");
  });
});
