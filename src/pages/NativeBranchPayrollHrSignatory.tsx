/**
 * Super Admin: which Payroll HR signs each branch's joining documents.
 *
 * Two things on those documents name a person, and until now neither named the
 * right one. The HR name on the NDA / Surveillance declaration printed blank on
 * every document ever issued, and the employer signature on the EPF forms came
 * from a single company-wide seal — so a Noida joiner and a Jaipur joiner were
 * signed for by the same person regardless of who processed them.
 *
 * The screen lists every branch, including the ones nobody has configured,
 * because seeing the gaps is most of the point. Each row shows the signature on
 * file so it is obvious at a glance which branch has whose.
 */
import { useCallback, useEffect, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { hrmsApi } from "@/lib/hrmsApi";
import { AlertCircle, CheckCircle2, PenLine, Loader2, Upload } from "lucide-react";

interface BranchRow {
  branchId: string;
  branchName: string;
  branchCode: string | null;
  hrName: string | null;
  hrDesignation: string | null;
  hasSignature: boolean;
  updatedAt: string | null;
}

interface Draft {
  hrName: string;
  hrDesignation: string;
  file: File | null;
}

export default function NativeBranchPayrollHrSignatory() {
  const [rows, setRows] = useState<BranchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  /** Bumped after a save so the <img> refetches instead of showing the old one. */
  const [imageVersion, setImageVersion] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await hrmsApi.get<{ data: BranchRow[] }>("/api/branch-payroll-hr");
      const list = res?.data ?? [];
      setRows(list);
      setDrafts(Object.fromEntries(list.map((b) => [
        b.branchId,
        { hrName: b.hrName ?? "", hrDesignation: b.hrDesignation ?? "", file: null },
      ])));
    } catch {
      setError("Could not load the branch list. If this persists, the branch_payroll_hr_signatory table may not have been created yet — see backend/sql/1061.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const edit = (branchId: string, patch: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [branchId]: { ...prev[branchId], ...patch } }));

  const save = async (branch: BranchRow) => {
    const draft = drafts[branch.branchId];
    if (!draft?.hrName.trim()) { setError(`Enter the Payroll HR name for ${branch.branchName}.`); return; }

    setSavingId(branch.branchId);
    setError("");
    setSaved("");
    try {
      // Multipart so the name and the image arrive together — configuring a
      // branch is one action, and splitting it invites half-configured rows.
      const form = new FormData();
      form.append("hrName", draft.hrName.trim());
      form.append("hrDesignation", draft.hrDesignation.trim());
      if (draft.file) form.append("signature", draft.file);

      await hrmsApi.post(`/api/branch-payroll-hr/${branch.branchId}`, form);
      setSaved(`${branch.branchName} saved.`);
      setImageVersion((v) => v + 1);
      await load();
    } catch {
      setError(`Could not save ${branch.branchName}. Nothing was changed.`);
    } finally {
      setSavingId(null);
    }
  };

  const configured = rows.filter((r) => r.hrName).length;

  return (
    <DashboardLayout>
      <div className="space-y-4 p-4 sm:p-6">
        <div className="flex items-start gap-3">
          <PenLine className="h-6 w-6 text-indigo-600 flex-shrink-0 mt-0.5" />
          <div>
            <h1 className="text-lg font-bold text-slate-900">Branch Payroll HR Signatory</h1>
            <p className="text-sm text-slate-600">
              The name printed as <strong>“HR Person name”</strong> on the NDA and Surveillance declaration, and the
              signature applied to the employer block of the EPF forms — per branch, for the branch the candidate joins.
            </p>
          </div>
        </div>

        {rows.length > 0 && (
          <p className="text-xs text-slate-500">
            {configured} of {rows.length} branches configured.
            {configured < rows.length && " Unconfigured branches fall back to the company seal, and the HR name stays blank."}
          </p>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />{error}
          </div>
        )}
        {saved && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 flex-shrink-0" />{saved}
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-600 p-6">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading branches…
          </div>
        ) : (
          rows.map((branch) => {
            const draft = drafts[branch.branchId] ?? { hrName: "", hrDesignation: "", file: null };
            return (
              <Card key={branch.branchId} className="border border-slate-200">
                <CardContent className="pt-4 pb-4 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-slate-900">{branch.branchName}</span>
                    {branch.branchCode && <span className="text-xs text-slate-500">{branch.branchCode}</span>}
                    {branch.hrName ? (
                      <Badge className="bg-emerald-100 text-emerald-800 border border-emerald-300">Configured</Badge>
                    ) : (
                      <Badge className="bg-amber-100 text-amber-800 border border-amber-300">Not set</Badge>
                    )}
                    {branch.hasSignature && (
                      <Badge className="bg-indigo-100 text-indigo-800 border border-indigo-300">Signature on file</Badge>
                    )}
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input
                      value={draft.hrName}
                      onChange={(e) => edit(branch.branchId, { hrName: e.target.value })}
                      placeholder="Payroll HR name, as it should print"
                    />
                    <Input
                      value={draft.hrDesignation}
                      onChange={(e) => edit(branch.branchId, { hrDesignation: e.target.value })}
                      placeholder="Designation (optional)"
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer rounded-md border border-slate-300 px-3 py-2 hover:bg-slate-50">
                      <Upload className="h-3.5 w-3.5" />
                      {draft.file ? draft.file.name.slice(0, 28) : "Choose signature (PNG or JPEG)"}
                      <input
                        type="file"
                        accept="image/png,image/jpeg"
                        className="hidden"
                        onChange={(e) => edit(branch.branchId, { file: e.target.files?.[0] ?? null })}
                      />
                    </label>

                    {branch.hasSignature && (
                      // Shown so it is obvious which branch has whose signature,
                      // without anyone opening the uploads directory.
                      <img
                        src={`/api/branch-payroll-hr/${branch.branchId}/signature?v=${imageVersion}`}
                        alt={`Signature on file for ${branch.branchName}`}
                        className="h-10 rounded border border-slate-200 bg-white px-2"
                      />
                    )}

                    <Button
                      onClick={() => void save(branch)}
                      disabled={savingId === branch.branchId}
                      size="sm"
                      className="bg-indigo-600 hover:bg-indigo-700 ml-auto"
                    >
                      {savingId === branch.branchId ? "Saving…" : "Save"}
                    </Button>
                  </div>

                  {branch.hasSignature && !draft.file && (
                    <p className="text-[11px] text-slate-500">
                      Saving without choosing a file keeps the signature already on file.
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </DashboardLayout>
  );
}
