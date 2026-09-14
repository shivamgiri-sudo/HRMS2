import { useEffect, useState } from "react";
import { Loader2, Printer, X } from "lucide-react";
import { buildQrCodeUrl, buildVisitorRegisterQrData } from "@/integrations/apis/qrCode.api";
import { visitorApi, type VisitorBranch } from "@/features/visitor/visitorApi";

/**
 * Printable QR poster for the reception desk.
 *
 * Visitors are meant to scan their way into the public registration form, but
 * nothing in the product ever produced a scannable code — the /visitor-register
 * route existed with no way to reach it except typing the URL. This is that
 * missing entry point: stick it on the desk, or show it on the lobby screen.
 */
export function VisitorQrPoster({ onClose }: { onClose: () => void }) {
  const [branches, setBranches] = useState<VisitorBranch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    visitorApi.branches().then(setBranches).catch(() => setBranches([]));
  }, []);

  const target = buildVisitorRegisterQrData(branchId || undefined);

  useEffect(() => {
    setQr(null);
    void buildQrCodeUrl(target, 1024).then(setQr).catch(() => setQr(null));
  }, [target]);

  const branchName = branches.find(b => b.id === branchId)?.branch_name;

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/60 p-5 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Visitor registration QR code">
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #visitor-qr-print, #visitor-qr-print * { visibility: visible !important; }
          #visitor-qr-print { position: fixed; inset: 0; margin: auto; box-shadow: none !important; border: none !important; }
          .visitor-qr-noprint { display: none !important; }
        }
      `}</style>

      <div className="w-full max-w-sm overflow-hidden rounded-[2rem] bg-white shadow-2xl">
        <div className="visitor-qr-noprint flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-black text-slate-950">Visitor QR code</h2>
          <button onClick={onClose} aria-label="Close" className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="visitor-qr-noprint border-b border-slate-100 px-5 py-4">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-[0.08em] text-slate-500">Pre-select branch (optional)</span>
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="h-11 w-full cursor-pointer appearance-none rounded-xl border border-slate-200 px-3.5 text-sm font-medium text-slate-900 outline-none transition focus:border-[#1B6AB5] focus:ring-4 focus:ring-[#1B6AB5]/12"
            >
              <option value="">Let the visitor choose</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.branch_name}</option>)}
            </select>
          </label>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            Pre-selecting a branch saves the visitor a step at this desk.
          </p>
        </div>

        {/* The printable poster */}
        <div id="visitor-qr-print" className="bg-white px-6 pb-7 pt-6 text-center">
          <div className="inline-flex items-center justify-center">
            <img src="/mcn-logo.png" alt="MAS Callnet" className="h-10 w-auto" />
          </div>
          <p className="mt-4 text-xl font-black leading-tight text-slate-900">Visiting us today?</p>
          <p className="mx-auto mt-1.5 max-w-[15rem] text-sm leading-relaxed text-slate-500">
            Scan this code with your phone camera to register your visit.
          </p>

          <div className="mt-5 flex justify-center">
            {qr ? (
              <img src={qr} alt="QR code to open the visitor registration form" className="h-56 w-56 rounded-2xl border border-slate-200 p-2" />
            ) : (
              <div className="flex h-56 w-56 items-center justify-center rounded-2xl border border-dashed border-slate-300">
                <Loader2 className="h-7 w-7 animate-spin text-slate-300" />
              </div>
            )}
          </div>

          {branchName && (
            <p className="mt-4 inline-block rounded-full bg-[#1B6AB5]/10 px-3 py-1 text-xs font-black text-[#1B6AB5]">{branchName}</p>
          )}
          <p className="mt-4 break-all text-[11px] text-slate-400">{target}</p>
        </div>

        <div className="visitor-qr-noprint flex gap-3 border-t border-slate-200 px-5 py-4">
          <button onClick={onClose} className="h-11 flex-1 cursor-pointer rounded-xl border border-slate-200 text-sm font-bold text-slate-700 transition hover:bg-slate-50">
            Close
          </button>
          <button
            onClick={() => window.print()}
            disabled={!qr}
            className="inline-flex h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#ed1c24] text-sm font-black text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Printer className="h-4 w-4" />Print
          </button>
        </div>
      </div>
    </div>
  );
}
