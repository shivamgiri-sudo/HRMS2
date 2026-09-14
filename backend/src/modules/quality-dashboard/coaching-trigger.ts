/**
 * Decides when a quality result should raise coaching, and how urgently.
 *
 * coaching_session has existed since migration 019 and holds ZERO rows, while
 * 254 agents are scored upstream at an average of 50.1%. The table was modelled
 * and never fed, so a low score has never produced an action.
 *
 * Pure on purpose. Whether someone gets coached is a judgement encoded in
 * thresholds, and it should be arguable in a test rather than buried in a query.
 *
 * Two rules matter more than the numbers:
 *
 *  1. An unassessed score raises nothing. A NULL percentage means nobody
 *     reviewed the work — 21% of July's audits were in that state. Coaching
 *     someone because their audits went unscored would punish them for a
 *     process failure that was not theirs.
 *
 *  2. Thresholds are RELATIVE to the process target, not absolute. Quality runs
 *     23.7% to 72.7% across the ten live clients, so a fixed "coach below 60"
 *     would flag an entire process as failing while leaving a genuinely
 *     underperforming agent on an easier process untouched.
 */

export type CoachingPriority = "low" | "medium" | "high" | "critical";

export type QualitySignal = {
  /** null when nothing was assessed. */
  qualityPercentage: number | null;
  fatalTriggered: boolean;
  /** The process's own target for this metric, if one is configured. */
  targetPercentage: number | null;
  /** How many consecutive assessed periods have already fallen short. */
  consecutiveShortfalls: number;
  /** Assessed audit count behind the score — one bad call is not a trend. */
  sampleSize: number;
};

export type CoachingTrigger = {
  priority: CoachingPriority;
  sessionType: "quality" | "performance" | "pip";
  reason: string;
  /** Raise a training_need alongside the session. */
  raiseTrainingNeed: boolean;
};

/** Below this fraction of target, a shortfall is material rather than noise. */
const MATERIAL_SHORTFALL = 0.9;
const SEVERE_SHORTFALL = 0.75;

/**
 * One audit is an incident, not a pattern. Coaching off a single call generates
 * noise that gets the whole signal ignored — the same way an hourly connector
 * alert would.
 */
const MIN_SAMPLE_FOR_TREND = 3;

export function evaluateCoachingTrigger(signal: QualitySignal): CoachingTrigger | null {
  // A fatal breach is actionable on its own, regardless of sample size or
  // target: it is a compliance event, not a performance average.
  if (signal.fatalTriggered) {
    return {
      priority: "critical",
      sessionType: "quality",
      reason: "Fatal parameter breached — immediate review required",
      raiseTrainingNeed: true,
    };
  }

  // Nobody assessed the work. There is nothing to coach on, and treating it as
  // a failure would blame the agent for an unscored queue.
  if (signal.qualityPercentage === null) return null;

  // Without a target there is no shortfall to measure. Inventing one would
  // apply a company-wide bar to processes that range from 23.7% to 72.7%.
  if (signal.targetPercentage === null || signal.targetPercentage <= 0) return null;

  const ratio = signal.qualityPercentage / signal.targetPercentage;
  if (ratio >= MATERIAL_SHORTFALL) return null;

  // Below target, but on too little evidence to call it a pattern.
  if (signal.sampleSize < MIN_SAMPLE_FOR_TREND) return null;

  const shortfallPct = Math.round((1 - ratio) * 100);

  // Persistent and severe: coaching has already been tried and has not moved
  // the number, so this escalates rather than repeating itself.
  if (ratio < SEVERE_SHORTFALL && signal.consecutiveShortfalls >= 3) {
    return {
      priority: "critical",
      sessionType: "pip",
      reason: `${shortfallPct}% below target across ${signal.consecutiveShortfalls} consecutive periods`,
      raiseTrainingNeed: true,
    };
  }

  if (ratio < SEVERE_SHORTFALL) {
    return {
      priority: "high",
      sessionType: "quality",
      reason: `${shortfallPct}% below target on ${signal.sampleSize} assessed audits`,
      raiseTrainingNeed: true,
    };
  }

  if (signal.consecutiveShortfalls >= 3) {
    return {
      priority: "high",
      sessionType: "performance",
      reason: `Consistently below target for ${signal.consecutiveShortfalls} periods`,
      raiseTrainingNeed: true,
    };
  }

  return {
    priority: signal.consecutiveShortfalls >= 2 ? "medium" : "low",
    sessionType: "quality",
    reason: `${shortfallPct}% below target on ${signal.sampleSize} assessed audits`,
    // A first, mild shortfall warrants a conversation, not a training plan.
    raiseTrainingNeed: signal.consecutiveShortfalls >= 2,
  };
}
