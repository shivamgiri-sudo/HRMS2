import { useCallback, useEffect, useRef, useState } from "react";
import {
  Search, CheckCircle2, XCircle, AlertTriangle, ShieldCheck, Loader, Undo2,
  Camera, QrCode, X,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { Link, useSearchParams } from "react-router-dom";

/** Shape of a Phase 4 gate token: 16 HMAC bytes, base64url (see exit-pass.qr.ts). */
const QR_TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;

/**
 * Pulls a gate token out of whatever the camera actually decoded.
 *
 * Accepts both the full verify URL the printed QR encodes and a bare token,
 * because the same scan can arrive by two routes: the phone's native camera app
 * (which navigates, so the token arrives as ?t=) or the in-page scanner below
 * (which hands over the raw decoded string). Anything else — a courier label, an
 * asset sticker, an unrelated QR — returns null and is reported as "not a gate
 * pass QR" rather than sent to the server.
 */
function extractQrToken(raw: string): string | null {
  const value = raw.trim();
  if (QR_TOKEN_RE.test(value)) return value;
  try {
    const t = new URL(value).searchParams.get("t");
    return t && QR_TOKEN_RE.test(t) ? t : null;
  } catch {
    return null;
  }
}

/**
 * Minimal BarcodeDetector surface — not in TS's DOM lib yet.
 * Feature-detected before use; see ScanPanel for the fallback path.
 */
type BarcodeDetectorLike = { detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>> };
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

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
  const [searchParams, setSearchParams] = useSearchParams();
  const [passNumber, setPassNumber] = useState("");
  const [result, setResult] = useState<VerifyLookup | null>(null);
  const [gate, setGate] = useState("");
  const [returnDraft, setReturnDraft] = useState<ReturnDraft>({});
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  /**
   * Set only when this pass was resolved by SCANNING. It is what makes
   * method:'qr' provable — the server re-hashes it against the pass's stored
   * hash and refuses method:'qr' without a match, so this cannot be spoofed by
   * a client that simply claims to have scanned.
   */
  const [scannedToken, setScannedToken] = useState<string | null>(null);

  const runLookup = useCallback(async (opts: { passNumber?: string; token?: string }) => {
    const typed = opts.passNumber?.trim();
    if (!opts.token && !typed) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    setResult(null);
    try {
      const path = opts.token
        ? `/api/exit-passes/verify/token/${encodeURIComponent(opts.token)}`
        : `/api/exit-passes/verify/${encodeURIComponent(typed!)}`;
      const res = await hrmsApi.get<{ success: boolean; data: VerifyLookup; message?: string }>(path);
      if (!res?.success) throw new Error(res?.message ?? "Not found");
      setResult(res.data);
      // Mirror the resolved number into the input so a scan leaves the guard
      // looking at the same screen a manual lookup would have produced.
      if (res.data.pass_number) setPassNumber(res.data.pass_number);
      setScannedToken(opts.token ?? null);
      setReturnDraft(
        Object.fromEntries(res.data.items.map((it) => [it.id, { condition_in: "Working", has_damage: false, missing: false }])),
      );
    } catch (e) {
      // Drop the token on failure: a stale one must never carry over into the
      // next lookup and label a hand-typed verification as a scan.
      setScannedToken(null);
      setError(e instanceof Error ? e.message : "No pass found with that number.");
    } finally {
      setLoading(false);
    }
  }, []);

  const lookup = () => runLookup({ passNumber });

  /**
   * Arrival from the phone's native camera app: the printed QR is a URL, so
   * scanning it outside this app navigates here with ?t=<token>.
   *
   * The param is consumed and stripped immediately — leaving a gate credential
   * sitting in the address bar (and in history) after it has been used is the
   * kind of thing that gets shoulder-surfed at a reception desk.
   */
  useEffect(() => {
    const token = searchParams.get("t");
    if (!token) return;
    const next = new URLSearchParams(searchParams);
    next.delete("t");
    setSearchParams(next, { replace: true });

    const parsed = extractQrToken(token);
    if (!parsed) {
      setError("That QR is not a gate pass QR.");
      return;
    }
    void runLookup({ token: parsed });
    // searchParams/setSearchParams are intentionally omitted: this must fire for
    // the arriving token once, and re-running it after the param is stripped
    // would immediately re-clear and re-query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runLookup]);

  const onScanned = useCallback(
    (raw: string) => {
      const token = extractQrToken(raw);
      if (!token) {
        setError("That QR is not a gate pass QR.");
        return;
      }
      setScanOpen(false);
      void runLookup({ token });
    },
    [runLookup],
  );

  const verifyExit = async () => {
    if (!result || !gate.trim()) return;
    setVerifying(true);
    setError(null);
    try {
      // method reflects how this pass was ACTUALLY resolved, not a UI default.
      // The server validates qr_token against the pass and rejects method:'qr'
      // without a match rather than downgrading it, so reporting 'qr' here is
      // only ever possible after a real scan.
      const res = await hrmsApi.post<{ success: boolean; message?: string }>(
        `/api/exit-passes/verify/${encodeURIComponent(result.pass_number)}/exit`,
        scannedToken
          ? { gate, method: "qr", qr_token: scannedToken }
          : { gate, method: "manual" },
      );
      if (!res?.success) throw new Error(res?.message ?? "Could not record exit");
      setSuccess(`Exit recorded for ${result.pass_number}.`);
      // Returnable items move to outside_premises (awaiting return); non-returnable close immediately.
      const newVerdict = result.movement_type === "returnable" ? "valid_return" : "already_used";
      const newStatus = result.movement_type === "returnable" ? "outside_premises" : "closed";
      setResult({ ...result, verdict: newVerdict, status: newStatus });
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
      <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-5">
        {/* Gradient header */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-800 via-slate-700 to-rose-800 text-white p-6 shadow-lg">
          <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
          <div className="absolute right-24 bottom-0 h-16 w-16 rounded-full bg-rose-400/20 blur-xl" />
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/15">
              <ShieldCheck className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-slate-300">Security · Gate Control</p>
              <h1 className="mt-0.5 text-2xl font-bold text-white">Gate Pass Verification</h1>
              <p className="mt-0.5 text-sm text-slate-300">
                Verify exit or return of materials at the gate. Scan the pass QR, or enter the pass number.
              </p>
            </div>
          </div>
          <div className="mt-4 text-xs text-slate-400">
            <Link to="/it-admin/exit-pass" className="text-rose-300 hover:text-white transition-colors">← Back to Exit Passes</Link>
          </div>
        </div>

        <div className="flex gap-2">
          <input
            value={passNumber}
            onChange={(e) => {
              setPassNumber(e.target.value.toUpperCase());
              // Typing over a scanned result makes this a manual verification.
              setScannedToken(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && void lookup()}
            /* Live format is GP-{branch_code}-{year}-{6 digits} — branch_code is
               the full code, not a 3-letter abbreviation (checked against
               mas_hrms 2026-08-30: real passes read GP-NOIDA-2026-000001). */
            placeholder="GP-NOIDA-2026-000001"
            aria-label="Gate pass number"
            className="flex-1 rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-rose-500"
          />
          <button
            onClick={() => setScanOpen((v) => !v)}
            aria-label={scanOpen ? "Close QR scanner" : "Scan gate pass QR"}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
          >
            {scanOpen ? <X className="h-4 w-4" /> : <QrCode className="h-4 w-4" />} Scan
          </button>
          <button
            onClick={() => void lookup()}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {loading ? <Loader className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Look up
          </button>
        </div>

        {scanOpen && <ScanPanel onScanned={onScanned} onClose={() => setScanOpen(false)} />}

        {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
        {success && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div>}

        {result && verdict && VerdictIcon && (
          <div className="rounded-2xl border border-slate-200 overflow-hidden">
            <div className={`flex items-center gap-2 px-5 py-3 border-b font-bold text-sm ${verdict.color}`}>
              <VerdictIcon className="h-5 w-5" /> {verdict.label}
              {scannedToken && (
                <span
                  title="Resolved by scanning the printed pass — the exit will be recorded with method 'qr'."
                  className="inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-slate-900 text-white"
                >
                  <QrCode className="h-3 w-3" /> Scanned
                </span>
              )}
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

/**
 * In-page camera scanner.
 *
 * Uses the browser's native BarcodeDetector — deliberately NO scanning
 * dependency was added for this. The printed QR encodes a URL, so the phone's
 * own camera app is already a fully working scanner on every device (it
 * navigates here with ?t=). This panel is the convenience path for a gate
 * terminal with a webcam, so it is allowed to be unavailable: where
 * BarcodeDetector is missing (Safari, Firefox) it says so and points at the two
 * paths that always work, rather than shipping a decoder bundle to every user of
 * the app for a screen most of them never open.
 *
 * Every exit route stops the camera track. A page that keeps the camera light on
 * after the guard is done is both a privacy problem and, on a shared gate
 * terminal, the thing that makes someone tape over the lens.
 */
function ScanPanel({ onScanned, onClose }: { onScanned: (raw: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const [status, setStatus] = useState<"starting" | "scanning" | "unsupported" | "denied">("starting");

  useEffect(() => {
    const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    if (!Detector) {
      setStatus("unsupported");
      return;
    }

    let stopped = false;
    const detector = new Detector({ formats: ["qr_code"] });

    const stop = () => {
      stopped = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };

    (async () => {
      try {
        // facingMode 'environment' matters on a phone: the default is the
        // selfie camera, which cannot see the pass the guard is holding.
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setStatus("scanning");

        const tick = async () => {
          if (stopped || !videoRef.current) return;
          try {
            // readyState guard: detect() on a not-yet-decoding video throws on
            // some builds, and the first frames after play() are exactly that.
            if (videoRef.current.readyState >= 2) {
              const hits = await detector.detect(videoRef.current);
              const raw = hits.find((h) => h.rawValue)?.rawValue;
              if (raw) {
                stop();
                onScanned(raw);
                return;
              }
            }
          } catch {
            // A single bad frame is normal (mid-resize, mid-focus). Keep looping;
            // a genuinely broken detector simply never yields a hit, and the
            // guard falls back to typing the number.
          }
          rafRef.current = requestAnimationFrame(() => void tick());
        };
        rafRef.current = requestAnimationFrame(() => void tick());
      } catch {
        setStatus("denied");
      }
    })();

    return stop;
  }, [onScanned]);

  return (
    <div className="rounded-2xl border border-slate-200 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 bg-slate-50">
        <Camera className="h-4 w-4 text-slate-500" />
        <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Scan gate pass QR</span>
        <button
          onClick={onClose}
          aria-label="Close QR scanner"
          className="ml-auto text-slate-400 hover:text-slate-700"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {status === "unsupported" && (
        <div className="px-4 py-4 text-sm text-slate-600">
          This browser cannot open the camera for scanning. Two options that always work: scan the pass with the
          phone&apos;s own camera app (the QR opens this screen with the pass already loaded), or type the pass number
          above.
        </div>
      )}
      {status === "denied" && (
        <div className="px-4 py-4 text-sm text-amber-700 bg-amber-50">
          Camera access was blocked. Allow it in the browser&apos;s site settings, or enter the pass number above.
        </div>
      )}
      {(status === "starting" || status === "scanning") && (
        <div className="relative bg-slate-900">
          {/* muted + playsInline are required for autoplay on iOS Safari. */}
          <video ref={videoRef} muted playsInline className="w-full max-h-64 object-cover" />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-40 w-40 rounded-xl border-2 border-white/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          </div>
          <div className="absolute bottom-2 left-0 right-0 text-center text-[11px] text-white/80">
            {status === "starting" ? "Starting camera…" : "Hold the pass QR inside the frame"}
          </div>
        </div>
      )}
    </div>
  );
}
