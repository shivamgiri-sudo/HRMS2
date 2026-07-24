type ChimePriority = "urgent" | "high" | "normal";

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    if (!audioCtx || audioCtx.state === "closed") {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioCtx;
  } catch {
    return null;
  }
}

function pulse(ctx: AudioContext, freq: number, startAt: number, duration = 0.12): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, startAt);

  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(0.35, startAt + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, startAt + duration);

  osc.start(startAt);
  osc.stop(startAt + duration + 0.01);
}

export function playChime(priority: ChimePriority): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  // Resume suspended context (required after user gesture policy)
  const resume = ctx.state === "suspended" ? ctx.resume() : Promise.resolve();

  resume.then(() => {
    const now = ctx.currentTime;
    const gap = 0.18;

    if (priority === "urgent") {
      // 3 pulses at 880 Hz
      pulse(ctx, 880, now);
      pulse(ctx, 880, now + gap);
      pulse(ctx, 880, now + gap * 2);
    } else if (priority === "high") {
      // 2 pulses at 660 Hz
      pulse(ctx, 660, now);
      pulse(ctx, 660, now + gap);
    } else {
      // 1 soft pulse at 440 Hz
      pulse(ctx, 440, now);
    }
  }).catch(() => { /* audio blocked */ });
}
