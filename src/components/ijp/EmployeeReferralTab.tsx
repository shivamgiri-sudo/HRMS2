import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { hrmsApi } from "@/lib/hrmsApi";
import { useBranches, useProcesses } from "@/hooks/useOrgMasters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const RELATIONSHIPS = [
  "Friend",
  "Relative",
  "Ex-colleague",
  "Neighbour",
  "Other",
] as const;
const EDUCATION = [
  "10th Pass",
  "12th Pass",
  "Graduate",
  "Post Graduate",
  "Diploma",
] as const;
const EXPERIENCE = [
  "Fresher",
  "Less than 1 year",
  "1-3 years",
  "3-5 years",
  "More than 5 years",
] as const;

interface ReferralRow {
  id: string;
  candidateCode: string;
  name: string;
  stage: string;
  process: string | null;
  branch: string | null;
  relationship: string | null;
  referredOn: string | null;
}

interface FormState {
  fullName: string;
  mobile: string;
  email: string;
  education: string;
  experience: string;
  branchId: string;
  processId: string;
  relationship: string;
  remarks: string;
}

const EMPTY: FormState = {
  fullName: "",
  mobile: "",
  email: "",
  education: "",
  experience: "",
  branchId: "",
  processId: "",
  relationship: "",
  remarks: "",
};

const selectClass =
  "h-11 w-full rounded-md border border-slate-200 bg-white px-2 text-sm sm:h-9";

const nameOf = (
  item:
    { name?: string; branch_name?: string; process_name?: string } | undefined,
): string => item?.branch_name ?? item?.process_name ?? item?.name ?? "";

/**
 * Refer a candidate. Posts to the employee-referral endpoint, which creates the candidate through the
 * existing ATS registration (same duplicate checks) tagged as an Employee Referral, so recruiters see it
 * in their normal queue. "My referrals" shows where each one stands in the ATS pipeline.
 */
export function EmployeeReferralTab() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const branches = useBranches().data ?? [];
  const processes = useProcesses(form.branchId || undefined).data ?? [];
  const mine = useQuery({
    queryKey: ["employee-referrals", "mine"],
    queryFn: () =>
      hrmsApi.get<{ data: ReferralRow[] }>("/api/employee-referrals/mine"),
    staleTime: 30_000,
  });

  const submit = useMutation({
    mutationFn: () =>
      hrmsApi.post("/api/employee-referrals", {
        fullName: form.fullName,
        mobile: form.mobile,
        email: form.email || null,
        education: form.education,
        experience: form.experience,
        appliedForBranch: nameOf(branches.find((b) => b.id === form.branchId)),
        appliedForProcess: nameOf(
          processes.find((p) => p.id === form.processId),
        ),
        relationship: form.relationship,
        remarks: form.remarks || null,
      }),
    onSuccess: () => {
      toast.success(
        "Referral submitted. Recruiters will contact your candidate.",
      );
      setForm(EMPTY);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["employee-referrals"] });
    },
    onError: (err: unknown) =>
      setError(
        err instanceof Error ? err.message : "Could not submit the referral",
      ),
  });

  const set = (key: keyof FormState) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));
  const complete =
    form.fullName.trim() !== "" &&
    /^[6-9]\d{9}$/.test(form.mobile) &&
    form.education !== "" &&
    form.experience !== "" &&
    form.branchId !== "" &&
    form.processId !== "" &&
    form.relationship !== "";
  const rows = mine.data?.data ?? [];

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form
        className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (complete) submit.mutate();
        }}
        aria-label="Refer a candidate"
      >
        <h3 className="text-sm font-semibold text-slate-800">
          Refer a candidate
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="ref-name">Candidate name</Label>
            <Input
              id="ref-name"
              value={form.fullName}
              maxLength={120}
              onChange={(e) => set("fullName")(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ref-mobile">Mobile</Label>
            <Input
              id="ref-mobile"
              inputMode="numeric"
              maxLength={10}
              value={form.mobile}
              onChange={(e) => set("mobile")(e.target.value.replace(/\D/g, ""))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ref-email">Email (optional)</Label>
            <Input
              id="ref-email"
              type="email"
              value={form.email}
              onChange={(e) => set("email")(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ref-rel">Your relationship</Label>
            <select
              id="ref-rel"
              className={selectClass}
              value={form.relationship}
              onChange={(e) => set("relationship")(e.target.value)}
            >
              <option value="">Select...</option>
              {RELATIONSHIPS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ref-edu">Education</Label>
            <select
              id="ref-edu"
              className={selectClass}
              value={form.education}
              onChange={(e) => set("education")(e.target.value)}
            >
              <option value="">Select...</option>
              {EDUCATION.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ref-exp">Experience</Label>
            <select
              id="ref-exp"
              className={selectClass}
              value={form.experience}
              onChange={(e) => set("experience")(e.target.value)}
            >
              <option value="">Select...</option>
              {EXPERIENCE.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ref-branch">Branch</Label>
            <select
              id="ref-branch"
              className={selectClass}
              value={form.branchId}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  branchId: e.target.value,
                  processId: "",
                }))
              }
            >
              <option value="">Select...</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {nameOf(b)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ref-process">Process</Label>
            <select
              id="ref-process"
              className={selectClass}
              value={form.processId}
              disabled={form.branchId === ""}
              onChange={(e) => set("processId")(e.target.value)}
            >
              <option value="">
                {form.branchId === "" ? "Choose a branch first" : "Select..."}
              </option>
              {processes.map((p) => (
                <option key={p.id} value={p.id}>
                  {nameOf(p)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="ref-remarks">
            Anything recruiters should know (optional)
          </Label>
          <Textarea
            id="ref-remarks"
            rows={2}
            maxLength={500}
            value={form.remarks}
            onChange={(e) => set("remarks")(e.target.value)}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <Button type="submit" disabled={!complete || submit.isPending}>
          Submit referral
        </Button>
      </form>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-800">My referrals</h3>
        {mine.isLoading && <p className="text-sm text-slate-500">Loading...</p>}
        {!mine.isLoading && rows.length === 0 && (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
            You have not referred anyone yet.
          </p>
        )}
        {rows.length > 0 && (
          <div className="overflow-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="p-3">Candidate</th>
                  <th className="p-3">Process</th>
                  <th className="p-3">Referred</th>
                  <th className="p-3">Stage</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="p-3">
                      <div className="font-medium text-slate-800">{r.name}</div>
                      <div className="text-xs text-slate-400">
                        {r.candidateCode}
                      </div>
                    </td>
                    <td className="p-3 text-slate-600">
                      {[r.process, r.branch].filter(Boolean).join(" - ") || "-"}
                    </td>
                    <td className="p-3 font-mono text-slate-600">
                      {r.referredOn ?? "-"}
                    </td>
                    <td className="p-3">
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
                        {r.stage}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
