/**
 * Payroll HR's queue for fraud alerts raised during candidate onboarding.
 *
 * These alerts already existed and nothing read them: six sat in production
 * with status 'open' and no reviewer, because the endpoints were built and no
 * screen ever called them. That stopped mattering the moment an open critical
 * or high alert began refusing employee creation — without somewhere to clear
 * them, a false positive would strand a real candidate with no way out.
 *
 * The review decision follows the process Payroll HR already runs: open the
 * flagged case, look at what conflicts, and record why it was accepted or
 * rejected. Two things are deliberate here. Both names are shown side by side,
 * because the question is only ever "is this the same person"; and the reason
 * is mandatory, because clearing an alert is what allows an employee record to
 * be created.
 */
import { useCallback, useEffect, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { hrmsApi } from "@/lib/hrmsApi";
import { AlertCircle, CheckCircle2, ShieldAlert, Loader2 } from "lucide-react";

interface FraudAlert {
  id: string;
  candidate_id: string;
  candidate_name?: string | null;
  matched_candidate_name?: string | null;
  applied_for_branch?: string | null;
  alert_type: string;
  severity: string;
  status: string;
  details?: Record<string, unknown> | string | null;
  created_at?: string | null;
}

/**
 * Why an alert was cleared, captured as a code rather than only prose.
 *
 * Free text cannot be counted, and the point of reviewing these is learning
 * which variances are genuine so the automated rules can be tightened or
 * relaxed against evidence. The wording matches the cases that actually occur —
 * married names, initials, and the regional forms that dominate here.
 */
const RESOLUTIONS = [
  { value: "resolved_false_positive", code: "name_variance", label: "Same person, name written differently",
    hint: "Initials, an added or dropped middle name, regional ordering" },
  { value: "resolved_false_positive", code: "married_name", label: "Name changed after marriage",
    hint: "Supporting document seen" },
  { value: "resolved_false_positive", code: "data_entry", label: "Our data was wrong",
    hint: "OCR misread or a typo in the record" },
  { value: "resolved_fraud", code: "confirmed_fraud", label: "Confirmed — different person",
    hint: "Candidate rejected" },
  { value: "dismissed", code: "not_applicable", label: "Not applicable",
    hint: "Raised in error or a duplicate of another alert" },
] as const;

const SEVERITY_STYLES: Record<string, string> = {
  critical: "bg-red-100 text-red-800 border-red-300",
  high: "bg-orange-100 text-orange-800 border-orange-300",
  medium: "bg-amber-100 text-amber-800 border-amber-300",
  low: "bg-slate-100 text-slate-700 border-slate-300",
};

function detailMessage(details: FraudAlert["details"]): string {
  if (!details) return "";
  const parsed = typeof details === "string" ? safeParse(details) : details;
  return String((parsed as Record<string, unknown>)?.message ?? "");
}

function safeParse(value: string): Record<string, unknown> {
  try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
}

export default function NativeFraudAlertReview() {
  const [alerts, setAlerts] = useState<FraudAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [choice, setChoice] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await hrmsApi.get<{ alerts: FraudAlert[] }>("/api/ats/fraud-alerts?status=open");
      setAlerts(res?.alerts ?? []);
    } catch {
      setError("Could not load the alert queue. Please refresh, or contact IT if it persists.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const resolve = async (alert: FraudAlert) => {
    const picked = RESOLUTIONS[choice[alert.id] ?? -1];
    const reason = (notes[alert.id] ?? "").trim();
    if (!picked) { setError("Choose what you found before clearing an alert."); return; }
    if (!reason) { setError("Add a note explaining the decision — it is kept as the audit record."); return; }

    setSavingId(alert.id);
    setError("");
    try {
      await hrmsApi.patch(`/api/ats/fraud-alerts/${alert.id}/review`, {
        status: picked.value,
        notes: `[${picked.code}] ${reason}`,
      });
      await load();
    } catch {
      setError("Could not save that decision. Nothing was changed.");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-4 p-4 sm:p-6">
        <div className="flex items-start gap-3">
          <ShieldAlert className="h-6 w-6 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <h1 className="text-lg font-bold text-slate-900">Fraud Alert Review</h1>
            <p className="text-sm text-slate-600">
              An open <strong>critical</strong> or <strong>high</strong> alert prevents the candidate becoming an
              employee until it is cleared here. Medium alerts are recorded but do not block.
            </p>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-600 p-6">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading the queue…
          </div>
        ) : !alerts.length ? (
          <Card className="border-emerald-200 bg-emerald-50">
            <CardContent className="pt-5 pb-5 flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-700 flex-shrink-0" />
              <div>
                <p className="text-sm font-bold text-emerald-900">Nothing waiting</p>
                <p className="text-xs text-emerald-700">No onboarding fraud alert is currently open.</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          alerts.map((alert) => (
            <Card key={alert.id} className="border border-slate-200">
              <CardContent className="pt-4 pb-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={`border ${SEVERITY_STYLES[String(alert.severity).toLowerCase()] ?? SEVERITY_STYLES.low}`}>
                    {alert.severity}
                  </Badge>
                  <span className="font-mono text-xs font-bold text-slate-700">{alert.alert_type}</span>
                  <span className="text-sm font-semibold text-slate-900">{alert.candidate_name ?? alert.candidate_id}</span>
                  {alert.applied_for_branch && (
                    <span className="text-xs text-slate-500">{alert.applied_for_branch}</span>
                  )}
                  {alert.created_at && (
                    <span className="text-xs text-slate-400 ml-auto">{String(alert.created_at).slice(0, 10)}</span>
                  )}
                </div>

                {detailMessage(alert.details) && (
                  <p className="text-xs text-slate-700 bg-slate-50 rounded-md p-2.5">{detailMessage(alert.details)}</p>
                )}

                {alert.matched_candidate_name && (
                  // The conflicting record is the whole question, so it is shown
                  // rather than left for the reviewer to go and find.
                  <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-md p-2.5">
                    Conflicts with another candidate: <strong>{alert.matched_candidate_name}</strong>
                  </p>
                )}

                <div className="grid gap-1.5">
                  {RESOLUTIONS.map((option, index) => (
                    <label
                      key={`${alert.id}-${option.code}`}
                      className={`flex items-start gap-2.5 rounded-md border p-2.5 cursor-pointer text-xs transition-colors ${
                        choice[alert.id] === index ? "border-indigo-400 bg-indigo-50" : "border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      <input
                        type="radio"
                        name={`resolution-${alert.id}`}
                        checked={choice[alert.id] === index}
                        onChange={() => setChoice((prev) => ({ ...prev, [alert.id]: index }))}
                        className="mt-0.5 accent-indigo-600"
                      />
                      <span>
                        <span className="font-semibold text-slate-900">{option.label}</span>
                        <span className="block text-slate-500">{option.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>

                <textarea
                  value={notes[alert.id] ?? ""}
                  onChange={(e) => setNotes((prev) => ({ ...prev, [alert.id]: e.target.value }))}
                  placeholder="What did you check, and what did it show? Kept as the audit record."
                  rows={2}
                  className="w-full rounded-md border border-slate-300 p-2 text-xs focus:border-indigo-400 focus:outline-none"
                />

                <Button
                  onClick={() => void resolve(alert)}
                  disabled={savingId === alert.id}
                  size="sm"
                  className="bg-indigo-600 hover:bg-indigo-700"
                >
                  {savingId === alert.id ? "Saving…" : "Record decision"}
                </Button>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </DashboardLayout>
  );
}
