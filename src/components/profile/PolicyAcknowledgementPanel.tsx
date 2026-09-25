import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { hrmsApi } from "@/lib/hrmsApi";
import { useHasRole } from "@/hooks/useUserRole";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const CATEGORIES = [
  { value: "posh", label: "POSH" },
  { value: "integrity", label: "Integrity & ethical conduct" },
  { value: "emergency", label: "Emergency situations" },
  { value: "dress_code", label: "Workplace dress code" },
  { value: "dos_donts", label: "Do's and don'ts" },
  { value: "other", label: "Other" },
] as const;

interface PolicyRow {
  id: string;
  policyKey: string;
  version: number;
  category: string;
  title: string;
  body: string;
  effectiveFrom: string;
  acknowledgedAt: string | null;
}

interface SummaryRow {
  id: string;
  policyKey: string;
  version: number;
  category: string;
  title: string;
  acknowledged: number;
}

const categoryLabel = (value: string): string =>
  CATEGORIES.find((c) => c.value === value)?.label ?? value;
const today = (): string => new Date().toISOString().slice(0, 10);
const selectClass =
  "h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm";

function PublishForm({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({
    policyKey: "",
    category: "",
    title: "",
    body: "",
    effectiveFrom: today(),
  });
  const [error, setError] = useState<string | null>(null);
  const publish = useMutation({
    mutationFn: () => hrmsApi.post("/api/policies", form),
    onSuccess: () => {
      toast.success(
        "Policy published. Employees will be asked to acknowledge it.",
      );
      onDone();
    },
    onError: (err: unknown) =>
      setError(
        err instanceof Error ? err.message : "Could not publish the policy",
      ),
  });
  const complete =
    /^[a-z0-9_-]{2,60}$/.test(form.policyKey) &&
    form.category !== "" &&
    form.title.trim().length >= 3 &&
    form.body.trim().length >= 20;
  return (
    <form
      className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4"
      aria-label="Publish policy"
      onSubmit={(e) => {
        e.preventDefault();
        if (complete) publish.mutate();
      }}
    >
      <p className="text-xs text-slate-500">
        Publishing a key that already exists creates the next version and asks
        everyone to acknowledge it again.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="pol-title">Title</Label>
          <Input
            id="pol-title"
            maxLength={200}
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pol-key">Key (e.g. posh)</Label>
          <Input
            id="pol-key"
            maxLength={60}
            value={form.policyKey}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                policyKey: e.target.value.toLowerCase(),
              }))
            }
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pol-cat">Category</Label>
          <select
            id="pol-cat"
            className={selectClass}
            value={form.category}
            onChange={(e) =>
              setForm((f) => ({ ...f, category: e.target.value }))
            }
          >
            <option value="">Select...</option>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="pol-body">Policy text</Label>
        <Textarea
          id="pol-body"
          rows={8}
          maxLength={20000}
          value={form.body}
          onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
        />
      </div>
      <div className="space-y-1 sm:max-w-xs">
        <Label htmlFor="pol-date">Effective from</Label>
        <Input
          id="pol-date"
          type="date"
          value={form.effectiveFrom}
          onChange={(e) =>
            setForm((f) => ({ ...f, effectiveFrom: e.target.value }))
          }
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <Button type="submit" size="sm" disabled={!complete || publish.isPending}>
        Publish
      </Button>
    </form>
  );
}

/**
 * Company policies on the employee's own profile: read each active policy and acknowledge it once per version.
 * HR also sees how many employees have acknowledged and can publish a policy or a new version.
 */
export function PolicyAcknowledgementPanel() {
  const queryClient = useQueryClient();
  const isHr = useHasRole("hr", "hr_admin", "admin", "super_admin");
  const [publishing, setPublishing] = useState(false);
  const mine = useQuery({
    queryKey: ["company-policies", "mine"],
    queryFn: () =>
      hrmsApi.get<{ data: { canAcknowledge: boolean; policies: PolicyRow[] } }>(
        "/api/policies/mine",
      ),
    staleTime: 60_000,
  });
  const summary = useQuery({
    queryKey: ["company-policies", "summary"],
    enabled: isHr,
    queryFn: () =>
      hrmsApi.get<{
        data: { activeEmployees: number; policies: SummaryRow[] };
      }>("/api/policies/admin/summary"),
    staleTime: 60_000,
  });
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: ["company-policies"] });
  const acknowledge = useMutation({
    mutationFn: (id: string) =>
      hrmsApi.post(`/api/policies/${id}/acknowledge`, {}),
    onSuccess: () => {
      toast.success("Thank you - your acknowledgement is recorded.");
      refresh();
    },
    onError: (err: unknown) =>
      toast.error(
        err instanceof Error
          ? err.message
          : "Could not record the acknowledgement",
      ),
  });

  const data = mine.data?.data;
  const policies = data?.policies ?? [];
  const pending = policies.filter((p) => p.acknowledgedAt === null).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-800">
          Company policies{pending > 0 ? ` (${pending} to acknowledge)` : ""}
        </h3>
        {isHr && !publishing && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPublishing(true)}
          >
            Publish a policy
          </Button>
        )}
      </div>
      {isHr && publishing && (
        <PublishForm
          onDone={() => {
            setPublishing(false);
            refresh();
          }}
        />
      )}

      {isHr && summary.data?.data && summary.data.data.policies.length > 0 && (
        <div
          className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600"
          aria-label="Acknowledgement status"
        >
          <p className="mb-1 font-semibold text-slate-700">
            Acknowledged by ({summary.data.data.activeEmployees} active
            employees)
          </p>
          <ul className="space-y-0.5">
            {summary.data.data.policies.map((p) => (
              <li key={p.id}>
                {p.title} v{p.version}: {p.acknowledged} of{" "}
                {summary.data.data.activeEmployees}
              </li>
            ))}
          </ul>
        </div>
      )}

      {mine.isLoading && (
        <p className="text-sm text-slate-500">Loading policies...</p>
      )}
      {mine.error instanceof Error && (
        <p role="alert" className="text-sm text-red-600">
          Could not load policies. {mine.error.message}
        </p>
      )}
      {!mine.isLoading && policies.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          No policies have been published yet.
        </p>
      )}
      <div className="space-y-3">
        {policies.map((p) => (
          <details
            key={p.id}
            className="rounded-xl border border-slate-200 bg-white p-4"
            open={p.acknowledgedAt === null}
          >
            <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm font-semibold text-slate-800">
              {p.title}
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                {categoryLabel(p.category)}
              </span>
              <span className="text-xs font-normal text-slate-400">
                v{p.version} - effective {p.effectiveFrom}
              </span>
              {p.acknowledgedAt ? (
                <span className="ml-auto rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                  Acknowledged {p.acknowledgedAt.slice(0, 10)}
                </span>
              ) : (
                <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                  Needs your acknowledgement
                </span>
              )}
            </summary>
            <div className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
              {p.body}
            </div>
            {p.acknowledgedAt === null && data?.canAcknowledge && (
              <Button
                className="mt-3"
                size="sm"
                disabled={acknowledge.isPending}
                onClick={() => acknowledge.mutate(p.id)}
              >
                I have read and understood this policy
              </Button>
            )}
          </details>
        ))}
      </div>
    </div>
  );
}
