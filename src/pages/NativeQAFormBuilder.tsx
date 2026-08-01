import { useEffect, useMemo, useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Trash2, AlertTriangle, Check, Loader2 } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form, FormControl, FormField, FormItem, FormMessage,
} from "@/components/ui/form";

/**
 * Define what a process measures.
 *
 * Until this existed the QA module was inert: qa_audit_form had no writer, so
 * every process reported "no active form" and not one audit could be filed.
 *
 * An editable grid rather than a wizard because a QA lead enters ~18 parameters
 * in one sitting and then corrects two of them a month later. The neighbouring
 * KpiTargetMatrix uses the same shape for bulk target editing, so this is the
 * gesture the team already has.
 *
 * Validation is react-hook-form + zod, which the shadcn guidance rates as a
 * High-severity requirement. The adjacent KPI admin screens hand-roll useState
 * and manual parsing; this deliberately does not copy that.
 */

const parameterSchema = z.object({
  parameterText: z.string().trim().min(1, "Describe what is being scored"),
  section: z.string().trim().optional(),
  // Coerced because a number input yields a string, and a silent NaN would
  // reach the API as null and be rejected there instead of here.
  maxScore: z.coerce.number({ invalid_type_error: "Number" })
    .positive("Must be above 0"),
  weightage: z.coerce.number({ invalid_type_error: "Number" })
    .min(0, "0 or more").max(100, "100 or less"),
  isFatal: z.boolean(),
});

const formSchema = z.object({
  processId: z.string().min(1, "Select a process"),
  formName: z.string().trim().min(1, "Name the form"),
  effectiveFrom: z.string().min(1, "Pick a start date"),
  parameters: z.array(parameterSchema).min(1, "A form needs at least one parameter"),
});

type FormValues = z.infer<typeof formSchema>;

type ProcessOption = { id: string; process_name: string };
type FormVersion = {
  id: string; form_name: string; version_no: number;
  status: "draft" | "active" | "retired";
  parameter_count: number; audit_count: number;
};

const BLANK_PARAMETER = {
  parameterText: "", section: "", maxScore: 10, weightage: 10, isFatal: false,
};

export default function NativeQAFormBuilder() {
  const [processes, setProcesses] = useState<ProcessOption[]>([]);
  const [versions, setVersions] = useState<FormVersion[]>([]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      processId: "",
      formName: "",
      effectiveFrom: new Date().toISOString().slice(0, 10),
      parameters: [{ ...BLANK_PARAMETER }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "parameters" });
  const processId = form.watch("processId");
  const parameters = form.watch("parameters");

  useEffect(() => {
    hrmsApi.get<{ data?: ProcessOption[] } | ProcessOption[]>("/api/processes")
      .then((r) => setProcesses((Array.isArray(r) ? r : r?.data) ?? []))
      .catch(() => setProcesses([]));
  }, []);

  useEffect(() => {
    if (!processId) { setVersions([]); return; }
    hrmsApi.get<{ data: FormVersion[] }>(`/api/qa/audit-forms/versions?processId=${processId}`)
      .then((r) => setVersions(r?.data ?? []))
      .catch(() => setVersions([]));
  }, [processId]);

  /**
   * Shown next to the totals rather than blocking save. Weights not summing to
   * 100 is usually a mistake and occasionally deliberate, so it warns instead of
   * refusing — the backend does not require 100 either.
   */
  const weightTotal = useMemo(
    () => (parameters ?? []).reduce((sum, p) => sum + (Number(p?.weightage) || 0), 0),
    [parameters],
  );
  const fatalCount = useMemo(
    () => (parameters ?? []).filter((p) => p?.isFatal).length,
    [parameters],
  );

  const activeVersion = versions.find((v) => v.status === "active");

  async function onSubmit(values: FormValues) {
    setSaving(true);
    setNotice(null);
    try {
      const res = await hrmsApi.post<{ data: { id: string; versionNo: number } }>(
        "/api/qa/audit-forms",
        {
          processId: values.processId,
          formName: values.formName,
          effectiveFrom: values.effectiveFrom,
          parameters: values.parameters.map((p, i) => ({
            parameterText: p.parameterText,
            section: p.section || null,
            maxScore: p.maxScore,
            weightage: p.weightage,
            isFatal: p.isFatal,
            displayOrder: (i + 1) * 10,
          })),
        },
      );
      setNotice({
        tone: "ok",
        text: `Draft v${res.data.versionNo} saved. It scores nobody until you activate it.`,
      });
      const refreshed = await hrmsApi.get<{ data: FormVersion[] }>(
        `/api/qa/audit-forms/versions?processId=${values.processId}`,
      );
      setVersions(refreshed?.data ?? []);
    } catch (err) {
      setNotice({ tone: "error", text: (err as Error).message || "Could not save the draft" });
    } finally {
      setSaving(false);
    }
  }

  async function activate(formId: string) {
    setSaving(true);
    setNotice(null);
    try {
      const res = await hrmsApi.post<{ data: { activatedVersion: number; retiredFormId: string | null } }>(
        `/api/qa/audit-forms/${formId}/activate`, {},
      );
      setNotice({
        tone: "ok",
        text: res.data.retiredFormId
          ? `v${res.data.activatedVersion} is live. The previous version was retired — its audits stay readable.`
          : `v${res.data.activatedVersion} is live.`,
      });
      const refreshed = await hrmsApi.get<{ data: FormVersion[] }>(
        `/api/qa/audit-forms/versions?processId=${processId}`,
      );
      setVersions(refreshed?.data ?? []);
    } catch (err) {
      setNotice({ tone: "error", text: (err as Error).message || "Could not activate" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">QA audit form</h1>
        <p className="text-sm text-muted-foreground mt-1">
          What this process is scored on. Saved as a draft first — a draft scores nobody
          until it is activated, and activating retires the version it replaces.
        </p>
      </div>

      {notice && (
        <div
          role="status"
          className={`rounded-md border px-4 py-3 text-sm ${
            notice.tone === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-red-200 bg-red-50 text-red-900"
          }`}
        >
          {notice.text}
        </div>
      )}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField
              control={form.control}
              name="processId"
              render={({ field }) => (
                <FormItem>
                  <label htmlFor="processId" className="text-sm font-medium">Process</label>
                  <FormControl>
                    <select
                      {...field}
                      id="processId"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm cursor-pointer"
                    >
                      <option value="">Select a process…</option>
                      {processes.map((p) => (
                        <option key={p.id} value={p.id}>{p.process_name}</option>
                      ))}
                    </select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="formName"
              render={({ field }) => (
                <FormItem>
                  <label htmlFor="formName" className="text-sm font-medium">Form name</label>
                  <FormControl>
                    <Input {...field} id="formName" placeholder="Inbound QA" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="effectiveFrom"
              render={({ field }) => (
                <FormItem>
                  <label htmlFor="effectiveFrom" className="text-sm font-medium">Effective from</label>
                  <FormControl>
                    <Input {...field} id="effectiveFrom" type="date" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className="rounded-lg border">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="text-sm font-medium">
                Parameters
                <span className="ml-2 text-muted-foreground font-normal">
                  {fields.length} · weights total {weightTotal}
                  {fatalCount > 0 && ` · ${fatalCount} fatal`}
                </span>
              </div>
              <Button
                type="button" variant="outline" size="sm" className="cursor-pointer"
                onClick={() => append({ ...BLANK_PARAMETER })}
              >
                <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Add parameter
              </Button>
            </div>

            {weightTotal !== 100 && fields.length > 0 && (
              // A warning, not a block: the backend does not require 100 either,
              // and refusing to save half-finished work is how people keep it in
              // a spreadsheet instead.
              <div className="flex items-start gap-2 border-b bg-amber-50 px-4 py-2 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Weights total {weightTotal}, not 100. That is allowed — check it is what you meant.</span>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th scope="col" className="px-4 py-2 font-medium">What is scored</th>
                    <th scope="col" className="px-4 py-2 font-medium w-40">Section</th>
                    <th scope="col" className="px-4 py-2 font-medium w-24">Max</th>
                    <th scope="col" className="px-4 py-2 font-medium w-24">Weight</th>
                    <th scope="col" className="px-4 py-2 font-medium w-20">Fatal</th>
                    <th scope="col" className="px-4 py-2 w-12"><span className="sr-only">Remove</span></th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((row, index) => (
                    <tr key={row.id} className="border-t align-top">
                      <td className="px-4 py-2">
                        <FormField
                          control={form.control}
                          name={`parameters.${index}.parameterText`}
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <Input {...field} aria-label={`Parameter ${index + 1}`} placeholder="Greeting used" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </td>
                      <td className="px-4 py-2">
                        <FormField
                          control={form.control}
                          name={`parameters.${index}.section`}
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <Input {...field} aria-label={`Section ${index + 1}`} placeholder="Opening" />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                      </td>
                      <td className="px-4 py-2">
                        <FormField
                          control={form.control}
                          name={`parameters.${index}.maxScore`}
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <Input {...field} type="number" min={1} step="0.5" aria-label={`Max score ${index + 1}`} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </td>
                      <td className="px-4 py-2">
                        <FormField
                          control={form.control}
                          name={`parameters.${index}.weightage`}
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <Input {...field} type="number" min={0} max={100} aria-label={`Weight ${index + 1}`} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </td>
                      <td className="px-4 py-2">
                        <FormField
                          control={form.control}
                          name={`parameters.${index}.isFatal`}
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <Checkbox
                                  checked={field.value}
                                  onCheckedChange={field.onChange}
                                  className="cursor-pointer"
                                  aria-label={`Fatal parameter ${index + 1}`}
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                      </td>
                      <td className="px-4 py-2">
                        <Button
                          type="button" variant="ghost" size="icon"
                          className="cursor-pointer text-muted-foreground hover:text-destructive"
                          // The last row is not removable: a form with no
                          // parameters is rejected by the API anyway, and an
                          // empty grid gives nothing to type into.
                          disabled={fields.length === 1}
                          onClick={() => remove(index)}
                          aria-label={`Remove parameter ${index + 1}`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={saving} className="cursor-pointer">
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              Save draft
            </Button>
            <p className="text-sm text-muted-foreground">
              A fatal parameter scored zero fails the whole audit, whatever else was scored.
            </p>
          </div>
        </form>
      </Form>

      {processId && (
        <div className="rounded-lg border">
          <div className="border-b px-4 py-3 text-sm font-medium">
            Versions
            {activeVersion && (
              <span className="ml-2 font-normal text-muted-foreground">
                v{activeVersion.version_no} is live
              </span>
            )}
          </div>
          {versions.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              No form yet for this process. Until one is active, no audit can be filed against it.
            </p>
          ) : (
            <ul className="divide-y">
              {versions.map((v) => (
                <li key={v.id} className="flex items-center justify-between px-4 py-3 text-sm">
                  <div>
                    <span className="font-medium">{v.form_name} · v{v.version_no}</span>
                    <span className="ml-2 text-muted-foreground">
                      {v.parameter_count} parameters
                      {v.audit_count > 0 && ` · ${v.audit_count} audits filed`}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        v.status === "active" ? "bg-emerald-100 text-emerald-800"
                        : v.status === "draft" ? "bg-slate-100 text-slate-700"
                        : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {v.status}
                    </span>
                    {v.status === "draft" && (
                      <Button
                        size="sm" variant="outline" className="cursor-pointer"
                        disabled={saving} onClick={() => activate(v.id)}
                      >
                        <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />
                        Activate
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
