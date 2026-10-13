/**
 * Reginald Cart — TPR & analyst performance (REG-06).
 *
 * No TPR formula is defined anywhere in HRMS or the dialler sources, and the
 * requirement forbids inventing one, so the TPR figure itself shows
 * "Formula pending business sign-off". The rest of the view ranks analysts and
 * campaigns on metrics that ARE defined (target achievement, Connect %,
 * utilization) and lists the exceptions, each labelled with its formula.
 */
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AXIS_TICK, GRID, Grid2, KpiGrid, Loading, Failed, Note, PctCell, RegFilterBar, RegKpi, RegPanel, RegTable, SERIES,
  fmtN, useInsight, type AgentRow, type Overview, type RegRange, type Targets,
} from "./reginaldShared";
import { fmtDur, fmtPctNA, fmtSigned, targetsByAgent } from "./reginaldMetrics";

export const TPR_PENDING = "Formula pending business sign-off";
const TPR_HELP = "TPR: no approved TPR formula exists in HRMS or the dialler source. It will be shown here once the business signs off the definition; until then no value is computed.";

export default function ReginaldTpr({ range }: { range: RegRange }) {
  const aQ = useInsight<AgentRow[]>("agents", range);
  const tQ = useInsight<Targets>("targets", range);
  const oQ = useInsight<Overview>("overview", range);
  const loading = aQ.isLoading || tQ.isLoading || oQ.isLoading;
  const failed = aQ.error || tQ.error || oQ.error || !aQ.data || !tQ.data || !oQ.data;
  return (
    <div>
      <RegFilterBar range={range} />
      <Note tone="warn"><strong>TPR — {TPR_PENDING}.</strong> {TPR_HELP}</Note>
      {loading ? <Loading /> : failed ? <Failed msg="Could not load analyst performance" /> : <Body agents={aQ.data!} t={tQ.data!} o={oQ.data!} />}
    </div>
  );
}

function Body({ agents, t, o }: { agents: AgentRow[]; t: Targets; o: Overview }) {
  const ach = new Map(targetsByAgent(t.rows, "totalCdr").map(a => [a.agent, a]));
  // Analysts present (target due) but with no dials still belong in the ranking and exceptions.
  const seen = new Set(agents.map(a => a.agent));
  const idle: AgentRow[] = [...ach.values()].filter(a => !seen.has(a.agent)).map(a => ({
    agent: a.agent, agentName: a.agentName,
    totalCdr: 0, connected: 0, uniqueDialed: 0, uniqueContacted: null, uniqueConnected: 0, uniqueQualified: 0,
    connectPct: 0, qualifiedPct: 0, talkSec: 0, avgTalkSec: 0,
    apr: { talkSec: 0, wrapSec: 0, waitSec: 0, pauseSec: 0, deadSec: 0, netLoginSec: 0, utilization: 0, agents: 0, invalidDurationRows: 0 },
  }));
  const rows = [...agents, ...idle].map(a => {
    const tg = ach.get(a.agent);
    return { ...a, name: a.agentName ?? a.agent, target: tg?.target ?? 0, eligibleDays: tg?.eligibleDays ?? 0, gap: tg?.gap ?? a.totalCdr, achievementPct: tg?.achievementPct ?? null };
  });
  const overallConnect = o.cdr.connectPct;
  const ranking = [...rows].sort((a, b) => (b.achievementPct ?? -1) - (a.achievementPct ?? -1));
  const exceptions = rows.filter(r => (r.achievementPct !== null && r.achievementPct < 100) || (r.uniqueDialed > 0 && r.connectPct < overallConnect))
    .sort((a, b) => (a.achievementPct ?? 999) - (b.achievementPct ?? 999));
  return (
    <div>
      <KpiGrid>
        <RegKpi tone={5} label="Overall TPR" value="Pending" sub={TPR_PENDING} title={TPR_HELP} />
        <RegKpi tone={0} label="Analysts" value={String(rows.length)} sub="With dialler activity" />
        <RegKpi tone={1} label="Overall Connect %" value={fmtPctNA(overallConnect)} sub="Unique Connect ÷ Unique Dialed" />
        <RegKpi tone={4} label="Below target / benchmark" value={String(exceptions.length)} sub="Achievement < 100% or Connect % below overall" />
      </KpiGrid>
      <Grid2>
        <RegPanel title="TPR trend" sub="Day / month">
          <div title={TPR_HELP} style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", border: "1px dashed #cbd5e1", borderRadius: 10, color: "#52514e", fontSize: 12, fontWeight: 700, textAlign: "center", padding: 16 }}>
            {TPR_PENDING}. The trend appears once the TPR definition is approved.
          </div>
        </RegPanel>
        <RegPanel title="Analyst ranking" sub="Target achievement % (Total CDR ÷ target)">
          <ResponsiveContainer width="100%" height={Math.max(200, ranking.length * 22)}>
            <BarChart data={ranking.map(r => ({ name: r.name, achievement: r.achievementPct ?? 0 }))} layout="vertical" margin={{ top: 4, right: 30, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
              <XAxis type="number" tick={AXIS_TICK} unit="%" />
              <YAxis type="category" dataKey="name" tick={{ ...AXIS_TICK, fontSize: 9 }} width={120} />
              <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} />
              <Bar dataKey="achievement" name="Achievement %" fill={SERIES[0]} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </RegPanel>
        <RegPanel title="Campaign comparison" sub="Connect % and qualified %">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={o.byCampaign} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="campaign" tick={AXIS_TICK} /><YAxis tick={AXIS_TICK} unit="%" />
              <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} /><Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="connectPct" name="Connect %" fill={SERIES[0]} radius={[4, 4, 0, 0]} />
              <Bar dataKey="qualifiedPct" name="Qualified (≥30s) %" fill={SERIES[2]} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </RegPanel>
        <RegPanel title="Connect % by analyst" sub={`Overall ${fmtPctNA(overallConnect)}`}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={[...rows].sort((a, b) => b.connectPct - a.connectPct).map(r => ({ name: r.name, connectPct: r.connectPct }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
              <XAxis dataKey="name" tick={{ ...AXIS_TICK, fontSize: 9 }} interval={0} angle={-30} textAnchor="end" height={60} /><YAxis tick={AXIS_TICK} unit="%" />
              <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} />
              <Bar dataKey="connectPct" name="Connect %" fill={SERIES[1]} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </RegPanel>
      </Grid2>

      <RegPanel title="Exceptions" sub="Below target or below overall Connect %">
        <RegTable<(typeof rows)[number]>
          rows={exceptions}
          empty="No analyst below target or benchmark"
          cols={[
            { h: "Analyst", left: true, get: r => r.agentName ?? "Not in HRMS" },
            { h: "Code", left: true, get: r => r.agent },
            { h: "TPR", get: () => <span title={TPR_HELP} style={{ color: "#64748b" }}>Pending</span> },
            { h: "Achievement", get: r => <PctCell v={r.achievementPct} /> },
            { h: "Gap", get: r => fmtSigned(r.gap) },
            { h: "Connect %", get: r => fmtPctNA(r.connectPct) },
            { h: "Utilization", get: r => fmtPctNA(r.apr.utilization) },
          ]}
        />
      </RegPanel>

      <RegPanel title="Analyst performance" sub={`${rows.length} analysts`}>
        <RegTable<(typeof rows)[number]>
          rows={ranking}
          cols={[
            { h: "Analyst", left: true, get: r => r.agentName ?? "Not in HRMS" },
            { h: "Code", left: true, get: r => r.agent },
            { h: "TPR", get: () => <span title={TPR_HELP} style={{ color: "#64748b" }}>Pending</span>, title: TPR_HELP },
            { h: "Total CDR", get: r => fmtN(r.totalCdr) },
            { h: "Unique Dialed", get: r => fmtN(r.uniqueDialed) },
            { h: "Unique Connect", get: r => fmtN(r.uniqueConnected) },
            { h: "Connect %", get: r => fmtPctNA(r.connectPct) },
            { h: "Avg Talk", get: r => fmtDur(r.avgTalkSec) },
            { h: "Eligible days", get: r => String(r.eligibleDays) },
            { h: "Target", get: r => fmtN(r.target) },
            { h: "Achievement", get: r => <PctCell v={r.achievementPct} /> },
            { h: "Net Login", get: r => fmtDur(r.apr.netLoginSec) },
            { h: "Wrap", get: r => fmtDur(r.apr.wrapSec) },
            { h: "Wait", get: r => fmtDur(r.apr.waitSec) },
            { h: "Utilization", get: r => fmtPctNA(r.apr.utilization) },
          ]}
        />
      </RegPanel>
    </div>
  );
}
