import type { HiringData, OfferWindow, PeopleData, PersonRef } from "../panelTypes";
import { formatCount, formatPct } from "../format";
import { AccentCard, BarCell, Chip, EmptyLine, NavyTable, PAL } from "../look";
import { mandateNote } from "./PeopleVisual";
import { nn } from "./shared";

type ProcRow = PeopleData["byProcess"][number];
const signed = (n: number) => `${n > 0 ? "+" : ""}${formatCount(n)}`;

/** Email section 6 headcount table: every process with mandate, movement today and MTD, net and attrition MTD %. */
export function HeadcountTable({ d, onProcess }: { d: PeopleData; onProcess: (name: string) => void }) {
  const rows = d.byProcess ?? [];
  const maxAttr = Math.max(10, ...rows.map((r) => nn(r.attritionMtdPct)));
  return (
    <AccentCard title="Headcount by process" chip={`${rows.length} processes · ${formatCount(d.totalActive)} active`} accent="blue">
      <NavyTable<ProcRow> caption="Headcount versus mandate by process with joiners, leavers and attrition month to date" rows={rows} limit={10} empty="No processes"
        onRowClick={(r) => onProcess(r.process)} rowLabel={(r) => r.process}
        columns={[
          { key: "p", label: "Process", render: (r) => <span className="font-semibold">{r.process}</span> },
          { key: "a", label: "Active", num: true, render: (r) => formatCount(r.active) },
          { key: "m", label: "Mandate", num: true, render: (r) => (r.mandateSeats != null && r.mandateSeats > 0 ? formatCount(r.mandateSeats) : "—") },
          { key: "g", label: "Vs mandate", render: (r) => {
            const note = mandateNote(nn(r.active), r.mandateSeats);
            if (r.mandateGap === 0) return <Chip tone="ok">At mandate</Chip>;
            return <Chip tone={note === "No mandate" ? "mute" : note.startsWith("Over") ? "warn" : r.mandateGap != null && r.mandateGap < 0 ? "info" : "ok"}>{note}</Chip>;
          } },
          { key: "jt", label: "Joined today", num: true, render: (r) => formatCount(r.joinedToday) },
          { key: "jm", label: "Joined MTD", num: true, render: (r) => formatCount(r.joinedMtd) },
          { key: "lt", label: "Left today", num: true, render: (r) => formatCount(r.leftToday) },
          { key: "lm", label: "Left MTD", num: true, render: (r) => formatCount(r.leftMtd) },
          { key: "n", label: "Net MTD", num: true, render: (r) => signed(r.netMtd) },
          { key: "at", label: "Attrition MTD", num: true, render: (r) => <BarCell pct={r.attritionMtdPct == null ? null : (r.attritionMtdPct / maxAttr) * 100} text={formatPct(r.attritionMtdPct)} color={PAL.s2} /> },
        ]} />
    </AccentCard>
  );
}

function Names({ title, people, count, tone }: { title: string; people: PersonRef[]; count: number; tone: "ok" | "warn" }) {
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-[12px] font-bold uppercase tracking-wide text-slate-700">{title} ({formatCount(count)})</p>
      {people.length ? (
        <ul className="flex list-none flex-wrap gap-1.5 p-0" aria-label={title}>
          {people.map((p, i) => <li key={`${p.name}-${i}`}><Chip tone={tone}>{p.name}{p.code ? ` · ${p.code}` : ""}</Chip></li>)}
          {count > people.length ? <li><Chip>+{formatCount(count - people.length)} more</Chip></li> : null}
        </ul>
      ) : <p className="text-[13px] text-slate-700">Nobody today</p>}
    </div>
  );
}

const offerRow = (label: string, w: OfferWindow): [string, OfferWindow] => [label, w];

/** Email sections 6 and 7 follow-ups: today's joiners/leavers, pending actions, consecutive absence and offer-to-join. */
export function PeopleFollowUps({ d, hiring }: { d: PeopleData; hiring: HiringData | null }) {
  const pending = hiring?.pendingActions ?? [];
  const offers = hiring?.offers ?? null;
  const ab = d.absence;
  return (
    <>
      <div className="bhl-grid bhl-grid-2">
        <AccentCard title="Joined and left today" chip={`${formatCount(d.joinedToday)} in · ${formatCount(d.leftToday)} out`} accent="emerald">
          <div className="grid gap-4 sm:grid-cols-2">
            <Names title="Joined today" people={d.joinedNames ?? []} count={d.joinedToday} tone="ok" />
            <Names title="Left today" people={d.leftNames ?? []} count={d.leftToday} tone="warn" />
          </div>
        </AccentCard>
        <AccentCard title="Pending actions" chip={`${formatCount(pending.reduce((a, p) => a + nn(p.count), 0))} open`} accent="orange">
          {hiring ? (
            <NavyTable caption="Pending actions with age" rows={pending} limit={0} empty="Nothing pending"
              columns={[
                { key: "l", label: "Action", render: (p) => <span className="font-semibold">{p.label}</span> },
                { key: "c", label: "Count", num: true, render: (p) => formatCount(p.count) },
                { key: "o", label: "Oldest", num: true, render: (p) => (p.oldestDays == null ? "—" : `${formatCount(p.oldestDays)} d`) },
                { key: "a", label: "Age", wrap: true, render: (p) => (p.age ? <Chip tone={nn(p.over7Days) > 0 ? "crit" : nn(p.over3Days) > 0 ? "warn" : "mute"}>{p.age}</Chip> : "—") },
              ]} />
          ) : <EmptyLine text="Pending actions are not available (hiring section has no data)" />}
        </AccentCard>
      </div>
      <div className="bhl-grid bhl-grid-2">
        <AccentCard title="Consecutive absence" chip={ab ? `${formatCount(ab.total)} people · ${ab.days}+ days` : "unavailable"} accent="rose">
          {ab ? (
            <>
              <NavyTable caption="People absent on consecutive rostered days without a punch" rows={ab.rows} limit={10} empty="Nobody is on a consecutive absence"
                columns={[
                  { key: "n", label: "Name", render: (r) => <span className="font-semibold">{r.name}</span> },
                  { key: "c", label: "Code", render: (r) => <span className="tabular-nums">{r.code}</span> },
                  { key: "p", label: "Process", render: (r) => r.process || "—" },
                  { key: "m", label: "Manager", render: (r) => r.manager || "—" },
                ]} />
              {ab.total > ab.rows.length ? <p className="bhl-note">Showing {ab.rows.length} of {formatCount(ab.total)}, as in the email.</p> : null}
            </>
          ) : <EmptyLine text="Consecutive absence could not be worked out for this date" />}
        </AccentCard>
        <AccentCard title="Offer to join" chip={offers ? `${formatCount(offers.joiningNext7Days)} joining in 7 days` : "no offers"} accent="violet">
          {offers ? (
            <NavyTable caption="Offer to join by window" limit={0} rows={[offerRow("Last 30 days", offers.last30), offerRow("Month to date", offers.mtd)]}
              columns={[
                { key: "w", label: "Window", render: (r) => <span className="font-semibold">{r[0]}</span> },
                { key: "o", label: "Offered", num: true, render: (r) => formatCount(r[1].offered) },
                { key: "j", label: "Joined", num: true, render: (r) => formatCount(r[1].joined) },
                { key: "n", label: "Not joined", num: true, render: (r) => formatCount(r[1].notJoined) },
                { key: "c", label: "Conversion", num: true, render: (r) => <BarCell pct={r[1].conversionPct} text={formatPct(r[1].conversionPct)} color={PAL.s3} /> },
              ]} />
          ) : <EmptyLine text="No offer data" />}
        </AccentCard>
      </div>
    </>
  );
}
