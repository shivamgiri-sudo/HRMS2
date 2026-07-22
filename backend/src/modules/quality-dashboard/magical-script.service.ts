import { querySource } from "../../db/sourceDb.js";

export interface MagicalScriptFilters {
  clientId?: string | number;
  processId?: string;
  startDate?: string;
  endDate?: string;
}

interface ObjectionPattern {
  objection: string;
  frequency: number;
  resolution_rate: number;
  top_rebuttal?: string;
}

interface CallFlowStage {
  stage: number;
  title: string;
  goal: string;
  script: string;
  tip: string;
}

// Rule-based call script generator — mirrors Mydashboards magical-script logic.
// Queries top objections from db_external.CallDetails + db_external.tbl_obj,
// then generates structured call flow stages with objection-specific guidance.

export async function getMagicalScript(filters: MagicalScriptFilters) {
  const { clientId, startDate, endDate } = filters;
  const now = new Date();
  const end = endDate ?? now.toISOString().slice(0, 10);
  const start = startDate ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

  const clientClause = clientId ? ` AND d.client_id = ?` : "";
  const clientParams: (string | number)[] = clientId ? [clientId] : [];

  // Top objections with resolution rates
  const objections = await querySource<{
    objection: string; call_count: number; handled_count: number; resolution_rate: number;
  }>(
    `SELECT
      d.NotInterestedBucketReason AS objection,
      COUNT(*) AS call_count,
      SUM(CASE WHEN d.SaleDone = '1' THEN 1 ELSE 0 END) AS handled_count,
      ROUND(SUM(CASE WHEN d.SaleDone = '1' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 1) AS resolution_rate
     FROM db_external.CallDetails d
     WHERE d.CallDate BETWEEN ? AND ?
       AND d.NotInterestedBucketReason IS NOT NULL
       AND d.NotInterestedBucketReason != ''
       ${clientClause}
     GROUP BY d.NotInterestedBucketReason
     ORDER BY call_count DESC LIMIT 8`,
    [start, end, ...clientParams]
  );

  // Rebuttal matrix from tbl_obj
  const rebuttals = await querySource<{
    OBJECTION: string; RECOMMENDED_REBUTTAL: string; FREQUENCY: number;
  }>(
    `SELECT OBJECTION, RECOMMENDED_REBUTTAL, FREQUENCY
     FROM db_external.tbl_obj
     ORDER BY FREQUENCY DESC LIMIT 30`
  ).catch(() => [] as { OBJECTION: string; RECOMMENDED_REBUTTAL: string; FREQUENCY: number }[]);

  // Map rebuttals by objection keyword
  const rebuttalMap = new Map<string, string>();
  for (const r of rebuttals) {
    if (r.OBJECTION && r.RECOMMENDED_REBUTTAL) {
      rebuttalMap.set(r.OBJECTION.toLowerCase(), r.RECOMMENDED_REBUTTAL);
    }
  }

  const objectionGuide: ObjectionPattern[] = objections.map(o => {
    const key = (o.objection ?? "").toLowerCase();
    let top_rebuttal: string | undefined;
    for (const [k, v] of rebuttalMap.entries()) {
      if (key.includes(k) || k.includes(key.split(" ")[0])) {
        top_rebuttal = v;
        break;
      }
    }
    return {
      objection: o.objection,
      frequency: o.call_count,
      resolution_rate: o.resolution_rate,
      top_rebuttal,
    };
  });

  // Overall quality stats for context
  const [stats] = await querySource<{
    total: number; conversion: number; avg_talk_time: number;
  }>(
    `SELECT COUNT(*) AS total,
      ROUND(SUM(CASE WHEN SaleDone='1' THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),1) AS conversion,
      ROUND(AVG(LengthSec),0) AS avg_talk_time
     FROM db_external.CallDetails d
     WHERE d.CallDate BETWEEN ? AND ?${clientClause}`,
    [start, end, ...clientParams]
  );

  // Generate rule-based call flow stages
  const conversionRate = stats?.conversion ?? 0;
  const avgTalkTime = stats?.avg_talk_time ?? 0;
  const topObjection = objectionGuide[0];

  const callFlow: CallFlowStage[] = [
    {
      stage: 1,
      title: "Opening & Introduction",
      goal: "Build rapport and establish trust in the first 10 seconds",
      script: `"Good [morning/afternoon], am I speaking with [Customer Name]? This is [Agent Name] calling from MAS Callnet on behalf of [Brand]. I have a special offer that I believe will genuinely benefit you — do you have just 2 minutes?"`,
      tip: conversionRate < 15
        ? "⚠ Low conversion detected. Focus on a confident, warm opening — avoid scripted tone. Use the customer's name immediately."
        : "Opening quality is the biggest driver of conversion. Match your energy to the customer's pace.",
    },
    {
      stage: 2,
      title: "Needs Discovery & Probing",
      goal: "Understand the customer's situation before pitching",
      script: `"Before I tell you about the offer, can I ask — have you used [Product Category] before? What matters most to you when choosing one?"`,
      tip: "Agents who probe before pitching have 23% higher conversion. Ask at least 2 questions before presenting the offer.",
    },
    {
      stage: 3,
      title: "Value Proposition & Offer Presentation",
      goal: "Present the offer clearly and connect it to the customer's stated need",
      script: `"Based on what you just told me, [Product] is a perfect fit because [specific reason matching their need]. Today we have an exclusive [COD/Easy Payment] option available — [price/terms]. This is specifically available for [time/stock] only."`,
      tip: avgTalkTime > 400
        ? "⚠ Average call time is high. Keep the pitch under 90 seconds — customers disengage after 2 minutes of monologue."
        : "Keep your pitch benefit-led, not feature-led. One strong benefit beats five features.",
    },
    {
      stage: 4,
      title: "Objection Handling",
      goal: "Acknowledge, validate, and resolve the objection without pressure",
      script: topObjection
        ? `Most common objection: "${topObjection.objection}".\n\nResponse: "${topObjection.top_rebuttal ?? `I completely understand your concern. Many of our customers felt the same way initially, but after trying [Product], they found [key benefit]. Shall we proceed with the COD option so you can try it first?`}"`
        : `"I completely understand — that's a fair point. Many customers who felt the same way found that [key benefit] made the difference. Would you like to try it with our no-risk COD option?"`,
      tip: topObjection
        ? `"${topObjection.objection}" appears in ${topObjection.frequency} calls (${topObjection.resolution_rate}% handled successfully). ${topObjection.resolution_rate < 30 ? "Resolution rate is low — escalate to supervisor script for this objection." : "Coach agents on this specific rebuttal."}`
        : "Use the Feel-Felt-Found technique: 'I understand how you feel — others felt the same — they found that...'",
    },
    {
      stage: 5,
      title: "Closing & Confirmation",
      goal: "Secure a firm commitment and confirm all order details accurately",
      script: `"Great! So I'll confirm your order of [Product] at [Price] with [Payment Mode]. Can you confirm your delivery address as [address]? You should receive it within [X] business days. Is there anything else I can help you with before we close?"`,
      tip: "Always repeat the address and payment mode. Confirmation errors cause RTO — always read back the full address syllable by syllable.",
    },
    {
      stage: 6,
      title: "Call Closure & Wrap-Up",
      goal: "End on a positive note and set expectations for delivery",
      script: `"Thank you so much for your time, [Customer Name]. Your order is confirmed. You will receive an SMS with your order ID shortly. If you need any help, please call [brand helpline]. Have a wonderful [day/evening]!"`,
      tip: "A warm closing reduces post-order cancellations by ~18%. Never rush the closing — this is the last impression.",
    },
  ];

  return {
    generated_at: new Date().toISOString(),
    stats: stats ?? null,
    top_objections: objectionGuide,
    call_flow: callFlow,
    summary: {
      total_calls: stats?.total ?? 0,
      conversion_rate: conversionRate,
      avg_talk_time_sec: avgTalkTime,
      objection_types_found: objectionGuide.length,
      rebuttal_coverage: objectionGuide.filter(o => o.top_rebuttal).length,
    },
  };
}
