/**
 * Canonical sourcing channels.
 *
 * `ats_candidate.sourcing_channel` is free text and has the same vocabulary split that
 * `current_stage` had. Measured over the 7,760 genuine candidates on production 2026-08-11:
 *
 *   WALKIN 3564 | (blank) 2741 | Recruiter 952 | Walk-In 346 | Reference 134
 *   Employee Referral 10 | CODEX_E2E_TEST 7 | Other 3 | TEST DEMO 3 | LinkedIn 2
 *   Job Portal 1 | Referral 1 | Naukri 1 | Direct Application 1
 *
 * Three problems, mirroring the stage model:
 *   - `WALKIN` (3,564) and `Walk-In` (346) are one channel counted twice — an 11% error on
 *     the largest channel in the funnel;
 *   - `Reference` (134) and `Referral` (1) and `Employee Referral` (10) overlap;
 *   - test data is in production: `CODEX_E2E_TEST` (7) and `TEST DEMO` (3).
 *
 * Mapping happens at READ time and stored data is untouched, deliberately: it is reversible,
 * and it lets the normalised and raw versions be compared before anything is rewritten. The
 * same choice was made for stages in ats-stage-model.ts.
 */

export const CANONICAL_CHANNELS = [
  "walk_in",
  "recruiter",
  "referral",
  "job_portal",
  "direct",
  "test_data",
  "unspecified",
  "other",
] as const;

export type CanonicalChannel = (typeof CANONICAL_CHANNELS)[number];

export const CANONICAL_CHANNEL_LABEL: Record<CanonicalChannel, string> = {
  walk_in: "Walk-in",
  recruiter: "Recruiter",
  referral: "Referral",
  job_portal: "Job Portal",
  direct: "Direct Application",
  // Kept as its own bucket rather than folded into "other": test rows in production are a
  // data-quality fact worth seeing, not noise to be blended into a real channel.
  test_data: "Test data (not a real channel)",
  unspecified: "Unspecified",
  other: "Other",
};

const RAW_TO_CANONICAL: Record<string, CanonicalChannel> = {
  "walkin": "walk_in",
  "walk-in": "walk_in",
  "walk in": "walk_in",
  "recruiter": "recruiter",
  "reference": "referral",
  "referral": "referral",
  "employee referral": "referral",
  "linkedin": "job_portal",
  "naukri": "job_portal",
  "job portal": "job_portal",
  "direct application": "direct",
  "codex_e2e_test": "test_data",
  "test demo": "test_data",
  "other": "other",
};

const normalise = (raw: string): string => raw.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Canonical channel for a raw `sourcing_channel` value.
 *
 * A blank becomes `unspecified` rather than being dropped — 2,741 genuine candidates carry no
 * channel at all, which is 35% of them, and a source-effectiveness report that quietly omits
 * a third of its population is worse than one that shows the gap.
 *
 * An unrecognised non-blank value returns null so the caller can surface it, rather than being
 * folded into `other` where it would stop being visible as unmapped.
 */
export function canonicalChannel(raw: string | null | undefined): CanonicalChannel | null {
  if (raw == null) return null;
  const key = normalise(String(raw));
  if (!key) return "unspecified";
  return RAW_TO_CANONICAL[key] ?? null;
}

export interface ChannelBucket { channel: string; count: number }

export interface NormalisedChannel {
  channel: CanonicalChannel;
  label: string;
  count: number;
  /** The raw spellings that were merged into this row, for auditability. */
  merged_from: string[];
}

export interface NormalisedChannels {
  channels: NormalisedChannel[];
  /** Raw values that matched nothing, reported rather than absorbed. */
  unmapped: ChannelBucket[];
}

/** Merge raw channel buckets into canonical ones, preserving what was merged. */
export function normaliseChannels(buckets: ChannelBucket[]): NormalisedChannels {
  const byChannel = new Map<CanonicalChannel, NormalisedChannel>();
  const unmapped: ChannelBucket[] = [];

  for (const b of buckets) {
    const canonical = canonicalChannel(b.channel);
    const count = Number(b.count) || 0;
    if (!canonical) {
      if (count > 0) unmapped.push({ channel: b.channel, count });
      continue;
    }
    const existing = byChannel.get(canonical);
    if (existing) {
      existing.count += count;
      existing.merged_from.push(b.channel);
    } else {
      byChannel.set(canonical, {
        channel: canonical,
        label: CANONICAL_CHANNEL_LABEL[canonical],
        count,
        merged_from: [b.channel],
      });
    }
  }

  return {
    channels: [...byChannel.values()].sort((a, b) => b.count - a.count),
    unmapped,
  };
}
