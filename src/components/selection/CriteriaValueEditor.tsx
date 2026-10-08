/** The value part of a rule row: requisition columns, screening config or the rule's own value. Labelled native inputs, 44px. */
import { useId } from "react";
import { setColumn, setConfig, setValue, type ColumnKey, type ConfigKey, type Draft } from "./criteriaEditorModel";
import { EDUCATION_LADDER } from "./ruleInfo";
import { FIELD } from "./RuleRow";

type Props = { ruleKey: string; draft: Draft; readOnly: boolean; onDraft: (d: Draft) => void; salaryMax?: number | null; customRules?: Array<{ label?: string; field?: string }> };
const listOf = (v: unknown) => (Array.isArray(v) ? v.join(", ") : "");
const toList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

function Text({ label, value, readOnly, onChange, type = "text", hint }: { label: string; value: string; readOnly: boolean; onChange: (v: string) => void; type?: "text" | "number"; hint?: string }) {
  const id = useId();
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block text-xs font-semibold text-slate-700 dark:text-slate-200">{label}</label>
      <input id={id} type={type} inputMode={type === "number" ? "numeric" : undefined} value={value} readOnly={readOnly} disabled={readOnly} onChange={(e) => onChange(e.target.value)} className={FIELD} aria-describedby={hint ? `${id}-hint` : undefined} />
      {hint && <p id={`${id}-hint`} className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">{hint}</p>}
    </div>
  );
}
function Choice({ label, value, options, readOnly, onChange }: { label: string; value: string; options: ReadonlyArray<{ id: string; label: string }>; readOnly: boolean; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block text-xs font-semibold text-slate-700 dark:text-slate-200">{label}</label>
      <select id={id} value={value} disabled={readOnly} onChange={(e) => onChange(e.target.value)} className={FIELD}>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </div>
  );
}
function Check({ label, checked, readOnly, onChange }: { label: string; checked: boolean; readOnly: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-slate-800 dark:text-slate-100 sm:min-h-9">
      <input id={id} type="checkbox" checked={checked} disabled={readOnly} onChange={(e) => onChange(e.target.checked)} className="h-5 w-5 cursor-pointer rounded border-slate-300 focus-visible:ring-2 focus-visible:ring-blue-500" />{label}
    </label>
  );
}

export default function CriteriaValueEditor({ ruleKey, draft, readOnly, onDraft, salaryMax, customRules }: Props) {
  const col = (k: ColumnKey) => String(draft.cols[k]);
  const setCol = (k: ColumnKey) => (v: string | boolean) => onDraft(setColumn(draft, k, v));
  const setCfg = (k: ConfigKey) => (v: string) => onDraft(setConfig(draft, k, v));
  const value = draft.rows[ruleKey]?.value;
  const setVal = (v: unknown) => onDraft(setValue(draft, ruleKey, v));
  const grid = "grid gap-2 sm:grid-cols-2";
  switch (ruleKey) {
    case "age": return <div className={grid}><Text label="From age" type="number" value={col("ageMin")} readOnly={readOnly} onChange={setCol("ageMin")} /><Text label="Up to age" type="number" value={col("ageMax")} readOnly={readOnly} onChange={setCol("ageMax")} /></div>;
    case "experience": return <div className={grid}><Text label="From (years)" type="number" value={col("experienceMinYears")} readOnly={readOnly} onChange={setCol("experienceMinYears")} /><Text label="Up to (years)" type="number" value={col("experienceMaxYears")} readOnly={readOnly} onChange={setCol("experienceMaxYears")} /></div>;
    case "education_min": {
      const v = col("educationRequirement");
      const onLadder = !v || (EDUCATION_LADDER as readonly string[]).includes(v);
      return onLadder
        ? <Choice label="Minimum qualification" value={v} readOnly={readOnly} onChange={setCol("educationRequirement")} options={[{ id: "", label: "Not set" }, ...EDUCATION_LADDER.map((l) => ({ id: l, label: `${l} or above` }))]} />
        : <Text label="Minimum qualification" value={v} readOnly={readOnly} onChange={setCol("educationRequirement")} hint="Free text; words like preferred make it a preference." />;
    }
    case "location_cities": return <Text label="Cities (comma separated)" value={col("targetLocations")} readOnly={readOnly} onChange={setCol("targetLocations")} />;
    case "location_radius": return <Text label="Within km of the branch" type="number" value={col("radiusKm")} readOnly={readOnly} onChange={setCol("radiusKm")} hint="Needs map locations; most records have none, so this is usually unknown." />;
    case "night_shift": return <div className={grid}><Check label="Night shift required" checked={!!draft.cols.nightShiftRequired} readOnly={readOnly} onChange={setCol("nightShiftRequired")} /><Text label="Shift" value={col("shiftRequirement")} readOnly={readOnly} onChange={setCol("shiftRequirement")} /></div>;
    case "rotational_shift": return <Check label="Rotational shifts" checked={!!draft.cols.rotationalShift} readOnly={readOnly} onChange={setCol("rotationalShift")} />;
    case "skills": return (
      <div className={grid}>
        <Text label="Skills (comma separated)" value={col("skillsRequired")} readOnly={readOnly} onChange={setCol("skillsRequired")} />
        <Choice label="Match" value={String(obj(value).match ?? "any")} readOnly={readOnly} onChange={(m) => setVal({ ...obj(value), match: m, ...(m === "at_least" ? { n: Number(obj(value).n ?? 1) } : { n: undefined }) })}
          options={[{ id: "any", label: "Any of them" }, { id: "all", label: "All of them" }, { id: "at_least", label: "At least some" }]} />
      </div>
    );
    case "salary_fit": return (
      <div className={grid}>
        <p className="text-sm text-slate-800 dark:text-slate-100">Budget: up to {salaryMax ?? "not set"} a month (needs re-approval to change)</p>
        <Text label="Accept up to this many times the budget" type="number" value={String(obj(value).maxRatio ?? 1.25)} readOnly={readOnly} onChange={(v) => setVal({ maxRatio: Number(v) || 1.25 })} />
      </div>
    );
    case "gender": return <Choice label="Gender" value={draft.cfg.gender} readOnly={readOnly} onChange={setCfg("gender")} options={[{ id: "", label: "Any" }, { id: "female", label: "Female" }, { id: "male", label: "Male" }]} />;
    case "english": return <Choice label="English level" value={draft.cfg.written_english_level} readOnly={readOnly} onChange={setCfg("written_english_level")} options={[{ id: "", label: "Not set" }, { id: "basic", label: "Basic" }, { id: "intermediate", label: "Intermediate" }, { id: "advanced", label: "Advanced" }]} />;
    case "typing": return <Text label="Typing speed (wpm)" type="number" value={draft.cfg.min_typing_speed_wpm} readOnly={readOnly} onChange={setCfg("min_typing_speed_wpm")} />;
    case "languages": return <Text label="Languages (comma separated, spoken)" value={draft.cfg.language_requirements} readOnly={readOnly} onChange={setCfg("language_requirements")} />;
    case "certificate": return (
      <div className={grid}>
        <Text label="Certificates (e.g. DRA)" value={draft.cfg.certifications} readOnly={readOnly} onChange={setCfg("certifications")} />
        <Choice label="Level" value={String(obj(value).level ?? "declared")} readOnly={readOnly} onChange={(l) => setVal({ ...obj(value), level: l })} options={[{ id: "declared", label: "Declared by the person" }, { id: "verified", label: "Verified by HR" }]} />
      </div>
    );
    case "form_answer": return (
      <ul className="list-inside list-disc text-xs text-slate-700 dark:text-slate-200">
        {(customRules ?? []).length ? (customRules ?? []).map((r, i) => <li key={i}>{r.label || r.field}</li>) : <li>No form answer rules. They are set on the requisition form's Meta screening.</li>}
      </ul>
    );
    case "notice_period": return <Text label="Can join within (days)" type="number" value={String(obj(value).maxDays ?? 30)} readOnly={readOnly} onChange={(v) => setVal({ maxDays: Number(v) || 0 })} />;
    case "record_age": return <Text label="Record updated within (days)" type="number" value={String(obj(value).maxDays ?? 365)} readOnly={readOnly} onChange={(v) => setVal({ maxDays: Number(v) || 1 })} />;
    case "contact_recent": return <Text label="Not contacted in the last (days)" type="number" value={String(obj(value).days ?? 7)} readOnly={readOnly} onChange={(v) => setVal({ days: Number(v) || 1 })} />;
    case "education_stream": case "employer_include": case "employer_exclude":
      return <Text label={ruleKey === "education_stream" ? "Streams (comma separated)" : "Employers (comma separated)"} value={listOf(value)} readOnly={readOnly} onChange={(v) => setVal(toList(v))} />;
    case "sources": return <Text label="Leave out sources (e.g. workindia_import, workindia_import:Whats App)" value={listOf(obj(value).exclude)} readOnly={readOnly} onChange={(v) => setVal({ exclude: toList(v) })} />;
    case "ex_employee": return <Choice label="Former employees" value={String(value ?? "allow_clean")} readOnly={readOnly} onChange={setVal} options={[{ id: "allow_clean", label: "Only those who left cleanly" }, { id: "exclude", label: "Leave them all out" }]} />;
    case "education_completed": return <Choice label="Qualification" value={String(value ?? "completed")} readOnly={readOnly} onChange={setVal} options={[{ id: "completed", label: "Completed" }, { id: "pursuing_ok", label: "Completed or still pursuing" }]} />;
    default: return null;
  }
}
