import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Printer, AlertTriangle, ArrowLeft } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { buildQrCodeUrl, buildExitPassQrData } from "@/integrations/apis/qrCode.api";

type Item = {
  id: string;
  category: string;
  item_name: string;
  asset_id?: string | null;
  serial_number?: string | null;
  make_model?: string | null;
  quantity: number;
  condition_out?: string | null;
};

type Approval = {
  stage: "branch_head" | "admin";
  approver_name: string;
  decision: "approved" | "rejected" | "returned";
  decided_at: string;
};

type Letterhead = {
  branch_name: string;
  branch_code: string;
  city: string | null;
  state: string | null;
  address: string | null;
  requestor_name: string;
};

type PassDetail = {
  id: string;
  pass_number: string | null;
  status: string;
  request_department: "IT" | "ADMIN";
  movement_type: "returnable" | "non_returnable";
  priority: string;
  purpose_details: string;
  destination_type: string;
  destination_name?: string | null;
  destination_address?: string | null;
  carrier_name?: string | null;
  carrier_type: string;
  carrier_mobile?: string | null;
  planned_exit_at: string;
  expected_return_at?: string | null;
  approved_at?: string | null;
  items: Item[];
  approvals: Approval[];
  letterhead: Letterhead | null;
  /**
   * Gate QR token, derived server-side (Phase 4). Null for a pass with no
   * pass_number, and for a pass approved before migration 1633 only until the
   * first load backfills its hash — so the QR block must degrade, not throw.
   */
  qr_token?: string | null;
};

const PRINTABLE_STATUSES = new Set(["approved", "outside_premises", "closed"]);

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    approved: "Admin Approved",
    outside_premises: "Outside Premises",
    closed: "Closed / Returned",
  };
  return map[status] ?? status.replace(/_/g, " ");
}

function fmtAddress(l: Letterhead): string {
  if (l.address?.trim()) return l.address;
  const parts = [l.city, l.state].filter(Boolean);
  return parts.length ? parts.join(", ") + " — full address not on file" : "Address not on file";
}

export default function NativeExitPassPrint() {
  const { id } = useParams<{ id: string }>();
  const [pass, setPass] = useState<PassDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const res = await hrmsApi.get<{ success: boolean; data: PassDetail; message?: string }>(`/api/exit-passes/${id}`);
        if (!res?.success) throw new Error(res?.message ?? "Could not load this pass");
        setPass(res.data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load this pass");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  // QR rendering is async (canvas → data URL), so it cannot live inside
  // PrintablePass: that component renders TWICE (screen preview + print-only
  // block) and both copies must show the same already-resolved image. Generated
  // once here and passed down instead.
  useEffect(() => {
    const token = pass?.qr_token;
    if (!token) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    (async () => {
      // 176px raster for a 112px render. Measured 2026-08-30: at a 132px raster
      // shown in 88px, OpenCV needed 8x upscaling to decode (~2.4px per module),
      // which is fine on paper but marginal for a guard scanning off a screen.
      const url = await buildQrCodeUrl(buildExitPassQrData(token), 176);
      if (!cancelled) setQrDataUrl(url);
    })();
    return () => {
      cancelled = true;
    };
  }, [pass?.qr_token]);

  const branchHead = pass?.approvals.find((a) => a.stage === "branch_head" && a.decision === "approved");
  const admin = pass?.approvals.find((a) => a.stage === "admin" && a.decision === "approved");
  const isPrintable = pass ? PRINTABLE_STATUSES.has(pass.status) : false;

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          @page { size: A4; margin: 12mm; }
          body { background: white; }
        }
      `}</style>

      {/* Screen-only chrome — hidden on print */}
      <div className="no-print p-6 max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-4">
          <Link
            to="/it-admin/exit-pass"
            className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" /> Back to Exit Passes
          </Link>
        </div>

        {loading && <div className="text-sm text-slate-400 py-16 text-center">Loading…</div>}
        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> {error}
          </div>
        )}
        {pass && !isPrintable && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            This pass is <strong>{pass.status.replace(/_/g, " ")}</strong> — printing is only available once it is
            fully approved (status must be approved, outside premises, or closed).
          </div>
        )}
        {pass && isPrintable && (
          <div className="flex justify-end mb-4">
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl bg-rose-600 text-white hover:bg-rose-700 cursor-pointer transition-colors"
            >
              <Printer className="h-4 w-4" /> Print / Save as PDF
            </button>
          </div>
        )}

        {pass && isPrintable && (
          <PrintablePass pass={pass} branchHead={branchHead} admin={admin} qrDataUrl={qrDataUrl} />
        )}
      </div>

      {/* Print-only area — invisible on screen, shows on print */}
      {pass && isPrintable && (
        <div className="hidden print:block p-8">
          <PrintablePass pass={pass} branchHead={branchHead} admin={admin} qrDataUrl={qrDataUrl} />
        </div>
      )}
    </>
  );
}

function PrintablePass({
  pass,
  branchHead,
  admin,
  qrDataUrl,
}: {
  pass: PassDetail;
  branchHead?: Approval;
  admin?: Approval;
  qrDataUrl?: string | null;
}) {
  const totalQty = pass.items.reduce((sum, it) => sum + (it.quantity || 0), 0);

  return (
    <div className="border border-slate-300 rounded-none">
      <div className="flex items-start justify-between gap-4 px-6 py-5 border-b-[3px] border-rose-600">
        <div className="flex items-center gap-3">
          <img src="/mcn-logo.png" alt="Mas Callnet India Pvt Ltd" className="h-10" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          <div>
            <div className="text-lg font-extrabold text-slate-900">Mas Callnet India Pvt Ltd</div>
            {pass.letterhead && (
              <div className="text-xs text-slate-500 whitespace-pre-line max-w-sm">{fmtAddress(pass.letterhead)}</div>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="inline-block text-[10px] font-bold uppercase tracking-wide bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-2.5 py-0.5 mb-1.5">
            {statusLabel(pass.status)}
          </div>
          <div className="font-mono text-sm font-semibold">{pass.pass_number}</div>
          {/* Gate QR sits directly under the number it resolves to, so a guard
              whose scan fails has the manual fallback in the same glance.
              print:[print-color-adjust:exact] stops the browser's "economy"
              print path from lightening the modules into an unreadable symbol. */}
          {qrDataUrl && (
            <div className="mt-2 flex flex-col items-end">
              <img
                src={qrDataUrl}
                alt={`Scan to verify gate pass ${pass.pass_number ?? ""} at security`}
                className="h-[112px] w-[112px] print:[print-color-adjust:exact]"
              />
              <div className="mt-0.5 text-[8px] font-bold uppercase tracking-widest text-slate-400">
                Scan at gate
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between px-6 py-3 bg-slate-50 border-b border-slate-200">
        <div className="text-xs font-bold uppercase tracking-widest text-slate-700">Asset / Material Exit Gate Pass</div>
        <div className="flex gap-2 text-[10px] font-bold uppercase">
          <span className="px-2.5 py-1 rounded-full border border-slate-300 text-slate-500">
            {pass.movement_type === "returnable" ? "Returnable" : "Non-Returnable"}
          </span>
        </div>
      </div>

      <div className="px-6 py-4 grid grid-cols-2 border border-slate-200 rounded-lg m-6">
        <Field label="From" value={pass.letterhead?.branch_name ?? "—"} />
        <Field label="Department" value={pass.request_department} />
        <Field label="To" value={pass.destination_name || pass.destination_type} />
        <Field label="Requestor" value={pass.letterhead?.requestor_name ?? "—"} />
        <Field label="Purpose" value={pass.purpose_details} span2 />
      </div>

      <div className="px-6">
        <div className="text-[10px] font-bold uppercase tracking-widest text-rose-600 mb-2">Description of Materials</div>
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="text-[10px] uppercase text-slate-400 border-b-2 border-slate-300">
              <th className="text-left py-1.5">Item</th>
              <th className="text-left py-1.5">Asset ID</th>
              <th className="text-left py-1.5">Serial No.</th>
              <th className="text-left py-1.5">Make/Model</th>
              <th className="text-right py-1.5">Qty</th>
            </tr>
          </thead>
          <tbody>
            {pass.items.map((it) => (
              <tr key={it.id} className="border-b border-slate-100">
                <td className="py-1.5">{it.item_name}</td>
                <td className="py-1.5 font-mono text-blue-700">{it.asset_id || "—"}</td>
                <td className="py-1.5 font-mono">{it.serial_number || "—"}</td>
                <td className="py-1.5">{it.make_model || "—"}</td>
                <td className="py-1.5 text-right font-mono">{it.quantity}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-bold">
              <td colSpan={4} className="pt-2">Total Items</td>
              <td className="pt-2 text-right text-rose-600">{totalQty}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="grid grid-cols-3 gap-4 px-6 py-6">
        <ApprovalCard role="Branch Head" name={branchHead?.approver_name} date={branchHead?.decided_at} />
        <ApprovalCard role="Admin" name={admin?.approver_name} date={admin?.decided_at} />
        <ApprovalCard role="Carrier" name={pass.carrier_name} date={null} />
      </div>

      <div className="px-6 pb-6 text-[10px] text-slate-400 border-t border-slate-200 pt-3">
        Valid only with the approvals recorded above. Security must verify this pass at the gate — scan the QR, or
        enter <span className="font-mono">{pass.pass_number}</span> on the Gate Pass Verification screen. This pass is
        single-use: once an exit is recorded against it, a further scan reads as already used.
      </div>
    </div>
  );
}

function Field({ label, value, span2 }: { label: string; value: string; span2?: boolean }) {
  return (
    <div className={`py-1.5 ${span2 ? "col-span-2" : ""}`}>
      <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  );
}

function ApprovalCard({ role, name, date }: { role: string; name?: string | null; date?: string | null }) {
  return (
    <div className="border border-slate-200 rounded-lg p-3">
      <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">{role}</div>
      <div className="text-sm font-semibold mt-1">{name || "—"}</div>
      {date && <div className="text-[10px] text-slate-400 mt-0.5">{new Date(date).toLocaleString()}</div>}
    </div>
  );
}
