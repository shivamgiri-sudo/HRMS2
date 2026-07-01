import axios from "axios";
import crypto from "crypto";
import { env } from "../../config/env.js";

export type InsightSeverity = "critical" | "warning" | "info" | "success";

export interface AIInsight {
  id: string;
  severity: InsightSeverity;
  title: string;
  body: string;
  action_label?: string;
  action_url?: string;
}

export interface AIInsightsResult {
  insights: AIInsight[];
  cached: boolean;
  generated_at: string;
}

export interface InsightRequest {
  context_type: string;
  data: Record<string, unknown>;
  role: string;
  user_id: string;
}

// ── In-memory cache (5-min TTL) ────────────────────────────────────────────
interface CacheEntry {
  result: AIInsightsResult;
  expires_at: number;
}
const insightCache = new Map<string, CacheEntry>();

// ── Rate limiter (10 calls / user / hour) ───────────────────────────────────
interface RateEntry {
  count: number;
  window_start: number;
}
const rateLimiter = new Map<string, RateEntry>();
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 3_600_000;

// ── Sanitize: strip PII fields before any data reaches Gemini ───────────────
const PII_KEY_PATTERN =
  /pan|aadhaar|bank_account|bank_number|ifsc|uan|dob|date_of_birth|mobile|phone_number|email|address|epf_number/i;

function sanitizeData(
  data: Record<string, unknown>,
  contextType: string
): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(data)) {
    if (PII_KEY_PATTERN.test(key)) continue;
    // payroll_readiness: only numeric blocker counts
    if (contextType === "payroll_readiness" && typeof val !== "number" && typeof val !== "boolean") {
      if (typeof val === "object" && val !== null) {
        // allow nested objects (blockers sub-object) — recurse once
        const nested: Record<string, unknown> = {};
        for (const [nk, nv] of Object.entries(val as Record<string, unknown>)) {
          if (!PII_KEY_PATTERN.test(nk) && typeof nv === "number") nested[nk] = nv;
        }
        if (Object.keys(nested).length > 0) clean[key] = nested;
      }
      continue;
    }
    // employee_self: drop identity keys
    if (contextType === "employee_self") {
      if (/^(user_id|employee_id|employee_code)$/i.test(key)) continue;
    }
    // ats_pipeline: drop PII from any array rows
    if (contextType === "ats_pipeline" && Array.isArray(val)) {
      clean[key] = (val as Record<string, unknown>[]).map((row) => {
        const r: Record<string, unknown> = {};
        for (const [rk, rv] of Object.entries(row)) {
          if (!PII_KEY_PATTERN.test(rk) && !/^(mobile|email|full_name|name)$/i.test(rk)) r[rk] = rv;
        }
        return r;
      });
      continue;
    }
    clean[key] = val;
  }
  return clean;
}

// ── Cache fingerprint ────────────────────────────────────────────────────────
function fingerprint(userId: string, contextType: string, data: Record<string, unknown>): string {
  return crypto
    .createHash("sha256")
    .update(userId + contextType + JSON.stringify(data))
    .digest("hex")
    .slice(0, 16);
}

// ── Prompt builder (10 context types) ───────────────────────────────────────
const SCHEMA_MANDATE = `

Return ONLY valid JSON — no markdown, no explanation, no code fences.
Schema: {"insights":[{"id":"string","severity":"critical|warning|info|success","title":"max 8 words","body":"1-2 sentences with specific numbers from the data","action_label":"optional max 4 words","action_url":"optional app path string"}]}
Return exactly 2-4 insights. Never make up numbers not present in the data.`;

function buildPrompt(
  contextType: string,
  data: Record<string, unknown>,
  role: string
): string {
  const d = JSON.stringify(data, null, 2);

  const prompts: Record<string, string> = {
    ceo_dashboard: `You are an executive AI advisor briefing a CEO of a BPO/call-centre organisation.

Current data snapshot:
${d}

The CEO needs to act on the single most important operational risk RIGHT NOW and understand 2-3 things going well.

Rules:
- If payroll_readiness_pct < 80, flag as critical with exact percentage
- If name_mismatch_blocking > 0, it is ALWAYS critical (payroll will fail for those employees)
- If tat_breached > 0, flag as warning with count
- If resignation_pending > 0, flag revenue-at-risk with count
- If onboarding_pending > 10, flag as warning
- If org_avg_kpi or quality_score is positive, flag as success
- action_url paths: "/payroll/readiness", "/ats/onboarding-bridge", "/employees", "/hr/exit-requests"
- NEVER mention PAN, Aadhaar, UAN, individual employee names, or salary values
${SCHEMA_MANDATE}`,

    hr_dashboard: `You are an HR operations advisor briefing an HR Manager.

Current data snapshot:
${d}

The HR Manager needs to know: what is blocking today's onboarding, what compliance exposure exists, and what should be escalated.

Rules:
- If onboarding_stuck > 0, it is ALWAYS critical — include the number
- If bgv_pending > 5, flag risk to joining timelines
- If dpdp_withdrawals > 0, flag compliance risk — mention count exactly
- If resignation_pending > 0, flag attrition risk with count
- If selected_candidates > 0, flag as success with count
- action_url paths: "/ats/onboarding-bridge", "/ats/bgv", "/hr/exit-requests"
${SCHEMA_MANDATE}`,

    wfm_roster: `You are a workforce planning advisor briefing a WFM Analyst or Branch Head.

Current data snapshot:
${d}

The WFM Analyst needs to know: is there a headcount gap right now, is roster adherence at risk, and which attendance variance needs immediate resolution.

Rules:
- Compute hc_gap = required_hc - available_hc (or use hc_gap if provided). If > 5: critical. If 1-5: warning.
- If roster_adherence_pct < 75, flag as critical with exact percentage
- If missing_punch > 10, flag as warning with count
- Mention the largest attendance variance bucket by name if available
- action_url paths: "/wfm/roster", "/wfm/attendance", "/wfm/live-tracker"
${SCHEMA_MANDATE}`,

    payroll_readiness: `You are a payroll compliance advisor briefing a Payroll HR or Finance team member.

Current data snapshot (numeric counts only — no PAN, bank, or UAN details):
${d}

The Payroll HR needs to understand: what is blocking this payroll cycle, what is the readiness score.

Rules:
- readiness_score < 80 is critical. 80–90 is warning. >= 90 is success. Always cite the exact score.
- missing_bank, missing_pan, missing_uan — each > 0 is a warning. Quote the count.
- jclr_pending > 0 means joining cost liability unresolved — always flag
- name_mismatch_blocking = 1 is always critical (payroll will fail)
- onboarding_validation_pending > 0 means salary cannot be computed — flag as warning
- action_url paths: "/payroll/readiness", "/ats/payroll-hr", "/ats/jclr"
${SCHEMA_MANDATE}`,

    employee_self: `You are a personal career advisor speaking directly to an employee. Speak in second person ("You attended...", "Your leave balance...").

Current data snapshot:
${d}

Keep tone motivating but honest. Focus on what the employee can act on today.

Rules:
- If attendance_pct >= 95, give a success insight praising consistency
- If attendance_pct < 75, give a warning about possible impact on attendance record
- If late_days > 3, give an info insight suggesting schedule adjustment
- If any leave balance < 2 days remaining, give a warning to plan carefully
- If onboarding_pct < 100 and is_candidate is true, give an action to complete onboarding
- action_url paths: "/attendance", "/leaves/apply", "/my-documents"
- NEVER calculate or speculate about salary. NEVER reference other employees.
${SCHEMA_MANDATE}`,

    ats_pipeline: `You are a talent acquisition advisor briefing a Recruiter or HR Manager.

Current data snapshot:
${d}

The recruiter needs to know: where the funnel is leaking, which source channels are working, and what is blocking offered candidates from joining.

Rules:
- Compute offer-to-join conversion (joined / offered). If < 50%: critical.
- If offered_count > 0 and joined_count is much lower, flag offer-to-join risk
- Identify any stage with 0 candidates where the prior stage has candidates — name the drop-off
- Cite the best source channel by name if source_breakdown is available
- If total_candidates is 0, return a single info insight saying pipeline is empty
- action_url paths: "/ats/dashboard", "/ats/onboarding-bridge", "/ats/recruiter"
${SCHEMA_MANDATE}`,

    quality_operations: `You are a quality assurance advisor briefing a QA Lead or Process Manager.

Current data snapshot:
${d}

The QA team needs to know: which agents are at critical risk, where failure rates are highest, and what to focus on this week.

Rules:
- avg_quality_score < 60 is critical
- fraud_flags > 0 is ALWAYS critical — cite the number
- Identify the highest fail_rate_* field value and name the category
- Compute calls_below_50 / total_calls ratio if both available — cite as percentage
- action_url paths: "/quality/dashboard", "/quality/agents"
${SCHEMA_MANDATE}`,

    exit_risk: `You are an HR retention advisor briefing an HR Manager or COO on exit risk.

Current data snapshot:
${d}

The HR team needs to prioritise: which exits are regrettable, what clearance is blocking F&F, and what is the settlement liability.

Rules:
- If regrettable_exits > 0, flag as critical — these are talent losses
- If clearance_pending > 0, flag as warning (blocks F&F payout)
- If kt_incomplete > 0, flag knowledge transfer risk
- Reference total exit volume and breakdown by type if available
- action_url paths: "/exit/command-center", "/exit/clearance", "/employees"
${SCHEMA_MANDATE}`,

    attendance_pattern: `You are an attendance analytics advisor briefing a Team Leader or Manager.

Current data snapshot (AGGREGATED team attendance — not individual):
${d}

The manager needs to know: is team attendance healthy, are there patterns worth addressing, and what is the impact on coverage.

Rules:
- Team attendance_pct < 80 is critical
- If late_days > present_days * 0.15, flag chronic lateness as a pattern (compute the ratio)
- If absent_days average is high relative to working days, flag it
- NEVER name individual employees — speak only about team aggregates
- action_url paths: "/wfm/attendance", "/leaves"
${SCHEMA_MANDATE}`,

    performance_kpi: `You are a performance management advisor briefing a Manager, Team Leader, or employee themselves.

Current data snapshot:
${d}

The user needs to know: what is their score versus target, which metric is dragging the overall score down, and what the trend says.

Rules:
- overall_score < 60 is critical
- Identify the metric in metrics[] with the lowest score_pct and name it explicitly
- If overall_score >= 90, give a success insight
- If trend data suggests decline, flag as warning
- action_url paths: "/my-kpi", "/performance"
${SCHEMA_MANDATE}`,
  };

  return (
    prompts[contextType] ??
    `You are an HR analytics advisor. Analyse this data for role "${role}" and provide 2-4 actionable insights.\n\nData:\n${d}${SCHEMA_MANDATE}`
  );
}

// ── Gemini API call (same pattern as registration.enhanced.routes.ts) ────────
async function callGemini(prompt: string): Promise<AIInsight[]> {
  const resp = await axios.post(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent",
    { contents: [{ parts: [{ text: prompt }] }] },
    {
      headers: {
        "Content-Type": "application/json",
        "X-goog-api-key": env.GEMINI_API_KEY,
      },
      timeout: 20_000,
    }
  );
  const raw: string =
    resp.data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  const jsonStr = raw.replace(/```json\n?|\n?```/g, "").trim();
  const parsed = JSON.parse(jsonStr) as { insights?: AIInsight[] };
  return (parsed.insights ?? []).slice(0, 4);
}

// ── Public API ────────────────────────────────────────────────────────────────
export async function getInsights(req: InsightRequest): Promise<AIInsightsResult> {
  // 1. Guard: no key → return empty silently
  if (!env.GEMINI_API_KEY) {
    return { insights: [], cached: false, generated_at: new Date().toISOString() };
  }

  // 2. Sanitize
  const sanitized = sanitizeData(req.data, req.context_type);

  // 3. Cache check
  const fp = fingerprint(req.user_id, req.context_type, sanitized);
  const cached = insightCache.get(fp);
  if (cached && cached.expires_at > Date.now()) {
    return { ...cached.result, cached: true };
  }

  // 4. Rate limit
  const now = Date.now();
  const rate = rateLimiter.get(req.user_id) ?? { count: 0, window_start: now };
  if (now - rate.window_start > RATE_WINDOW_MS) {
    rate.count = 0;
    rate.window_start = now;
  }
  if (rate.count >= RATE_LIMIT) {
    throw new Error("AI rate limit reached — try again in an hour.");
  }
  rate.count++;
  rateLimiter.set(req.user_id, rate);

  // 5. Build prompt & call Gemini
  const prompt = buildPrompt(req.context_type, sanitized, req.role);
  let insights: AIInsight[];
  try {
    insights = await callGemini(prompt);
  } catch {
    // Return empty on Gemini failure — non-fatal
    return { insights: [], cached: false, generated_at: new Date().toISOString() };
  }

  // 6. Stamp deterministic IDs
  insights = insights.map((ins, i) => ({
    ...ins,
    id: `${req.context_type}_${i}`,
  }));

  // 7. Cache & return
  const result: AIInsightsResult = {
    insights,
    cached: false,
    generated_at: new Date().toISOString(),
  };
  insightCache.set(fp, { result, expires_at: Date.now() + 5 * 60 * 1000 });
  return result;
}

export const aiInsightsService = { getInsights };
