/**
 * HC Calculation Service
 *
 * Pure functions — no DB calls. Each workload type has its own formula.
 * Input: forecast volumes + planning rule parameters.
 * Output: { productive_hc, planned_hc, calculation_method, notes }
 *
 * All formulas write their intermediate values into `notes` so every
 * calculated result is fully auditable in wfm_slot_requirement.calculation_notes.
 */

export type WorkloadType =
  | "inbound_voice"
  | "outbound_voice"
  | "chat"
  | "email"
  | "backoffice"
  | "data_verification"
  | "audit_quality"
  | "blended";

export interface HcInput {
  workload_type: WorkloadType;
  slot_hours?: number; // hours in the planning slot (default 8 = full day)

  // Common
  shrinkage_pct?: number;        // 0-100; default 0

  // Inbound voice
  forecast_calls?: number;
  aht_seconds?: number;
  // SLA targets for Erlang-C correction (optional — falls back to erlang_lite when absent)
  service_level_target_pct?: number;  // 0-100, e.g. 80 = "80% of calls answered within T seconds"
  answer_time_seconds?: number;       // T seconds threshold, e.g. 20
  occupancy_target_pct?: number;      // 0-100; cap check — if Erlang-C result implies higher occupancy, add agents

  // Outbound voice
  campaign_target_type?: string; // attempts | contacts | sales | collections | callbacks | appointments
  target_attempts?: number;
  target_contacts?: number;
  target_sales?: number;
  connect_rate_pct?: number;     // 0-100
  contact_rate_pct?: number;
  conversion_rate_pct?: number;
  dials_per_agent_hour?: number;

  // Chat
  chat_volume?: number;
  avg_chat_duration_seconds?: number;
  chat_concurrency?: number;

  // Email
  new_email_volume?: number;
  backlog_volume?: number;
  sla_due_volume?: number;
  emails_per_agent_hour?: number;

  // Backoffice / Data verification
  case_volume?: number;
  cases_per_agent_hour?: number;
  quality_recheck_pct?: number;  // 0-100, additional overhead on backoffice

  // Audit / Quality
  production_volume?: number;
  audit_sample_pct?: number;     // 0-100
  audits_per_qa_hour?: number;

  // Blended (array of sub-type inputs — each resolved independently)
  blended_streams?: HcInput[];
}

export interface HcResult {
  productive_hc: number;       // Base HC before shrinkage
  planned_hc: number;          // Final HC after shrinkage ceiling
  calculation_method: string;
  notes: Record<string, unknown>;
  errors: string[];
}

// ── Utility ────────────────────────────────────────────────────────────────────

function shrink(base: number, shrinkage_pct: number): number {
  const rate = Math.min(Math.max(shrinkage_pct, 0), 99) / 100;
  if (rate >= 1) return base * 10; // guard against 100% shrinkage
  return base / (1 - rate);
}

function ceil(n: number): number {
  return Math.ceil(n);
}

// ── Erlang-C pure functions ────────────────────────────────────────────────────

/**
 * Erlang-C formula: probability that a call is queued (i.e. all N agents are busy).
 * C(N, A) = [ (A^N / N!) × (N / (N - A)) ] / [ Σ_{k=0}^{N-1}(A^k / k!) + (A^N / N!) × (N / (N - A)) ]
 * Returns value in [0, 1]. Returns 1 if N <= A (under-staffed — infinite queue).
 */
function erlangC(N: number, A: number): number {
  if (N <= A) return 1; // unstable — must add more agents

  // Compute sum of Poisson terms: Σ_{k=0}^{N-1} (A^k / k!)
  let poissonSum = 0;
  let term = 1; // A^0 / 0! = 1
  for (let k = 1; k < N; k++) {
    term *= A / k;
    poissonSum += term;
  }
  poissonSum += 1; // add k=0 term

  // Last term: A^N / N!  (reuse `term` from loop which ended at k=N-1)
  const lastTerm = term * (A / N);
  const intensityFactor = N / (N - A);
  const numerator = lastTerm * intensityFactor;
  return numerator / (poissonSum + numerator);
}

/**
 * Predicted service level for N agents handling traffic A (Erlangs)
 * with target answer time T (seconds) and mean handle time aht (seconds).
 * SL(N,A,T) = 1 − C(N,A) × e^(−(N−A) × T / aht)
 */
function serviceLevel(N: number, A: number, T: number, aht: number): number {
  if (aht <= 0) return 0;
  const c = erlangC(N, A);
  return 1 - c * Math.exp(-((N - A) * T) / aht);
}

/**
 * Occupancy for N agents at traffic A: A / N (fraction of time agents are busy).
 * Returns value in [0, 1].
 */
function occupancy(N: number, A: number): number {
  return N > 0 ? A / N : 1;
}

// ── 1. Inbound Voice ──────────────────────────────────────────────────────────

function calcInboundVoice(input: HcInput): HcResult {
  const errors: string[] = [];
  const slotSeconds = (input.slot_hours ?? 8) * 3600;
  const slotHours = slotSeconds / 3600;
  const shrinkage = input.shrinkage_pct ?? 0;
  const calls = input.forecast_calls ?? 0;
  const aht = input.aht_seconds ?? 0;

  if (!calls) errors.push("forecast_calls is required for inbound_voice");
  if (!aht) errors.push("aht_seconds is required for inbound_voice");

  // Traffic intensity in Erlangs: A = calls × AHT(s) / slot_seconds
  const A = slotSeconds > 0 ? (calls * aht) / slotSeconds : 0;

  const slTarget = input.service_level_target_pct;
  const answerT = input.answer_time_seconds;
  const occupancyCap = input.occupancy_target_pct != null ? input.occupancy_target_pct / 100 : null;

  // ── Erlang-C path: both SLA inputs present ─────────────────────────────────
  if (slTarget != null && answerT != null && A > 0 && aht > 0) {
    const targetSL = slTarget / 100;
    // Start from minimum agents needed to keep system stable (N > A)
    let N = Math.max(1, Math.ceil(A + 0.0001));
    const maxIter = 500;
    for (let i = 0; i < maxIter; i++) {
      const sl = serviceLevel(N, A, answerT, aht);
      const occ = occupancy(N, A);
      if (sl >= targetSL) {
        // Also enforce occupancy cap if set
        if (occupancyCap !== null && occ > occupancyCap) { N++; continue; }
        break;
      }
      N++;
    }
    const productive_hc = N;
    const planned_hc = shrink(productive_hc, shrinkage);
    const actualSL = serviceLevel(N, A, answerT, aht);
    const actualOcc = occupancy(N, A);

    return {
      productive_hc: ceil(productive_hc),
      planned_hc: ceil(planned_hc),
      calculation_method: "erlang_c",
      notes: {
        calls, aht_seconds: aht, slot_hours: slotHours, shrinkage_pct: shrinkage,
        traffic_erlangs: +A.toFixed(3),
        service_level_target_pct: slTarget, answer_time_seconds: answerT,
        occupancy_cap_pct: input.occupancy_target_pct ?? null,
        agents_required: N,
        achieved_service_level_pct: +(actualSL * 100).toFixed(1),
        achieved_occupancy_pct: +(actualOcc * 100).toFixed(1),
        productive_hc: +productive_hc.toFixed(2),
        formula: "erlang_c",
      },
      errors,
    };
  }

  // ── Fallback: erlang_lite (simple workload, no queuing correction) ──────────
  const workload_hours = (calls * aht) / 3600;
  const productive_hc = slotHours > 0 ? workload_hours / slotHours : 0;
  const planned_hc = shrink(productive_hc, shrinkage);

  return {
    productive_hc: ceil(productive_hc),
    planned_hc: ceil(planned_hc),
    calculation_method: "erlang_lite",
    notes: {
      calls, aht_seconds: aht, workload_hours: +workload_hours.toFixed(2),
      slot_hours: slotHours, shrinkage_pct: shrinkage,
      productive_hc: +productive_hc.toFixed(2),
      note: "SLA inputs (service_level_target_pct, answer_time_seconds) not provided — using workload-hours formula. Provide both to enable Erlang-C correction.",
    },
    errors,
  };
}

// ── 2. Outbound Voice ─────────────────────────────────────────────────────────

function calcOutboundVoice(input: HcInput): HcResult {
  const errors: string[] = [];
  const slotHours = input.slot_hours ?? 8;
  const shrinkage = input.shrinkage_pct ?? 0;
  const targetType = (input.campaign_target_type ?? "attempts").toLowerCase();
  const dialRate = input.dials_per_agent_hour ?? 0;

  if (!dialRate) errors.push("dials_per_agent_hour is required for outbound_voice");

  let required_attempts = 0;
  const notes: Record<string, unknown> = { campaign_target_type: targetType, dials_per_agent_hour: dialRate, slot_hours: slotHours, shrinkage_pct: shrinkage };

  if (targetType === "attempts") {
    required_attempts = input.target_attempts ?? 0;
    if (!required_attempts) errors.push("target_attempts required when campaign_target_type=attempts");
    notes.target_attempts = required_attempts;
  } else if (targetType === "contacts") {
    const contacts = input.target_contacts ?? 0;
    const connect = (input.connect_rate_pct ?? 0) / 100;
    if (!contacts) errors.push("target_contacts required");
    if (!connect) errors.push("connect_rate_pct required");
    required_attempts = connect > 0 ? contacts / connect : 0;
    notes.target_contacts = contacts; notes.connect_rate_pct = input.connect_rate_pct; notes.required_attempts = +required_attempts.toFixed(0);
  } else if (targetType === "sales") {
    const sales = input.target_sales ?? 0;
    const conversion = (input.conversion_rate_pct ?? 0) / 100;
    const connect = (input.connect_rate_pct ?? 0) / 100;
    if (!sales) errors.push("target_sales required");
    if (!conversion) errors.push("conversion_rate_pct required");
    if (!connect) errors.push("connect_rate_pct required");
    const required_contacts = conversion > 0 ? sales / conversion : 0;
    required_attempts = connect > 0 ? required_contacts / connect : 0;
    notes.target_sales = sales; notes.required_contacts = +required_contacts.toFixed(0); notes.required_attempts = +required_attempts.toFixed(0);
  } else {
    // callbacks, collections, appointments — treat as contacts
    required_attempts = input.target_contacts ?? input.target_attempts ?? 0;
    notes.required_attempts = required_attempts;
  }

  const agent_slot_capacity = dialRate * slotHours;
  const productive_hc = agent_slot_capacity > 0 ? required_attempts / agent_slot_capacity : 0;
  const planned_hc = shrink(productive_hc, shrinkage);
  notes.agent_slot_capacity = +agent_slot_capacity.toFixed(0);
  notes.productive_hc = +productive_hc.toFixed(2);

  return { productive_hc: ceil(productive_hc), planned_hc: ceil(planned_hc), calculation_method: "campaign", notes, errors };
}

// ── 3. Chat ───────────────────────────────────────────────────────────────────

function calcChat(input: HcInput): HcResult {
  const errors: string[] = [];
  const shrinkage = input.shrinkage_pct ?? 0;
  const volume = input.chat_volume ?? 0;
  const duration_mins = (input.avg_chat_duration_seconds ?? 0) / 60;
  const concurrency = input.chat_concurrency ?? 1;

  if (!volume) errors.push("chat_volume is required");
  if (!duration_mins) errors.push("avg_chat_duration_seconds is required");
  if (!concurrency) errors.push("chat_concurrency is required");

  const total_workload_mins = volume * duration_mins;
  const agent_capacity_mins = 60 * concurrency; // per agent per hour; for full slot: × slot_hours, but concurrency already continuous
  const productive_hc = agent_capacity_mins > 0 ? total_workload_mins / agent_capacity_mins : 0;
  const planned_hc = shrink(productive_hc, shrinkage);

  return {
    productive_hc: ceil(productive_hc),
    planned_hc: ceil(planned_hc),
    calculation_method: "concurrency",
    notes: { chat_volume: volume, avg_chat_duration_mins: +duration_mins.toFixed(2), chat_concurrency: concurrency, total_workload_mins: +total_workload_mins.toFixed(0), agent_capacity_mins_per_agent: +agent_capacity_mins.toFixed(0), shrinkage_pct: shrinkage, productive_hc: +productive_hc.toFixed(2) },
    errors,
  };
}

// ── 4. Email ──────────────────────────────────────────────────────────────────

function calcEmail(input: HcInput): HcResult {
  const errors: string[] = [];
  const slotHours = input.slot_hours ?? 8;
  const shrinkage = input.shrinkage_pct ?? 0;
  const newVol = input.new_email_volume ?? 0;
  const backlog = input.backlog_volume ?? 0;
  const slaDue = input.sla_due_volume ?? 0;
  const rate = input.emails_per_agent_hour ?? 0;

  if (!rate) errors.push("emails_per_agent_hour is required for email");

  const total_emails = newVol + slaDue + backlog;
  const agent_slot_capacity = rate * slotHours;
  const productive_hc = agent_slot_capacity > 0 ? total_emails / agent_slot_capacity : 0;
  const planned_hc = shrink(productive_hc, shrinkage);

  return {
    productive_hc: ceil(productive_hc),
    planned_hc: ceil(planned_hc),
    calculation_method: "backlog_sla",
    notes: { new_email_volume: newVol, backlog_volume: backlog, sla_due_volume: slaDue, total_emails, emails_per_agent_hour: rate, slot_hours: slotHours, agent_slot_capacity: +agent_slot_capacity.toFixed(0), shrinkage_pct: shrinkage, productive_hc: +productive_hc.toFixed(2) },
    errors,
  };
}

// ── 5. Backoffice / Data Verification ─────────────────────────────────────────

function calcBackoffice(input: HcInput): HcResult {
  const errors: string[] = [];
  const slotHours = input.slot_hours ?? 8;
  const shrinkage = input.shrinkage_pct ?? 0;
  const cases = input.case_volume ?? 0;
  const rate = input.cases_per_agent_hour ?? 0;
  const recheck = (input.quality_recheck_pct ?? 0) / 100; // overhead multiplier

  if (!cases) errors.push("case_volume is required for backoffice/data_verification");
  if (!rate) errors.push("cases_per_agent_hour is required");

  const agent_slot_capacity = rate * slotHours;
  const effective_cases = cases * (1 + recheck); // QA recheck adds overhead
  const productive_hc = agent_slot_capacity > 0 ? effective_cases / agent_slot_capacity : 0;
  const planned_hc = shrink(productive_hc, shrinkage);

  return {
    productive_hc: ceil(productive_hc),
    planned_hc: ceil(planned_hc),
    calculation_method: "cases_per_slot",
    notes: { case_volume: cases, quality_recheck_pct: input.quality_recheck_pct ?? 0, effective_cases: +effective_cases.toFixed(0), cases_per_agent_hour: rate, slot_hours: slotHours, agent_slot_capacity: +agent_slot_capacity.toFixed(0), shrinkage_pct: shrinkage, productive_hc: +productive_hc.toFixed(2) },
    errors,
  };
}

// ── 6. Audit / Quality ────────────────────────────────────────────────────────

function calcAuditQuality(input: HcInput): HcResult {
  const errors: string[] = [];
  const slotHours = input.slot_hours ?? 8;
  const shrinkage = input.shrinkage_pct ?? 0;
  const production = input.production_volume ?? 0;
  const samplePct = (input.audit_sample_pct ?? 0) / 100;
  const qaRate = input.audits_per_qa_hour ?? 0;

  if (!production) errors.push("production_volume is required for audit_quality");
  if (!samplePct) errors.push("audit_sample_pct is required");
  if (!qaRate) errors.push("audits_per_qa_hour is required");

  const required_audits = production * samplePct;
  const qa_slot_capacity = qaRate * slotHours;
  const productive_hc = qa_slot_capacity > 0 ? required_audits / qa_slot_capacity : 0;
  const planned_hc = shrink(productive_hc, shrinkage);

  return {
    productive_hc: ceil(productive_hc),
    planned_hc: ceil(planned_hc),
    calculation_method: "audit_sample",
    notes: { production_volume: production, audit_sample_pct: input.audit_sample_pct ?? 0, required_audits: +required_audits.toFixed(0), audits_per_qa_hour: qaRate, slot_hours: slotHours, qa_slot_capacity: +qa_slot_capacity.toFixed(0), shrinkage_pct: shrinkage, productive_hc: +productive_hc.toFixed(2) },
    errors,
  };
}

// ── 7. Blended ────────────────────────────────────────────────────────────────

function calcBlended(input: HcInput): HcResult {
  const streams = input.blended_streams ?? [];
  if (!streams.length) {
    return { productive_hc: 0, planned_hc: 0, calculation_method: "blended", notes: { error: "no sub-streams provided" }, errors: ["blended_streams is required for blended workload type"] };
  }

  const results = streams.map((s) => calculate(s));
  const total_productive = results.reduce((sum, r) => sum + r.productive_hc, 0);
  const total_planned = results.reduce((sum, r) => sum + r.planned_hc, 0);
  const all_errors = results.flatMap((r) => r.errors);

  return {
    productive_hc: total_productive,
    planned_hc: total_planned,
    calculation_method: "blended",
    notes: {
      streams: results.map((r, i) => ({
        workload_type: streams[i].workload_type,
        productive_hc: r.productive_hc,
        planned_hc: r.planned_hc,
        method: r.calculation_method,
      })),
      total_productive_hc: total_productive,
      total_planned_hc: total_planned,
      note: "Cross-utilisation not applied — each stream counted independently. Set cross_skill_allowed flag when agents are certified for multiple streams.",
    },
    errors: all_errors,
  };
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

export function calculate(input: HcInput): HcResult {
  switch (input.workload_type) {
    case "inbound_voice":    return calcInboundVoice(input);
    case "outbound_voice":   return calcOutboundVoice(input);
    case "chat":             return calcChat(input);
    case "email":            return calcEmail(input);
    case "backoffice":       return calcBackoffice(input);
    case "data_verification":return calcBackoffice(input); // same formula, different defaults
    case "audit_quality":    return calcAuditQuality(input);
    case "blended":          return calcBlended(input);
    default:
      return { productive_hc: 0, planned_hc: 0, calculation_method: "unknown", notes: {}, errors: [`Unknown workload_type: ${input.workload_type}`] };
  }
}
