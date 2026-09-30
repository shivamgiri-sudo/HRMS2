import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { STATUS_FILL, STATUS_LABEL, STATUS_ORDER, type Breakdown, type RosterView, type Status } from "./rosterModel";

const COUNT_KEY: Record<Status, keyof RosterView["counts"]> = {
  ON_TIME: "onTime", LATE: "late", ABSENT: "absent", ON_LEAVE: "onLeave", WEEK_OFF_HOLIDAY: "weekOffHoliday", UPCOMING: "upcoming",
};

export function StatusDonut({ counts, onPick }: { counts: RosterView["counts"]; onPick: (s: Status) => void }) {
  const data = STATUS_ORDER.map((s) => ({ status: s, name: STATUS_LABEL[s], value: counts[COUNT_KEY[s]] })).filter((d) => d.value > 0);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%" paddingAngle={2} onClick={(d) => onPick((d as unknown as { status: Status }).status)} className="cursor-pointer" isAnimationActive={false}>
          {data.map((d) => <Cell key={d.status} fill={STATUS_FILL[d.status]} />)}
        </Pie>
        <Tooltip formatter={(v: number, n: string) => [`${v}`, n]} />
        <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function StackedBreakdown({ data, onPick }: { data: Breakdown[]; onPick: (s: Status) => void }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 8 }}>
        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
        <YAxis type="category" dataKey="name" width={96} tick={{ fontSize: 11 }} interval={0} />
        <Tooltip />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
        {STATUS_ORDER.map((s) => (
          <Bar key={s} dataKey={s} name={STATUS_LABEL[s]} stackId="a" fill={STATUS_FILL[s]} onClick={() => onPick(s)} className="cursor-pointer" isAnimationActive={false} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
