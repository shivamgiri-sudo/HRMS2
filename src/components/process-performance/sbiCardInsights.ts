import type { SbiAgentTime, SbiCapacity, SbiCollections, SbiDimRow, SbiTeam } from "./sbiCardTypes";

/**
 * Critical insights for the SBI Card Collections page, derived from the same figures the charts show (no invented numbers).
 * Each insight says what happened, how much money is behind it, and what to do first. Ranked: critical > warning > info > good.
 * Wording that is a hypothesis rather than a measurement says so ("check ...").
 */
export type InsightLevel = "critical" | "warning" | "info" | "good";
export interface Insight { id: string; level: InsightLevel; title: string; detail: string; action: string; metric: string }

const RANK: Record<InsightLevel, number> = { critical: 0, warning: 1, info: 2, good: 3 };
const inrShort = (n: number): string => {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`;
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
};
const p1 = (n: number): string => `${n.toFixed(1)}%`;

/** A bucket / region / table that is big enough to matter: at least `minShare` of the exposure. */
/** A split is only worth acting on when it differs by more than chance. Unknown (too little data) counts as not proven. */
const real = (p: number | null | undefined): boolean => p !== null && p !== undefined && p < 0.05;
const material = (rows: SbiDimRow[], total: number, minShare = 0.05): SbiDimRow[] => rows.filter((r) => total > 0 && r.exposure / total >= minShare);

export function deriveInsights(ops: SbiCollections, time: SbiAgentTime | null, limit = 12, capacity?: SbiCapacity | null, team?: SbiTeam | null): Insight[] {
  const h = ops.headline;
  if (!h.accounts) return [];
  const out: Insight[] = [];
  const share = (n: number) => (h.exposure > 0 ? n / h.exposure : 0);

  if (h.overduePtp > 0) {
    const top = ops.worklists.overduePtp[0];
    out.push({
      id: "lapsed-ptp", level: share(h.overduePtpExposure) > 0.03 ? "critical" : "warning",
      title: `${h.overduePtp} promises have lapsed`, metric: inrShort(h.overduePtpExposure),
      detail: `${inrShort(h.overduePtpExposure)} (${p1(share(h.overduePtpExposure) * 100)} of amount due) was promised and not paid by the snapshot day.`,
      action: top ? `Re-contact today, largest first (start with ${top.accountNo}, ${inrShort(top.totalDue)}).` : "Re-contact today, largest first.",
    });
  }
  if (capacity && capacity.total.accounts > 0 && capacity.total.penetration < capacity.target) {
    const t = capacity.total; const cp = capacity.capacity;
    const worst = capacity.rows.find((r) => r.status === "behind");
    out.push({
      id: "penetration", level: capacity.target - t.penetration >= 0.5 ? "critical" : "warning",
      title: `Penetration ${t.penetration.toFixed(2)} against a target of ${capacity.target}`, metric: `${t.shortfallDials.toLocaleString("en-IN")} dials`,
      detail: `${t.behindTables} call table(s) are behind; ${t.shortfallDials.toLocaleString("en-IN")} of ${t.requiredDials.toLocaleString("en-IN")} required dials are missing${cp ? `, about ${cp.extraHoursToCloseGap} more login hours at ${cp.dph} dials per hour` : ""}${worst ? `. Furthest behind: ${worst.table} (${worst.penetration.toFixed(2)})` : ""}.`,
      action: capacity.downtime.agentHoursLost > 0 ? `Add shifts or overtime on the lagging tables; outages already cost ${capacity.downtime.agentHoursLost} agent-hours, so fix the dialer first.` : "Add shifts or overtime on the lagging tables, or raise dialer pacing, before the cycle closes.",
    });
  }
  if (team?.hasRoster && team.alignment.high.attempts >= 30 && team.alignment.high.lowbalPct >= 10) {
    const h = team.alignment.high;
    out.push({
      id: "misrouted-high-balance", level: h.lowbalPct >= 25 ? "warning" : "info", title: `${h.lowbalPct.toFixed(1)}% of high-balance calls were made by LOWBAL agents`, metric: `${h.byLowbal}`,
      detail: `${h.byLowbal} of ${h.attempts} attempts on the HB / HB1 call tables came from agents rostered to the low-balance team; the high-balance team made ${h.byHighbal}.`,
      action: "Keep HB and HB1 tables on the HIGHBAL team's dialer login groups; check who is logged into which campaign.",
    });
  }
  if (team?.hasRoster && team.evidence.leaderPtpP !== null && team.evidence.leaderPtpP < 0.05) {
    const l = [...team.byLeader].filter((x) => x.attempts >= 30).sort((a, b) => b.ptpPct - a.ptpPct);
    if (l.length >= 2) out.push({
      id: "leader-spread", level: "info", title: `Team leaders differ on PTP yield: ${l[0]!.key} ${l[0]!.ptpPct.toFixed(1)}% to ${l[l.length - 1]!.key} ${l[l.length - 1]!.ptpPct.toFixed(1)}%`, metric: `${l[0]!.ptpPct.toFixed(1)}%`,
      detail: `The gap between ${l.length} team leaders is larger than chance would give (p = ${team.evidence.leaderPtpP < 0.001 ? "<0.001" : team.evidence.leaderPtpP.toFixed(3)}).`,
      action: `Have ${l[0]!.key}'s team share what they do on calls with ${l[l.length - 1]!.key}'s team; compare scripts and call timing first.`,
    });
  }
  if (team?.hasRoster && team.unmapped.pct >= 10) {
    out.push({
      id: "roster-gap", level: "info", title: `${team.unmapped.agents} dialer ids are not on the roster`, metric: `${team.unmapped.pct.toFixed(1)}%`,
      detail: `${team.unmapped.pct.toFixed(1)}% of attempts were made by dialer ids that are not in the uploaded roster, so they cannot be placed in a team or under a leader.`,
      action: "Upload the current TEAM_LIST; new joiners and moved agents are usually the missing ids.",
    });
  }
  const c = ops.compliance;
  if (c && c.window.outside > 0) {
    out.push({
      id: "call-window", level: "critical", title: `${c.window.outside} calls were placed outside ${c.windowLabel}`, metric: p1(c.window.outsidePct),
      detail: `${c.window.after} after the cut-off and ${c.window.before} before opening, out of ${c.window.attempts} timed attempts. SBI Card does not allow dialer or manual calls outside this window.`,
      action: "Hard-stop both the auto dialer and manual dialling at 18:55 and not before 08:00; review the late shifts and who placed the calls.",
    });
  }
  if (c && c.welfare.suicideThreat.accounts > 0) {
    out.push({
      id: "suth", level: "critical", title: `${c.welfare.suicideThreat.accounts} accounts carry a suicide-threat disposition`, metric: String(c.welfare.suicideThreat.accounts),
      detail: "These customers must leave the dial list after the first pass and be escalated per the client's welfare protocol.",
      action: "Escalate to the client contact today and confirm the accounts are excluded from every call table.",
    });
  }
  if (c && c.redialedAfterExclusion.accounts > 0) {
    const sensitive = c.redialedAfterExclusion.byCode.filter((x) => ["DS", "SUTH", "DISP"].includes(x.code));
    out.push({
      id: "redial-after-exclusion", level: sensitive.length > 0 ? "critical" : "warning",
      title: `${c.redialedAfterExclusion.accounts} accounts were dialled again after they should have left the list`, metric: String(c.redialedAfterExclusion.attempts),
      detail: `${c.redialedAfterExclusion.attempts} later attempts followed an "exclude after first pass" disposition (${c.redialedAfterExclusion.byCode.slice(0, 4).map((x) => `${x.code} ${x.accounts}`).join(", ")}).${sensitive.length ? " Includes deceased-customer, dispute or welfare cases." : ""}`,
      action: "Fix the re-churn rule so these dispositions drop the account from the next call table; clear the sensitive ones first.",
    });
  }
  if (c && c.intent.settlement.accounts + c.intent.hardship.accounts > 0) {
    const n = c.intent.settlement.accounts + c.intent.hardship.accounts; const amt = c.intent.settlement.exposure + c.intent.hardship.exposure;
    out.push({
      id: "intent", level: "info", title: `${n} customers asked for settlement or hardship`, metric: inrShort(amt),
      detail: `${c.intent.settlement.accounts} want settlement and ${c.intent.hardship.accounts} want hardship support; ${inrShort(amt)} due on these accounts. They are the highest-intent leads on the file.`,
      action: "Hand them to the settlement / hardship desk within 24 hours instead of leaving them in the general queue.",
    });
  }
  if (c && c.intent.languageBarrier.accounts > 0) {
    out.push({
      id: "language", level: "info", title: `${c.intent.languageBarrier.accounts} accounts hit a language barrier`, metric: inrShort(c.intent.languageBarrier.exposure),
      detail: `${inrShort(c.intent.languageBarrier.exposure)} is on customers the agent could not speak to in their language.`,
      action: "Route them to agents who speak the customer's language rather than retrying with the same pool.",
    });
  }
  if (c && c.intent.paidAlready.accounts > 0) {
    out.push({
      id: "paid-already", level: "info", title: `${c.intent.paidAlready.accounts} customers say they already paid`, metric: inrShort(c.intent.paidAlready.exposure),
      detail: `${inrShort(c.intent.paidAlready.exposure)} is still showing as due on accounts where the customer reports payment.`,
      action: "Reconcile with the bank's payment file before the next call; calling a paid customer again hurts the relationship.",
    });
  }
  if (c && c.unlisted.attempts > 0 && c.unlisted.pct >= 5) {
    out.push({
      id: "unlisted-dispositions", level: "info", title: `${p1(c.unlisted.pct)} of attempts use dispositions outside SBI's plan`, metric: p1(c.unlisted.pct),
      detail: `${c.unlisted.codes.slice(0, 6).map((x) => `${x.code} (${x.attempts})`).join(", ")} are not among the 17 dispositions in the client's plan, so their meaning and exclusion rule are unknown.`,
      action: "Ask the dialer team and the client what each means and whether it should exclude the account.",
    });
  }
  if (h.dncDialled > 0) {
    out.push({
      id: "dnc-dialled", level: "critical", title: `${h.dncDialled} of ${h.dnc} do-not-call accounts were dialled`, metric: String(h.dncDialledAttempts),
      detail: `${h.dncDialledAttempts} call attempts were made on accounts flagged DONOTCALL = Y. This is a compliance exposure, not a performance figure.`,
      action: "Suppress these at the dialer before the next cycle and raise it with compliance; check whether the flag landed after the calls.",
    });
  }
  if (h.untouched > 0) {
    const worst = [...ops.dimensions.delq].filter((r) => r.untouched > 0).sort((a, b) => b.untouched - a.untouched)[0];
    out.push({
      id: "untouched", level: share(h.untouchedExposure) > 0.02 ? "critical" : "warning",
      title: `${h.untouched} accounts never dialled`, metric: inrShort(h.untouchedExposure),
      detail: `${inrShort(h.untouchedExposure)} sits on accounts with zero attempts${worst ? `; most are in bucket ${worst.key} (${worst.untouched})` : ""}. Coverage is ${p1(h.coveragePct)}.`,
      action: "Push to the next dialling cycle in exposure order; check for list or DNC holds first.",
    });
  }
  const weak = (real(ops.dimensionSignal?.delq?.ptpP) ? material(ops.dimensions.delq, h.exposure) : []).filter((r) => r.worked > 0 && h.ptpPct - r.ptpPct >= 3).sort((a, b) => a.ptpPct - b.ptpPct)[0];
  if (weak) {
    out.push({
      id: "weak-bucket", level: "warning", title: `Bucket ${weak.key} converts ${p1(weak.ptpPct)} vs ${p1(h.ptpPct)} overall`, metric: inrShort(weak.exposure),
      detail: `It holds ${inrShort(weak.exposure)} across ${weak.accounts} accounts with ${p1(weak.coveragePct)} coverage, so it is worked but not converting.`,
      action: "Review the script and the strongest closers' calls in this bucket; consider a settlement or escalation offer.",
    });
  }
  if (h.stalePayers > 0 && share(h.stalePayersExposure) > 0.05) {
    out.push({
      id: "stale-payers", level: "info", title: `${h.stalePayers} accounts have not paid in 60+ days`, metric: inrShort(h.stalePayersExposure),
      detail: `${inrShort(h.stalePayersExposure)} (${p1(share(h.stalePayersExposure) * 100)} of amount due) sits on accounts whose last payment is two months or older.`,
      action: "These are the coldest accounts; prioritise a settlement or escalation offer over repeat reminders.",
    });
  }
  if (h.exhausted > 0) {
    out.push({
      id: "exhausted", level: share(h.exhaustedExposure) > 0.1 ? "warning" : "info", title: `${h.exhausted} accounts are exhausted`, metric: inrShort(h.exhaustedExposure),
      detail: `${inrShort(h.exhaustedExposure)} is on accounts with 4+ attempts and no promise. More of the same dialling is unlikely to change that.`,
      action: "Switch approach for these: different channel, senior caller, field visit or an offer.",
    });
  }
  const k = ops.contactability;
  if (k.attempts > 0 && k.noConversationPct >= 40) {
    out.push({
      id: "no-conversation", level: "warning", title: `${p1(k.noConversationPct)} of attempts reached nobody`, metric: p1(k.noConversationPct),
      detail: `${k.noConversation} of ${k.attempts} dispositioned attempts were no-contact, voicemail or wrong number. Contactability, not dialling volume, is capping results.`,
      action: "Work the number list and the time windows below before adding more dials.",
    });
  }
  if (k.stuck.accounts > 0) {
    out.push({
      id: "stuck", level: share(k.stuck.exposure) > 0.03 ? "warning" : "info", title: `${k.stuck.accounts} accounts: 3+ attempts, never a conversation`, metric: inrShort(k.stuck.exposure),
      detail: `${inrShort(k.stuck.exposure)} sits on accounts where every attempt was NC, voicemail or wrong number. Calling the same number again will not change that.`,
      action: "Rotate to alternate numbers, skip-trace, and move to SMS / WhatsApp / email within the allowed channels; field referral if balance justifies.",
    });
  }
  if (k.wrongNumber.accounts > 0) {
    out.push({
      id: "wrong-number", level: "info", title: `${k.wrongNumber.accounts} accounts returned a wrong number`, metric: inrShort(k.wrongNumber.exposure),
      detail: `${inrShort(k.wrongNumber.exposure)} is tied to numbers that did not belong to the customer.`,
      action: "Suppress the dead number, dial the alternate numbers next, and send the list back to the bank for refresh.",
    });
  }
  const ds = k.byDate;
  if (ds.length >= 3) {
    const peak = Math.max(...ds.map((x) => x.attempts)); const tail = ds[ds.length - 1]!;
    if (peak > 0 && tail.attempts / peak < 0.6) {
      out.push({
        id: "taper", level: "warning", title: `Dialling fell to ${Math.round((tail.attempts / peak) * 100)}% of peak by ${tail.date.slice(5)}`, metric: `${tail.attempts}`,
        detail: `Daily attempts peaked at ${peak} and the last day recorded ${tail.attempts}, while promises and callbacks are still falling due.`,
        action: "Hold capacity back for promise and callback follow-ups instead of front-loading the cycle.",
      });
    }
  }
  const sp = k.agentSpread;
  if (sp && sp.p75 - sp.p25 >= 3 && real(k.evidence?.agentPtpP)) {
    out.push({
      id: "agent-spread", level: "info", title: `Agent PTP yield runs ${sp.worst?.ptpPct.toFixed(1)}% to ${sp.best?.ptpPct.toFixed(1)}%`, metric: `${sp.median.toFixed(1)}%`,
      detail: `Across ${sp.agents} dialer agents with 30+ attempts, the middle half converts between ${sp.p25.toFixed(1)}% and ${sp.p75.toFixed(1)}% of attempts into a PTP.`,
      action: "Route high-balance and cold accounts to the top quartile; pair the bottom quartile with them on live-call coaching.",
    });
  }
  if (k.clientContact && k.clientContact.notCounted.attempts > 0 && k.clientContact.notCounted.pct >= 3) {
    const nc = k.clientContact.notCounted;
    out.push({
      id: "contact-definition", level: "info", title: `${p1(nc.pct)} of attempts were live conversations the client's MIS does not count`, metric: p1(k.clientContact.pct),
      detail: `SBI's MIS counts only PTP, PAD, OTP, DS, RTP and CBL as contacts (${p1(k.clientContact.pct)} of attempts). ${nc.codes.slice(0, 5).map((x) => `${x.code} ${x.attempts}`).join(", ")} are real conversations that fall outside it.`,
      action: "Raise it with SBI: that contact list predates the newer dispositions, so reported contact rate understates the work done.",
    });
  }
  if (h.callbacksOverdue > 0) {
    out.push({
      id: "callbacks", level: "warning", title: `${h.callbacksOverdue} callbacks were missed`, metric: String(h.callbacksOverdue),
      detail: `${h.callbacksOverdue} customers asked to be called back and the date has passed; ${h.callbacksUpcoming} more are scheduled ahead.`,
      action: "Clear the missed callbacks first; a promised callback is the warmest lead on the file.",
    });
  }
  const hours = ops.byHour.filter((x) => x.attempts >= Math.max(5, h.attemptsTotal * 0.03));
  if (hours.length >= 3 && (real(ops.contactability.evidence?.hourPtpP) || real(ops.contactability.evidence?.hourDeadP))) {
    const best = [...hours].sort((a, b) => b.ptpPct - a.ptpPct)[0]!;
    const worst = [...hours].sort((a, b) => a.ptpPct - b.ptpPct)[0]!;
    if (best.ptpPct - worst.ptpPct >= 1.5) {
      const hh = (x: number) => `${String(x).padStart(2, "0")}:00`;
      out.push({
        id: "hours", level: "info", title: `${hh(best.hour)} yields ${p1(best.ptpPct)} PTP, ${hh(worst.hour)} only ${p1(worst.ptpPct)}`, metric: p1(best.ptpPct),
        detail: `Across ${best.attempts + worst.attempts} attempts in those two hours the yield differs by ${(best.ptpPct - worst.ptpPct).toFixed(1)} points.`,
        action: `Weight dialling toward ${hh(best.hour)} and use ${hh(worst.hour)} for callbacks and low-value accounts.`,
      });
    }
  }
  const gap = [...(real(ops.dimensionSignal?.region?.coverageP) ? material(ops.dimensions.region, h.exposure, 0.03) : []), ...(real(ops.dimensionSignal?.callTable?.coverageP) ? material(ops.dimensions.callTable, h.exposure, 0.03) : [])]
    .filter((r) => h.coveragePct - r.coveragePct >= 2).sort((a, b) => a.coveragePct - b.coveragePct)[0];
  if (gap) {
    out.push({
      id: "coverage-gap", level: "info", title: `${gap.key} is under-worked at ${p1(gap.coveragePct)} coverage`, metric: p1(gap.coveragePct),
      detail: `${gap.untouched} of its ${gap.accounts} accounts (${inrShort(gap.exposure)}) have not been attempted, against ${p1(h.coveragePct)} overall.`,
      action: "Check agent allocation or list priority for this segment.",
    });
  }
  if (time && time.agents.length > 0) {
    const s = time.summary;
    const flagged = time.agents.filter((a) => a.flags.length > 0);
    if (s.waitPct !== null && s.pausePct !== null && s.waitPct > s.pausePct && s.waitPct >= 30) {
      out.push({
        id: "idle", level: "warning", title: `${p1(s.waitPct)} of login time is idle wait`, metric: p1(s.waitPct),
        detail: `Agents are waiting more than they are paused (${p1(s.pausePct)}); utilisation is only ${s.utilisationPct === null ? "n/a" : p1(s.utilisationPct)} at ${s.callsPerLoginHour ?? "n/a"} calls per login hour.`,
        action: "Check dialer pacing and list depth before blaming agents: the floor is waiting for calls.",
      });
    }
    if (flagged.length > 0) {
      out.push({
        id: "agents", level: "info", title: `${flagged.length} of ${s.agents} agents need a look`, metric: String(flagged.length),
        detail: `Well below the team on utilisation or call rate, or well above on pause: ${flagged.slice(0, 3).map((a) => a.name ?? a.employeeId).join(", ")}${flagged.length > 3 ? " and others" : ""}.`,
        action: "Coach against the team average, not a fixed target; start with the largest gap.",
      });
    }
  }
  // Say plainly when the splits are noise, so nobody re-routes dialling on a difference that is not there.
  const tested = [ops.dimensionSignal?.delq?.ptpP, ops.dimensionSignal?.region?.ptpP, ops.dimensionSignal?.callTable?.ptpP, k.evidence?.hourPtpP, k.evidence?.hourDeadP, k.evidence?.agentPtpP]
    .filter((x): x is number => x !== null && x !== undefined);
  if (tested.length >= 3 && !tested.some(real)) {
    out.push({
      id: "no-signal", level: "info", title: "No segment beats chance on this file", metric: `p ≥ ${Math.min(...tested).toFixed(2)}`,
      detail: "Bucket, region, call table, hour of day and agent differences in PTP yield and contact are all within normal random variation here.",
      action: "Do not re-route dialling on these rankings; judge on a fuller cycle or the real export, and fix the structural items above first.",
    });
  }
  if (h.coveragePct >= 95) {
    out.push({
      id: "coverage-good", level: "good", title: `Coverage is ${p1(h.coveragePct)}`, metric: p1(h.coveragePct),
      detail: `${h.worked} of ${h.accounts} accounts have at least one attempt, ${p1(h.ptpPct)} of them hold a promise.`,
      action: "Coverage is not the constraint; conversion and lapsed promises are.",
    });
  }
  return out.sort((a, b) => RANK[a.level] - RANK[b.level]).slice(0, limit);
}
