/**
 * "Answers by channel": how confirmations came in (email, WhatsApp, voice bot, HR by hand) and the response rate per channel, per drive
 * type. Tables only (they are their own text alternative). Hidden when the server does not send the numbers.
 */
import { useId } from "react";
import type { DriveAnalytics, SourceType } from "./driveCommandTypes";
import { TYPE_LABEL } from "./driveCommandModel";
import { Note } from "./charts/ChartFrame";
import { SAMPLE_NOTE } from "./charts/journeyModel";
import { channelTable } from "./responseChannelsModel";

export default function ResponseChannels({ analytics, only }: { analytics: DriveAnalytics; only?: SourceType }) {
  const id = `resp-ch-${useId().replaceAll(":", "")}`;
  const t = channelTable(analytics, only);
  if (!t) return null;
  const head = (first: string) => (
    <tr className="border-b border-slate-200 dark:border-slate-700">
      <th scope="col" className="px-2 py-1 text-left font-semibold">{first}</th>
      {t.types.map((ty) => <th key={ty} scope="col" className="px-2 py-1 text-right font-semibold">{TYPE_LABEL[ty]}</th>)}
    </tr>
  );
  return (
    <section aria-labelledby={id} className="min-w-0 space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900" data-response-channels>
      <div>
        <h3 id={id} className="text-sm font-bold text-slate-900 dark:text-slate-100">Answers by channel</h3>
        <p className="text-xs text-slate-700 dark:text-slate-200">Which channel each confirmation came from, and how many people answered of those contacted on each channel.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="overflow-x-auto">
          <table className="w-full min-w-max border-collapse text-xs text-slate-800 dark:text-slate-100">
            <caption className="mb-1 text-left text-xs font-semibold text-slate-800 dark:text-slate-100">Confirmed, by the channel they confirmed on</caption>
            <thead>{head("Channel")}</thead>
            <tbody>{t.confirmed.map((r) => (
              <tr key={r.label} className="border-b border-slate-100 last:border-0 dark:border-slate-800"><th scope="row" className="px-2 py-1.5 text-left font-medium">{r.label}</th>
                {r.cells.map((c, i) => <td key={i} className="px-2 py-1.5 text-right tabular-nums">{c}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-max border-collapse text-xs text-slate-800 dark:text-slate-100">
            <caption className="mb-1 text-left text-xs font-semibold text-slate-800 dark:text-slate-100">Response rate: answered of contacted</caption>
            <thead>{head("Channel")}</thead>
            <tbody>{t.rates.map((r) => (
              <tr key={r.label} className="border-b border-slate-100 last:border-0 dark:border-slate-800"><th scope="row" className="px-2 py-1.5 text-left font-medium">{r.label}</th>
                {r.cells.map((c, i) => <td key={i} className="px-2 py-1.5 text-right tabular-nums">{c.text}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>
      </div>
      <Note>Email includes taps on the email buttons; voice bot includes the calling file. "Before tracking" are confirmations recorded before the channel was stored.</Note>
      {t.small && <Note>{SAMPLE_NOTE}</Note>}
    </section>
  );
}
