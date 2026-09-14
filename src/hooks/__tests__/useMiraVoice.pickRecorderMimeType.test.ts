import { afterEach, describe, expect, it, vi } from "vitest";
import { pickRecorderMimeType } from "../useMiraVoice";

/**
 * The rest of the STT-fallback flow (getUserMedia, MediaRecorder, an actual
 * permission prompt, the real record→POST→transcribe→onFinal round trip)
 * needs a real browser and cannot be exercised by this repo's Node-environment
 * test harness (vitest.config.ts: environment: "node", no jsdom) — flagged
 * explicitly for manual QA on real Safari/iOS, same accepted limitation as
 * the earlier native-STT fixes this session. This file covers only the pure,
 * exported mime-type preference logic.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pickRecorderMimeType", () => {
  it("prefers audio/mp4 (Safari's primary output) over audio/webm when both are supported", () => {
    vi.stubGlobal("window", {
      MediaRecorder: { isTypeSupported: (type: string) => ["audio/mp4", "audio/webm"].includes(type) },
    });
    expect(pickRecorderMimeType()).toBe("audio/mp4");
  });

  it("falls back to audio/webm when audio/mp4 is not supported", () => {
    vi.stubGlobal("window", {
      MediaRecorder: { isTypeSupported: (type: string) => type === "audio/webm" },
    });
    expect(pickRecorderMimeType()).toBe("audio/webm");
  });

  it("returns undefined when MediaRecorder supports none of the candidates", () => {
    vi.stubGlobal("window", {
      MediaRecorder: { isTypeSupported: () => false },
    });
    expect(pickRecorderMimeType()).toBeUndefined();
  });

  it("returns undefined when MediaRecorder does not exist at all", () => {
    vi.stubGlobal("window", {});
    expect(pickRecorderMimeType()).toBeUndefined();
  });
});
