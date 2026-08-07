/**
 * UAT release board — deploy, retest, release, verify.
 *
 * The retest form is deliberately NOT a Pass button. A record storing only "passed" cannot
 * be told apart from a retest nobody performed, and six months later there is no way to
 * know which. Every field here is one an auditor would ask for, captured at the moment
 * somebody actually knows the answer.
 *
 * None of this depends on the AI pipeline: it applies verbatim to fixes engineers write by
 * hand, which is every fix today.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader, RefreshCcw, Rocket, XCircle } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

interface Item {
  id: string;
  feedback_code: string;
  title: string;
  status: string;
  severity: string;
  priority: string;
}

const RETEST_STATES = ["ready_for_retest"];
const VERIFY_STATES = ["production_released"];

export default function NativeUatReleaseBoard() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [retestFor, setRetestFor] = useState<Item | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await hrmsApi.get<{ data: Item[] }>("/api/uat/feedback?limit=200");
      setItems(res.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load items.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const awaitingRetest = items.filter((i) => RETEST_STATES.includes(i.status));
  const awaitingVerify = items.filter((i) => VERIFY_STATES.includes(i.status));
  const merged = items.filter((i) => i.status === "merged");

  async function deploy(item: Item) {
    setBusy(item.id);
    try {
      await hrmsApi.post(`/api/uat/feedback/${item.id}/deploy`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not mark as deployed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <DashboardLayout>
      <div className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">UAT releases</h1>
            <p className="mt-1 text-sm text-slate-600">
              A merged fix is not a fixed defect. It closes when the reporter confirms it in
              production.
            </p>
          </div>
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="mt-10 flex justify-center">
            <Loader className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : (
          <div className="mt-6 space-y-8">
            <Section
              title="Merged — awaiting deployment to UAT"
              empty="Nothing waiting to be deployed."
              items={merged}
              render={(i) => (
                <button
                  onClick={() => void deploy(i)}
                  disabled={busy === i.id}
                  className="inline-flex items-center gap-1.5 rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:bg-slate-300"
                >
                  <Rocket className="h-3.5 w-3.5" />
                  Mark deployed
                </button>
              )}
            />

            <Section
              title="Awaiting retest"
              empty="Nothing waiting to be retested."
              items={awaitingRetest}
              render={(i) => (
                <button
                  onClick={() => setRetestFor(i)}
                  className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Record retest
                </button>
              )}
            />

            <Section
              title="Released — awaiting production verification"
              empty="Nothing awaiting verification."
              items={awaitingVerify}
              render={() => (
                <span className="text-xs text-slate-500">
                  Only the reporter or QA owner can verify
                </span>
              )}
            />
          </div>
        )}

        {retestFor && (
          <RetestDialog
            item={retestFor}
            onClose={() => setRetestFor(null)}
            onDone={async () => {
              setRetestFor(null);
              await load();
            }}
          />
        )}
      </div>
    </DashboardLayout>
  );
}

function Section({
  title,
  items,
  empty,
  render,
}: {
  title: string;
  items: Item[];
  empty: string;
  render: (i: Item) => React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
        {title} <span className="text-slate-400">({items.length})</span>
      </h2>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-slate-400">{empty}</p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-200 rounded border border-slate-200 bg-white">
          {items.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-4 p-3">
              <div className="min-w-0">
                <p className="font-mono text-xs text-slate-500">{i.feedback_code}</p>
                <p className="truncate text-sm font-medium text-slate-800">{i.title}</p>
              </div>
              <div className="shrink-0">{render(i)}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Structured evidence capture. Every field is required by the backend, not just by this form. */
function RetestDialog({
  item,
  onClose,
  onDone,
}: {
  item: Item;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const [environment, setEnvironment] = useState("uat");
  const [buildSha, setBuildSha] = useState("");
  const [scenario, setScenario] = useState("");
  const [steps, setSteps] = useState("");
  const [expected, setExpected] = useState("");
  const [actual, setActual] = useState("");
  const [result, setResult] = useState<"pass" | "fail">("pass");
  const [failureReason, setFailureReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const complete =
    scenario.trim() && steps.trim() && expected.trim() && actual.trim() &&
    (result === "pass" || failureReason.trim());

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await hrmsApi.post(`/api/uat/feedback/${item.id}/retest`, {
        environment,
        buildSha: buildSha || null,
        scenario: scenario.trim(),
        stepsPerformed: steps.trim(),
        expectedResult: expected.trim(),
        actualResult: actual.trim(),
        result,
        failureReason: result === "fail" ? failureReason.trim() : null,
      });
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record the retest.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="font-mono text-xs text-slate-500">{item.feedback_code}</p>
        <h2 className="mt-1 text-lg font-semibold text-slate-900">Record retest</h2>
        <p className="mt-1 text-sm text-slate-600">
          These details are what make the result trustworthy later. A verdict on its own is not
          evidence.
        </p>

        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-700">Environment</span>
              <input
                value={environment}
                onChange={(e) => setEnvironment(e.target.value)}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-700">Build SHA (optional)</span>
              <input
                value={buildSha}
                onChange={(e) => setBuildSha(e.target.value)}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-sm"
              />
            </label>
          </div>

          {[
            ["What did you test?", scenario, setScenario, "Opened the leave balance page as a branch user"],
            ["Steps you performed", steps, setSteps, "1. Login\n2. Open /leave/balance"],
            ["Expected result", expected, setExpected, "Carry forward shows 8 days"],
            ["Actual result", actual, setActual, "Carry forward shows 8 days"],
          ].map(([label, value, setter, placeholder]) => (
            <label key={label as string} className="block text-sm">
              <span className="text-slate-700">{label as string}</span>
              <textarea
                value={value as string}
                onChange={(e) => (setter as (v: string) => void)(e.target.value)}
                rows={2}
                placeholder={placeholder as string}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
          ))}

          <div className="flex gap-2">
            <button
              onClick={() => setResult("pass")}
              className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded border px-3 py-2 text-sm font-medium ${
                result === "pass"
                  ? "border-emerald-600 bg-emerald-600 text-white"
                  : "border-slate-300 bg-white text-slate-700"
              }`}
            >
              <CheckCircle2 className="h-4 w-4" /> Passed
            </button>
            <button
              onClick={() => setResult("fail")}
              className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded border px-3 py-2 text-sm font-medium ${
                result === "fail"
                  ? "border-red-600 bg-red-600 text-white"
                  : "border-slate-300 bg-white text-slate-700"
              }`}
            >
              <XCircle className="h-4 w-4" /> Failed
            </button>
          </div>

          {result === "fail" && (
            <label className="block text-sm">
              <span className="text-slate-700">What went wrong?</span>
              <textarea
                value={failureReason}
                onChange={(e) => setFailureReason(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
          )}

          {error && (
            <p className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700">
              Cancel
            </button>
            <button
              onClick={() => void submit()}
              disabled={!complete || saving}
              className="inline-flex items-center gap-2 rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:bg-slate-300"
            >
              {saving && <Loader className="h-4 w-4 animate-spin" />}
              Save retest
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
