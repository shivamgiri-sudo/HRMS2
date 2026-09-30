import { Plus, X } from "lucide-react";
import { PALETTES, seriesColors } from "../palettes";
import type { VizStyle, Widget } from "../types";
import type { StyleOption, VizDef } from "../viz/def";
import { Field, NumberInput, Section, SelectInput, TextInput, Toggle, iconBtn, smallBtn } from "./controls";

interface Props { widget: Widget; def: VizDef; onChange: (patch: Partial<Widget>) => void }

/** The Style tab. Only the controls this chart type actually honours are shown. */
export default function StylePanel({ widget, def, onChange }: Props) {
  const style: VizStyle = { ...(def.defaults ?? {}), ...widget.viz };
  const has = (o: StyleOption) => def.styleOptions.includes(o);
  const set = (patch: Partial<VizStyle>) => onChange({ viz: { ...widget.viz, ...patch } });
  const swatches = seriesColors(style, 6);

  return (
    <div>
      <Section title="Title">
        <Field label={def.type === "header" || def.type === "text" ? "Name (shown in the editor)" : "Title"}>{(id) => <TextInput id={id} value={widget.title ?? ""} placeholder={def.label} onChange={(t) => onChange({ title: t || null })} />}</Field>
        {!def.noQuery && <Field label="Subtitle">{(id) => <TextInput id={id} value={widget.subtitle ?? ""} placeholder="Optional" onChange={(t) => onChange({ subtitle: t || null })} />}</Field>}
      </Section>

      {has("text") && (
        <Section title="Text">
          <Field label="Content" hint={def.type === "text" ? "Supports # headings, - lists, **bold**, *italic*, `code` and [links](https://…)." : undefined}>{(id) => (
            <textarea id={id} value={style.text ?? ""} rows={def.type === "text" ? 8 : 2} maxLength={5000} onChange={(e) => set({ text: e.target.value })}
              className="w-full rounded-md border border-slate-300 bg-white p-2 text-sm text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600" />
          )}</Field>
        </Section>
      )}

      {has("palette") && (
        <Section title="Colours">
          <Field label="Palette">{(id) => <SelectInput id={id} value={style.palette ?? ""} options={[{ value: "", label: "Match the dashboard theme" }, ...Object.entries(PALETTES).map(([value, p]) => ({ value, label: p.label }))]} onChange={(palette) => set({ palette: palette || undefined })} />}</Field>
          <div>
            <p className="mb-1 text-xs font-semibold text-slate-700">Series colours</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {swatches.map((c, i) => (
                <input key={i} type="color" aria-label={`Colour of series ${i + 1}`} value={/^#[0-9a-f]{6}$/i.test(c) ? c : "#000000"} className="h-8 w-8 cursor-pointer rounded border border-slate-300 p-0.5"
                  onChange={(e) => { const colors = [...(style.colors ?? [])]; for (let k = 0; k <= i; k++) colors[k] = colors[k] ?? ""; colors[i] = e.target.value; set({ colors }); }} />
              ))}
              {!!style.colors?.some(Boolean) && <button type="button" className={smallBtn} onClick={() => set({ colors: undefined })}>Reset</button>}
            </div>
          </div>
        </Section>
      )}

      {has("thresholds") && (
        <Section title="Colour by value" action={<button type="button" className={smallBtn} onClick={() => set({ thresholds: [...(style.thresholds ?? []), { value: 0, color: "#DC2626" }] })}><Plus className="h-3.5 w-3.5" />Add</button>}>
          <p className="text-[11px] text-slate-500">A value takes the colour of the highest threshold it reaches.</p>
          {(style.thresholds ?? []).map((t, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className="text-xs text-slate-600">From</span>
              <NumberInput ariaLabel="Threshold value" value={t.value} onChange={(v) => set({ thresholds: style.thresholds!.map((x, j) => (j === i ? { ...x, value: v ?? 0 } : x)) })} />
              <input type="color" aria-label="Threshold colour" value={t.color} className="h-9 w-10 cursor-pointer rounded border border-slate-300 p-0.5" onChange={(e) => set({ thresholds: style.thresholds!.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)) })} />
              <button type="button" className={iconBtn} aria-label="Remove threshold" onClick={() => set({ thresholds: style.thresholds!.filter((_, j) => j !== i) })}><X className="h-4 w-4" /></button>
            </div>
          ))}
        </Section>
      )}

      {(has("target") || has("range") || has("higherIsBetter") || has("sparkline")) && (
        <Section title="Target">
          {has("target") && <Field label="Target value">{(id) => <NumberInput id={id} value={style.target} placeholder="None" onChange={(target) => set({ target })} />}</Field>}
          {has("range") && <div className="grid grid-cols-2 gap-1.5">
            <Field label="Scale from">{(id) => <NumberInput id={id} value={style.min} placeholder="0" onChange={(min) => set({ min })} />}</Field>
            <Field label="Scale to">{(id) => <NumberInput id={id} value={style.max} placeholder="Auto" onChange={(max) => set({ max })} />}</Field>
          </div>}
          {has("higherIsBetter") && <Toggle label="Higher is better" hint="Decides whether a rise is shown green or red." checked={style.higherIsBetter ?? true} onChange={(higherIsBetter) => set({ higherIsBetter })} />}
          {has("sparkline") && <Toggle label="Show trend line" checked={style.sparkline ?? true} onChange={(sparkline) => set({ sparkline })} />}
        </Section>
      )}

      {(has("legend") || has("dataLabels") || has("grid") || has("curve") || has("dots") || has("axisTitles") || has("topN")) && (
        <Section title="Chart">
          {has("legend") && <Field label="Legend">{(id) => <SelectInput id={id} value={style.legend ?? ""} options={[{ value: "", label: "Automatic" }, { value: "none", label: "Hidden" }, { value: "top", label: "Top" }, { value: "bottom", label: "Bottom" }, { value: "right", label: "Right" }]} onChange={(v) => set({ legend: (v || undefined) as VizStyle["legend"] })} />}</Field>}
          {has("curve") && <Field label="Line shape">{(id) => <SelectInput id={id} value={style.curve ?? "linear"} options={[{ value: "linear", label: "Straight" }, { value: "smooth", label: "Smooth" }, { value: "step", label: "Stepped" }]} onChange={(v) => set({ curve: v as VizStyle["curve"] })} />}</Field>}
          {has("topN") && <Field label="Show the top" hint="The rest are combined into “Other”. Leave empty to show all.">{(id) => <NumberInput id={id} min={1} max={100} value={style.topN} placeholder="All" onChange={(topN) => set({ topN })} />}</Field>}
          {has("dataLabels") && <Toggle label="Show values on the chart" checked={!!style.dataLabels} onChange={(dataLabels) => set({ dataLabels })} />}
          {has("grid") && <Toggle label="Show grid lines" checked={style.grid ?? true} onChange={(grid) => set({ grid })} />}
          {has("dots") && <Toggle label="Show points on lines" checked={!!style.dots} onChange={(dots) => set({ dots })} />}
          {has("axisTitles") && <div className="grid grid-cols-2 gap-1.5">
            <Field label="Horizontal axis title">{(id) => <TextInput id={id} value={style.xTitle ?? ""} onChange={(xTitle) => set({ xTitle: xTitle || undefined })} />}</Field>
            <Field label="Vertical axis title">{(id) => <TextInput id={id} value={style.yTitle ?? ""} onChange={(yTitle) => set({ yTitle: yTitle || undefined })} />}</Field>
          </div>}
        </Section>
      )}

      {has("numberFormat") && (
        <Section title="Numbers">
          <div className="grid grid-cols-3 gap-1.5">
            <Field label="Decimals">{(id) => <NumberInput id={id} min={0} max={6} value={style.decimals} placeholder="Auto" onChange={(decimals) => set({ decimals })} />}</Field>
            <Field label="Before">{(id) => <TextInput id={id} value={style.prefix ?? ""} placeholder="₹" onChange={(prefix) => set({ prefix: prefix.slice(0, 8) || undefined })} />}</Field>
            <Field label="After">{(id) => <TextInput id={id} value={style.suffix ?? ""} placeholder=" calls" onChange={(suffix) => set({ suffix: suffix.slice(0, 12) || undefined })} />}</Field>
          </div>
          <Toggle label="Shorten large numbers" hint="12,34,567 becomes 12.3L." checked={!!style.compact} onChange={(compact) => set({ compact })} />
        </Section>
      )}

      {(has("pageSize") || has("showTotals")) && (
        <Section title="Table">
          {has("pageSize") && <Field label="Rows per page">{(id) => <NumberInput id={id} min={5} max={200} value={style.pageSize} placeholder="25" onChange={(pageSize) => set({ pageSize })} />}</Field>}
          {has("showTotals") && <Toggle label="Show a totals row" checked={!!style.showTotals} onChange={(showTotals) => set({ showTotals })} />}
        </Section>
      )}

      {def.type !== "header" && (
        <Section title="Card">
          <div className="grid grid-cols-2 gap-1.5">
            <Field label="Card style">{(id) => <SelectInput id={id} value={style.card ?? "bordered"} options={[{ value: "bordered", label: "Bordered" }, { value: "shadow", label: "Raised" }, { value: "tinted", label: "Tinted" }, { value: "plain", label: "No card" }]} onChange={(card) => set({ card: card as VizStyle["card"] })} />}</Field>
            <Field label="Title position">{(id) => <SelectInput id={id} value={style.align ?? "left"} options={[{ value: "left", label: "Left" }, { value: "center", label: "Centre" }]} onChange={(align) => set({ align: align as VizStyle["align"] })} />}</Field>
          </div>
          {def.category === "Tiles" && <Field label="Text size">{(id) => <SelectInput id={id} value={String(style.fontScale ?? 1)} options={[{ value: "0.8", label: "Small" }, { value: "1", label: "Normal" }, { value: "1.25", label: "Large" }, { value: "1.6", label: "Extra large" }]} onChange={(v) => set({ fontScale: Number(v) })} />}</Field>}
        </Section>
      )}
    </div>
  );
}
