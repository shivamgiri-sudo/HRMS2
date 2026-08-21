import { useState } from "react";
import { Search, CheckCircle2, XCircle, AlertTriangle, ShieldCheck, Loader, Undo2 } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

type VerifyItem = { id: string; category: string; item_name: string; asset_id?: string | null; quantity: number };

type VerifyLookup = {
  id: string;
  pass_number: string;
  status: string;
  movement_type: "returnable" | "non_returnable";
  branch_name: string;
  requestor_name: string;
  carrier_name?: string | null;
  carrier_type: string;
  planned_exit_at: string;
  expected_return_at?: string | null;
  exit_verified_at?: string | null;
  exit_gate?: string | null;
  items: VerifyItem[];
  verdict: "valid" | "valid_return" | "already_used" | "invalid" | "not_ready";
  is_overdue: boolean;
};

type ReturnDraft = Record<string, { condition_in: string; has_damage: boolean; missing: boolean }>;

const VERDICT_UI: Record<VerifyLookup["verdict"], { label: string; color: string; icon: typeof CheckCircle2 }> = {
  valid: { label: "VALID & APPROVED", color: "text-emerald-600 bg-emerald-50 border-emerald-200", icon: CheckCircle2 },
  valid_return: { label: "OUTSIDE PREMISES — DUE FOR RETURN", color: "text-blue-600 bg-blue-50 border-blue-200", icon: Undo2 },
  already_used: { label: "ALREADY USED / CLOSED", color: "text-amber-600 bg-amber-50 border-amber-200", icon: AlertTriangle },
  invalid: { label: "REJECTED / CANCELLED", color: "text-rose-600 bg-rose-50 border-rose-200", icon: XCircle },
  not_ready: { label: "NOT YET APPROVED", color: "text-slate-500 bg-slate-50 border-slate-200", icon: AlertTriangle },
};

const CONDITIONS = ["Working", "Minor Wear", "Damaged", "Not Working"];

export default function NativeExitPassVerify() {
  const [passNumber, setPassNumber] = useState("");
  const [result, setResult] = useState<VerifyLookup | null>(null);
  const [gate, setGate] = useState("");
  const [returnDraft, setReturnDraft] = useState<ReturnDraft>({});
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const lookup = async () => {
    if (!passNumber.trim()) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    setResult(null);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: VerifyLookup; message?: string }>(
        `/api/exit-passes/verify/${encodeURIComponent(passNumber.trim())}`,
      );
      if (!res?.success) throw new Error(res?.message ?? "Not found");
      setResult(res.data);
      setReturnDraft(
        Object.fromEntries(res.data.items.map((it) => [it.id, { condition_in: "Working", has_damage: false, missing: false }])),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pass found with that number.");
    } finally {
      setLoading(false);
    }
  };

  const verifyExit = async () => {
    if (!result || !gate.trim()) return;
    setVerifying(true);
    setError(null);
    try {
      const res = await hrmsApi.post<{ success: boolean; message?: string }>(
        `/api/exit-passes/verify/${encodeURIComponent(result.pass_number)}/exit`,
        { gate, method: "manual" },
      );
      if (!res?.success) throw new Error(res?.message ?? "Could not record exit");
      setSuccess(`Exit recorded for ${result.pass_number}.`);
      setResult({ ...result, verdict: "already_used", status: "exit_verified" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record exit");
    } finally {
      setVerifying(false);
    }
  };

  const verifyReturn = async () => {
    if (!result) return;
    setVerifying(true);
    setError(null);
    try {
      const items = result.items.map((it) => ({ id: it.id, ...returnDraft[it.id] }));
      const res = await hrmsApi.post<{ success: boolean; message?: string }>(
        `/api/exit-passes/verify/${encodeURIComponent(result.pass_number)}/return`,
        { items },
      );
      if (!res?.success) throw new Error(res?.message ?? "Could not record return");
      setSuccess(`Return recorded for ${result.pass_number}. Pass closed.`);
      setResult({ ...result, verdict: "already_used", status: "closed" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record return");
    } finally {
      setVerifying(false);
    }
  };

  const verdict = result ? VERDICT_UI[result.verdict] : null;
  const VerdictIcon = verdict?.icon;

  return (
    <DashboardLayout>
      <div className="p-6 max-w-2xl mx-auto">
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck className="h-6 w-6 text-slate-700" />
          <h1 className="text-2xl font-bold text-slate-900">Security — Gate Pass Verification</h1>
        </div>
        <p className="text-sm text-slate-500 mb-6">
          Enter the Gate Pass number (or the number scanned from its QR) — on exit, or when the material comes back.
        </p>

        <div className="flex gap-2 mb-6">
          <input
            value={passNumber}
            onChange={(e) => setPassNumber(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && void lookup()}
            placeholder="GP-NOI-2026-000004"
            className="flex-1 rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-rose-500"
          />
          <button
            onClick={() => void lookup()}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {loading ? <Loader className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Look up
          </button>
        </div>

        {error && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
        {success && <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div>}

        {result && verdict && VerdictIcon && (
          <div className="rounded-2xl border border-slate-200 overflow-hidden">
            <div className={`flex items-center gap-2 px-5 py-3 border-b font-bold text-sm ${verdict.color}`}>
              <VerdictIcon className="h-5 w-5" /> {verdict.label}
              {result.is_overdue && (
                <span className="ml-auto text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-rose-600 text-white">Overdue</span>
              )}
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <Field label="Pass No." value={result.pass_number} mono />
                <Field label="Branch" value={result.branch_name} />
                <Field label="Requestor" value={result.requestor_name} />
                <Field label="Movement" value={result.movement_type === "returnable" ? "Returnable" : "Non-Returnable"} />
                <Field label="Carrying" value={result.carrier_name || "—"} />
                <Field
                  label={result.verdict === "valid_return" ? "Expected Return" : "Exit Date"}
                  value={
                    result.verdict === "valid_return" && result.expected_return_at
                      ? new Date(result.expected_return_at).toLocaleDateString()
                      : new Date(result.planned_exit_at).toLocaleDateString()
                  }
                />
              </div>

              {result.verdict !== "valid_return" && (
                <div>
                  <div className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-1.5">Items ({result.items.length})</div>
                  <ul className="text-sm space-y-1">
                    {result.items.map((it) => (
                      <li key={it.id} className="text-slate-700">
                        {it.item_name}
                        {it.asset_id ? ` — ${it.asset_id}` : ""}
                        <span className="text-slate-400"> × {it.quantity}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {result.verdict === "valid" && (
                <div className="pt-3 border-t border-slate-100 flex items-end gap-2">
                  <div className="flex-1">
                    <label className="block text-xs font-bold uppercase tracking-wide text-slate-400 mb-1.5">Gate</label>
                    <input
                      value={gate}
                      onChange={(e) => setGate(e.target.value)}
                      placeholder="e.g. Main Gate"
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500"
                    />
                  </div>
                  <button
                    onClick={() => void verifyExit()}
                    disabled={verifying || !gate.trim()}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {verifying ? <Loader className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Verify Exit
                  </button>
                </div>
              )}

              {result.verdict === "valid_return" && (
                <div className="pt-3 border-t border-slate-100 space-y-3">
                  <div className="text-xs font-bold uppercase tracking-wide text-slate-400">Condition on return</div>
                  {result.items.map((it) => {
                    const draft = returnDraft[it.id] ?? { condition_in: "Working", has_damage: false, missing: false };
                    return (
                      <div key={it.id} className="grid grid-cols-12 gap-2 items-center text-sm">
                        <div className="col-span-4 text-slate-700">{it.item_name}</div>
                        <select
                          value={draft.condition_in}
                          onChange={(e) => setReturnDraft((prev) => ({ ...prev, [it.id]: { ...draft, condition_in: e.target.value } }))}
                          className="col-span-3 rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                        >
                          {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <label className="col-span-2 flex items-center gap-1.5 text-xs text-slate-600">
                          <input
                            type="checkbox"
                            checked={draft.has_damage}
                            onChange={(e) => setReturnDraft((prev) => ({ ...prev, [it.id]: { ...draft, has_damage: e.target.checked } }))}
                          /> Damaged
                        </label>
                        <label className="col-span-3 flex items-center gap-1.5 text-xs text-slate-600">
                          <input
                            type="checkbox"
                            checked={draft.missing}
                            onChange={(e) => setReturnDraft((prev) => ({ ...prev, [it.id]: { ...draft, missing: e.target.checked } }))}
                          /> Missing accessory
                        </label>
                      </div>
                    );
                  })}
                  <button
                    onClick={() => void verifyReturn()}
                    disabled={verifying}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {verifying ? <Loader className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Verify Return &amp; Close
                  </button>
                </div>
              )}

              {result.verdict === "already_used" && result.exit_verified_at && (
                <div className="text-xs text-slate-400 pt-3 border-t border-slate-100">
                  Exit recorded: {new Date(result.exit_verified_at).toLocaleString()}
                  {result.exit_gate ? ` via ${result.exit_gate}` : ""}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`text-sm ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}
