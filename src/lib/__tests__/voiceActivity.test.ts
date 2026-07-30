import { describe, expect, it } from "vitest";
import { createVoiceActivityDetector, rmsFromByteTimeDomain } from "../voiceActivity";

const opts = { speechThreshold: 0.06, silenceThreshold: 0.03, sustainMs: 300, cooldownMs: 1500 };

/** Feed one sample every 20ms (a realistic AnalyserNode polling interval) and return every trigger. */
function run(detector: ReturnType<typeof createVoiceActivityDetector>, rmsAtMs: Array<[number, number]>) {
  const triggers: number[] = [];
  for (const [rms, atMs] of rmsAtMs) {
    if (detector.feed(rms, atMs)) triggers.push(atMs);
  }
  return triggers;
}

describe("createVoiceActivityDetector: does not fire on noise", () => {
  it("ignores a single loud sample surrounded by quiet", () => {
    const d = createVoiceActivityDetector(opts);
    const samples: Array<[number, number]> = [
      [0.01, 0], [0.01, 20], [0.5, 40], [0.01, 60], [0.01, 80], [0.01, 100],
    ];
    expect(run(d, samples)).toEqual([]);
  });

  it("ignores loudness that never reaches the sustain duration", () => {
    const d = createVoiceActivityDetector(opts);
    // Loud for 200ms, short of the 300ms sustain requirement.
    const samples: Array<[number, number]> = [
      [0.1, 0], [0.1, 100], [0.1, 200], [0.01, 220],
    ];
    expect(run(d, samples)).toEqual([]);
  });

  it("resets the run on a dip back to true silence, not just below the speech threshold", () => {
    const d = createVoiceActivityDetector(opts);
    const samples: Array<[number, number]> = [
      [0.1, 0], [0.1, 150], // 150ms of speech
      [0.01, 160],          // drops to true silence — resets
      [0.1, 180], [0.1, 330], [0.1, 470], // another run, only 290ms by 470 — not yet 300ms from 180
    ];
    expect(run(d, samples)).toEqual([]);
  });
});

describe("createVoiceActivityDetector: fires on real speech", () => {
  it("triggers on the sample where sustainMs is first reached", () => {
    const d = createVoiceActivityDetector(opts);
    const samples: Array<[number, number]> = [];
    for (let t = 0; t <= 320; t += 20) samples.push([0.1, t]);
    // Run starts at t=0; 300ms elapses exactly at the t=300 sample.
    expect(run(d, samples)).toEqual([300]);
  });

  it("tolerates a brief dip into the ambiguous band without resetting", () => {
    const d = createVoiceActivityDetector(opts);
    const samples: Array<[number, number]> = [
      [0.1, 0], [0.1, 100], [0.04, 120], // dips to 0.04 — between silence and speech thresholds
      [0.1, 140], [0.1, 300], [0.1, 320],
    ];
    // Run "started" at t=0 and was never reset (0.04 is above silenceThreshold),
    // so it should still fire once 300ms of elapsed time is reached.
    expect(run(d, samples).length).toBe(1);
  });

  it("enforces a cooldown after triggering, so one interruption does not fire twice", () => {
    const d = createVoiceActivityDetector(opts);
    const samples: Array<[number, number]> = [];
    for (let t = 0; t <= 320; t += 20) samples.push([0.1, t]);
    for (let t = 340; t <= 640; t += 20) samples.push([0.1, t]); // still loud, well past sustain again
    const triggers = run(d, samples);
    expect(triggers).toEqual([300]); // second run suppressed by cooldownMs = 1500
  });

  it("fires again after the cooldown window has elapsed", () => {
    const d = createVoiceActivityDetector(opts);
    const first = run(d, Array.from({ length: 17 }, (_, i) => [0.1, i * 20] as [number, number]));
    expect(first).toEqual([300]);

    // Trigger was at t=300, cooldown holds until 300+1500=1800; a fresh run
    // starting just after that needs its own 300ms before it can fire.
    const second = run(d, [
      [0.1, 1801], [0.1, 1900], [0.1, 2000], [0.1, 2100], [0.1, 2101],
    ]);
    expect(second.length).toBe(1);
  });
});

describe("rmsFromByteTimeDomain", () => {
  it("reads silence (all samples at the 128 midpoint) as zero", () => {
    expect(rmsFromByteTimeDomain(new Uint8Array(64).fill(128))).toBe(0);
  });

  it("reads a full-scale square wave as loud", () => {
    const buffer = new Uint8Array(64);
    for (let i = 0; i < buffer.length; i += 1) buffer[i] = i % 2 === 0 ? 255 : 0;
    expect(rmsFromByteTimeDomain(buffer)).toBeCloseTo(0.992, 2);
  });

  it("does not divide by zero on an empty buffer", () => {
    expect(rmsFromByteTimeDomain(new Uint8Array(0))).toBe(0);
  });
});
