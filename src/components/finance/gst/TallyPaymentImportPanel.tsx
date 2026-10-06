import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { money } from "@/components/finance/grn/grn-format";
import { GRN_TR, GrnAlert, GrnCard, GrnCardHeader, GrnChip, GrnEmptyState, GrnTable, GrnTd, GrnTh } from "@/components/finance/grn/grn-ui";

/**
 * Import payments from Tally.
 *
 * Finance pays vendors in Tally. Upload Tally's Day Book (or a vendor's Ledger Vouchers) as XML, CSV or Excel;
 * each Payment voucher is matched to the vendor's open GRNs and shown BEFORE anything is recorded. Recording is
 * once per Tally voucher: a voucher already taken shows as "Already imported" and cannot be recorded again.
 * Only the payment is recorded; no bank-ledger or journal entry (Tally holds the accounting).
 */

type Allocation = { trackingId: string; grnNumber: string; invoiceNumber: string | null; amount: number; by: string };
type PaymentRow = {
  key: string; date: string | null; number: string; party: string; narration: string; amount: number; tds: number;
  status: string; allocations: Allocation[]; candidates: string[]; candidateIds: string[]; note: string;
};
type PurchaseRow = { key: string; date: string | null; number: string; party: string; amount: number; invoice: string; status: string };
type Preview = { batchId: string; fileName: string; vouchers: number; summary: Record<string, number>; payments: PaymentRow[]; purchases: PurchaseRow[] };
type ApplyResult = { recorded: { number: string; party: string; amount: number }[]; skipped: { number: string; party: string; reason: string }[] };
type BatchRow = { id: string; file_name: string; status: string; created_at: string; applied_at: string | null; recorded: number };

const LABEL: Record<string, string> = {
  ready: "Ready to record", already_imported: "Already imported", already_paid: "Already paid in HRMS", no_vendor: "Not a vendor payment",
  no_open_bill: "No open bill fits", ambiguous: "Choose the bill", amount_mismatch: "Amount does not fit",
};
const BY: Record<string, string> = { bill_ref: "bill name in Tally", narration: "invoice no. in narration", amount: "exact amount" };
const day = (d: string | null) => (d ? d.split("-").reverse().join("-") : "");

export function TallyPaymentImportPanel() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState("all");
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [error, setError] = useState("");

  const batches = useQuery({
    queryKey: ["tally-import-batches"],
    queryFn: async () => (await hrmsApi.get<{ success: boolean; data: BatchRow[] }>("/api/finance/tally-import/batches")).data,
    retry: false,
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.set("file", file);
      return (await hrmsApi.postForm<{ success: boolean; data: Preview }>("/api/finance/tally-import/payments/preview", body)).data;
    },
    onSuccess: (data) => { setPreview(data); setChoices({}); setResult(null); setError(""); setFilter("all"); },
    onError: (e: Error) => { setError(e.message); setPreview(null); },
  });

  const apply = useMutation({
    mutationFn: async () => (await hrmsApi.post<{ success: boolean; data: ApplyResult }>("/api/finance/tally-import/payments/apply", { batchId: preview!.batchId, choices })).data,
    onSuccess: (data) => { setResult(data); setPreview(null); void qc.invalidateQueries({ queryKey: ["tally-import-batches"] }); },
    onError: (e: Error) => setError(e.message),
  });

  const ready = preview?.payments.filter((p) => p.status === "ready") ?? [];
  const picked = preview?.payments.filter((p) => p.status === "ambiguous" && choices[p.key]) ?? [];
  const toRecord = ready.length + picked.length;
  const toRecordAmount = [...ready, ...picked].reduce((s, p) => s + p.amount, 0);
  const rows = (preview?.payments ?? []).filter((p) => filter === "all" || p.status === filter);

  const confirmApply = () => {
    if (!toRecord) return;
    if (!window.confirm(`Record ${toRecord} payment(s), ${money(toRecordAmount)} in total, against the matched GRNs?\n\nEach Tally voucher is recorded once and cannot be recorded again.`)) return;
    apply.mutate();
  };

  return (
    <GrnCard>
      <GrnCardHeader
        title="Import payments from Tally"
        description="Upload Tally's Day Book or a vendor's Ledger Vouchers (XML, CSV or Excel). Payments are matched to GRNs and shown before anything is recorded."
        action={
          <>
            <input ref={fileRef} type="file" accept=".xml,.csv,.xlsx,.txt" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ""; }} />
            <GrnChip active={false} onClick={() => fileRef.current?.click()}>
              <Upload className="mr-1 h-3.5 w-3.5" />{upload.isPending ? "Reading…" : "Upload Tally file"}
            </GrnChip>
          </>
        }
      />

      <div className="space-y-3 px-4 py-3">
        {error && <GrnAlert tone="crit">{error}</GrnAlert>}

        {result && (
          <GrnAlert tone={result.skipped.length ? "warn" : "ok"}>
            Recorded {result.recorded.length} payment(s), {money(result.recorded.reduce((s, r) => s + r.amount, 0))}.
            {result.skipped.length > 0 && (
              <div className="mt-1 text-[11px]">
                Not recorded ({result.skipped.length}):
                {result.skipped.slice(0, 12).map((s) => <div key={s.number + s.party}>{s.number} · {s.party} — {s.reason}</div>)}
              </div>
            )}
          </GrnAlert>
        )}

        {preview && (
          <>
            <div className="flex flex-wrap items-center gap-1 text-[11px]">
              <span className="mr-1 font-semibold text-grn-ink">{preview.fileName} · {preview.vouchers} vouchers</span>
              <GrnChip active={filter === "all"} count={preview.payments.length} onClick={() => setFilter("all")}>All payments</GrnChip>
              {Object.entries(preview.summary).filter(([k, n]) => k !== "purchase_without_grn" && n > 0).map(([k, n]) => (
                <GrnChip key={k} active={filter === k} count={n} onClick={() => setFilter(k)}>{LABEL[k] ?? k}</GrnChip>
              ))}
            </div>

            {rows.length === 0 ? (
              <GrnEmptyState title="No payment vouchers here" description="Only Payment vouchers are taken. Receipts, journals and purchase vouchers are not payments." />
            ) : (
              <GrnTable minWidth={900}>
                <thead>
                  <tr><GrnTh>Date</GrnTh><GrnTh>Tally voucher</GrnTh><GrnTh>Vendor</GrnTh><GrnTh align="right">Amount</GrnTh><GrnTh>Matched GRN</GrnTh><GrnTh>Status</GrnTh></tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.key} className={GRN_TR}>
                      <GrnTd>{day(p.date)}</GrnTd>
                      <GrnTd title={p.narration}>{p.number || "—"}</GrnTd>
                      <GrnTd>{p.party}</GrnTd>
                      <GrnTd align="right">{money(p.amount)}{p.tds > 0 && <div className="text-[10px] text-gray-500">TDS {money(p.tds)}</div>}</GrnTd>
                      <GrnTd>
                        {p.allocations.map((a) => (
                          <div key={a.trackingId}>{a.grnNumber}{a.invoiceNumber ? ` · ${a.invoiceNumber}` : ""} <span className="text-[10px] text-gray-500">({BY[a.by] ?? a.by})</span></div>
                        ))}
                        {p.status === "ambiguous" && (
                          <select className="h-7 rounded border border-grn-line text-[11px]" value={choices[p.key] ?? ""} onChange={(e) => setChoices((c) => ({ ...c, [p.key]: e.target.value }))}>
                            <option value="">— choose a bill —</option>
                            {p.candidateIds.map((id, i) => <option key={id} value={id}>{p.candidates[i]}</option>)}
                          </select>
                        )}
                      </GrnTd>
                      <GrnTd>
                        <span className={p.status === "ready" ? "font-semibold text-emerald-700" : p.status === "already_imported" || p.status === "already_paid" ? "text-gray-500" : "text-amber-700"}>{LABEL[p.status] ?? p.status}</span>
                        {p.note && <div className="text-[10px] text-gray-500">{p.note}</div>}
                      </GrnTd>
                    </tr>
                  ))}
                </tbody>
              </GrnTable>
            )}

            <div className="flex items-center justify-between">
              <div className="text-[11px] text-gray-600">{toRecord} payment(s) to record · {money(toRecordAmount)}</div>
              <GrnChip active={toRecord > 0} onClick={confirmApply}>{apply.isPending ? "Recording…" : `Record ${toRecord} payment(s)`}</GrnChip>
            </div>

            {preview.purchases.some((p) => p.status === "not_in_hrms") && (
              <div>
                <div className="mb-1 text-[11px] font-semibold text-grn-ink">Tally purchase invoices with no GRN in HRMS ({preview.summary.purchase_without_grn}) — raise these GRNs through the normal approval flow; nothing is created here.</div>
                <GrnTable minWidth={600}>
                  <thead><tr><GrnTh>Date</GrnTh><GrnTh>Vendor</GrnTh><GrnTh>Invoice</GrnTh><GrnTh align="right">Amount</GrnTh></tr></thead>
                  <tbody>
                    {preview.purchases.filter((p) => p.status === "not_in_hrms").slice(0, 200).map((p) => (
                      <tr key={p.key} className={GRN_TR}><GrnTd>{day(p.date)}</GrnTd><GrnTd>{p.party}</GrnTd><GrnTd>{p.invoice}</GrnTd><GrnTd align="right">{money(p.amount)}</GrnTd></tr>
                    ))}
                  </tbody>
                </GrnTable>
              </div>
            )}
          </>
        )}

        {!preview && (batches.data?.length ?? 0) > 0 && (
          <div className="text-[11px] text-gray-600">
            Recent imports: {batches.data!.slice(0, 5).map((b) => `${b.file_name} (${b.status === "applied" ? `${b.recorded} recorded` : "previewed"}, ${String(b.created_at).slice(0, 10)})`).join(" · ")}
          </div>
        )}
      </div>
    </GrnCard>
  );
}
