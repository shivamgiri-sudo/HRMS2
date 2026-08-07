import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { hrmsApi } from "@/lib/hrmsApi";

/**
 * Where this vendor may be used: legal entity and branch.
 *
 * THREE SEPARATE CONCEPTS. Identity is the other tabs. This tab holds the other two, and holds
 * them apart — two independent lists, saved independently. They are not one combined picker,
 * and they are certainly not a comma-separated field.
 *
 * The legacy system merged identity with branch by duplicating the whole vendor row per
 * branch: 1,829 rows for 1,552 real vendors, with one supplier existing six times across five
 * branches, each copy carrying its own PAN and GSTIN. Every UI decision here exists to keep
 * that from happening again.
 *
 * EMPTY MEANS EVERYWHERE, and the tab says so in words. The opposite reading — "no boxes
 * ticked, so this vendor is blocked" — is alarming and wrong, and all 1,821 existing vendors
 * are in exactly that state.
 *
 * Ship-To is an OVERRIDE, shown only for branches that are ticked. Left blank, the branch's own
 * address is used. Pre-filling it with the branch address would look helpful and would
 * guarantee the copy goes stale the first time a branch moves.
 */

type Company = { company_code: string; company_name: string };
type Branch = { id: string; branch_name: string };

type BranchRow = {
  branch_id: string;
  branch_name?: string | null;
  ship_to_name?: string | null;
  ship_to_address1?: string | null;
  ship_to_city?: string | null;
  ship_to_pincode?: string | null;
};

type Applicability = { companies: { company_code: string }[]; branches: BranchRow[] };

function unwrap<T>(response: unknown): T {
  const body = (response as any)?.data ?? response;
  return (body?.data ?? body) as T;
}

export function VendorApplicabilityTab({
  vendorId,
  readOnly,
}: {
  vendorId: string;
  readOnly?: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const applicabilityQuery = useQuery({
    queryKey: ["vendor-applicability", vendorId],
    queryFn: async () =>
      unwrap<Applicability>(await hrmsApi.get<any>(`/api/finance/vendors/${vendorId}/applicability`)),
  });

  const companiesQuery = useQuery({
    queryKey: ["finance-companies"],
    queryFn: async () => {
      const rows = unwrap<Company[]>(await hrmsApi.get<any>("/api/finance/companies"));
      return Array.isArray(rows) ? rows : [];
    },
  });

  const branchesQuery = useQuery({
    queryKey: ["vendor-applicability-branches"],
    queryFn: async () => {
      const rows = unwrap<Branch[]>(await hrmsApi.get<any>("/api/org/branches?limit=200"));
      return Array.isArray(rows) ? rows : [];
    },
  });

  const [companyCodes, setCompanyCodes] = useState<string[]>([]);
  const [branches, setBranches] = useState<Record<string, BranchRow>>({});

  // Seeded from the server once loaded. Kept as local state because the two lists are saved
  // together and a half-edited selection must not be written back on every tick.
  useEffect(() => {
    const data = applicabilityQuery.data;
    if (!data) return;
    setCompanyCodes((data.companies ?? []).map((c) => c.company_code));
    setBranches(
      Object.fromEntries((data.branches ?? []).map((b) => [b.branch_id, b])),
    );
  }, [applicabilityQuery.data]);

  const allCompanies = companiesQuery.data ?? [];
  const allBranches = branchesQuery.data ?? [];
  const selectedBranchIds = useMemo(() => Object.keys(branches), [branches]);

  const save = useMutation({
    mutationFn: async () =>
      hrmsApi.put<any>(`/api/finance/vendors/${vendorId}/applicability`, {
        companyCodes,
        branches: selectedBranchIds.map((id) => ({
          branchId: id,
          ship_to_name: branches[id]?.ship_to_name ?? null,
          ship_to_address1: branches[id]?.ship_to_address1 ?? null,
          ship_to_city: branches[id]?.ship_to_city ?? null,
          ship_to_pincode: branches[id]?.ship_to_pincode ?? null,
        })),
      }),
    onSuccess: () => {
      toast({ title: "Applicability saved" });
      queryClient.invalidateQueries({ queryKey: ["vendor-applicability", vendorId] });
    },
    onError: (e: Error) =>
      toast({ title: "Could not save", description: e.message, variant: "destructive" }),
  });

  const toggleBranch = (branch: Branch, on: boolean) => {
    setBranches((current) => {
      const next = { ...current };
      if (on) next[branch.id] = { branch_id: branch.id, branch_name: branch.branch_name };
      else delete next[branch.id];
      return next;
    });
  };

  const setShipTo = (branchId: string, field: keyof BranchRow, value: string) =>
    setBranches((current) => ({
      ...current,
      [branchId]: { ...current[branchId], [field]: value },
    }));

  if (applicabilityQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-10 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section>
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold">Legal entity</Label>
          {companyCodes.length === 0 && (
            <Badge variant="outline" className="text-[10px]">Every company</Badge>
          )}
        </div>
        <p className="mt-1 text-[11px] text-slate-500">
          Which of our companies may transact with this vendor. Leave all unticked to allow every
          company — that is how every vendor stands today.
        </p>
        <div className="mt-2 space-y-2">
          {allCompanies.map((company) => (
            <label key={company.company_code} className="flex items-center gap-2 text-xs">
              <Checkbox
                disabled={readOnly}
                checked={companyCodes.includes(company.company_code)}
                onCheckedChange={(checked) =>
                  setCompanyCodes((current) =>
                    checked
                      ? [...new Set([...current, company.company_code])]
                      : current.filter((code) => code !== company.company_code),
                  )
                }
              />
              <span className="font-medium">{company.company_name}</span>
              <span className="font-mono text-[10px] text-slate-400">{company.company_code}</span>
            </label>
          ))}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold">Branch</Label>
          {selectedBranchIds.length === 0 && (
            <Badge variant="outline" className="text-[10px]">Every branch</Badge>
          )}
        </div>
        <p className="mt-1 text-[11px] text-slate-500">
          Which branches may raise a GRN against this vendor. Separate from the legal entity
          above — restricting one does not restrict the other.
        </p>
        <div className="mt-2 space-y-2">
          {allBranches.map((branch) => {
            const on = Boolean(branches[branch.id]);
            return (
              <div key={branch.id} className="rounded-lg border border-slate-200 p-2">
                <label className="flex items-center gap-2 text-xs">
                  <Checkbox
                    disabled={readOnly}
                    checked={on}
                    onCheckedChange={(checked) => toggleBranch(branch, Boolean(checked))}
                  />
                  <span className="font-medium">{branch.branch_name}</span>
                </label>

                {on && (
                  <div className="mt-2 space-y-1 pl-6">
                    <p className="flex items-center gap-1 text-[10.5px] text-slate-500">
                      <MapPin className="h-3 w-3" />
                      Ship-To override — leave blank to use this branch's own address.
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        className="h-7 text-xs"
                        placeholder="Ship-to name"
                        disabled={readOnly}
                        value={branches[branch.id]?.ship_to_name ?? ""}
                        onChange={(e) => setShipTo(branch.id, "ship_to_name", e.target.value)}
                      />
                      <Input
                        className="h-7 text-xs"
                        placeholder="Address"
                        disabled={readOnly}
                        value={branches[branch.id]?.ship_to_address1 ?? ""}
                        onChange={(e) => setShipTo(branch.id, "ship_to_address1", e.target.value)}
                      />
                      <Input
                        className="h-7 text-xs"
                        placeholder="City"
                        disabled={readOnly}
                        value={branches[branch.id]?.ship_to_city ?? ""}
                        onChange={(e) => setShipTo(branch.id, "ship_to_city", e.target.value)}
                      />
                      <Input
                        className="h-7 text-xs"
                        placeholder="PIN"
                        disabled={readOnly}
                        value={branches[branch.id]?.ship_to_pincode ?? ""}
                        onChange={(e) => setShipTo(branch.id, "ship_to_pincode", e.target.value)}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {!readOnly && (
        <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
          Save applicability
        </Button>
      )}
    </div>
  );
}
