import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { hrmsApi } from "@/lib/hrmsApi";

/**
 * Which Head / Sub-head this vendor may be booked against (Requirement 2).
 *
 * Two things this deliberately does NOT do:
 *
 *   - free text. Heads and sub-heads come from the Finance expense master, so a typo cannot
 *     create a mapping that silently matches nothing forever. The server rejects unknown
 *     codes as well; this just stops it happening in the first place.
 *   - imply that an empty list blocks the vendor. A vendor with no mappings is UNRESTRICTED,
 *     and the empty state says so — the opposite reading would be alarming and wrong.
 */

const ALL_SUB_HEADS = "*";

type SubHead = { id: string; subHeadCode: string; subHeadName: string };
type Head = { id: string; headCode: string; headName: string; subHeads?: SubHead[] };
type Mapping = {
  id: string;
  head_code: string;
  head_name: string | null;
  sub_head_code: string;
  sub_head_name: string | null;
  active_status: number;
  created_by: string | null;
};

type Draft = { headCode: string; subHeadCode: string };

export function VendorExpenseMappingTab({
  vendorId,
  readOnly,
}: {
  vendorId: string;
  readOnly: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pendingHead, setPendingHead] = useState("");
  const [pendingSubHead, setPendingSubHead] = useState("");
  const [draft, setDraft] = useState<Draft[] | null>(null);

  const mastersQuery = useQuery({
    queryKey: ["finance-expense-masters"],
    queryFn: async () => {
      const r = await hrmsApi.get<any>("/api/finance/expense-masters");
      return ((r as any)?.data?.data ?? (r as any)?.data ?? []) as Head[];
    },
  });

  const mappingsQuery = useQuery({
    queryKey: ["vendor-expense-mappings", vendorId],
    queryFn: async () => {
      const r = await hrmsApi.get<any>(`/api/finance/vendors/${vendorId}/expense-mappings`);
      return ((r as any)?.data?.data ?? (r as any)?.data ?? []) as Mapping[];
    },
    enabled: Boolean(vendorId),
  });

  const heads: Head[] = Array.isArray(mastersQuery.data) ? mastersQuery.data : [];
  const saved: Mapping[] = Array.isArray(mappingsQuery.data) ? mappingsQuery.data : [];

  // The draft mirrors the saved rows until the user edits, so Cancel is just "drop the draft".
  const rows: Draft[] =
    draft ??
    saved
      .filter((m) => m.active_status === 1)
      .map((m) => ({ headCode: m.head_code, subHeadCode: m.sub_head_code }));

  const labelFor = useMemo(() => {
    const headByCode = new Map(heads.map((h) => [h.headCode, h]));
    return (row: Draft) => {
      const head = headByCode.get(row.headCode);
      const sub = head?.subHeads?.find((s) => s.subHeadCode === row.subHeadCode);
      return {
        head: head?.headName ?? row.headCode,
        sub: row.subHeadCode === ALL_SUB_HEADS ? "All sub-heads" : sub?.subHeadName ?? row.subHeadCode,
        // A row whose code no longer resolves is worth surfacing: it will never match anything.
        orphaned: !head || (row.subHeadCode !== ALL_SUB_HEADS && !sub),
      };
    };
  }, [heads]);

  const importedCount = saved.filter((m) => m.created_by === "LEGACY_IMPORT" && m.active_status === 1).length;
  const subHeadsForPending = heads.find((h) => h.headCode === pendingHead)?.subHeads ?? [];

  const saveMutation = useMutation({
    mutationFn: async () =>
      await hrmsApi.put<any>(`/api/finance/vendors/${vendorId}/expense-mappings`, {
        mappings: rows.map((r) => ({ headCode: r.headCode, subHeadCode: r.subHeadCode })),
      }),
    onSuccess: () => {
      toast({ title: "Expense mapping saved" });
      setDraft(null);
      queryClient.invalidateQueries({ queryKey: ["vendor-expense-mappings", vendorId] });
    },
    onError: (e: Error) =>
      toast({ title: "Could not save mapping", description: e.message, variant: "destructive" }),
  });

  const addRow = () => {
    if (!pendingHead) return;
    const subHeadCode = pendingSubHead || ALL_SUB_HEADS;
    if (rows.some((r) => r.headCode === pendingHead && r.subHeadCode === subHeadCode)) {
      toast({ title: "That combination is already mapped", variant: "destructive" });
      return;
    }
    setDraft([...rows, { headCode: pendingHead, subHeadCode }]);
    setPendingHead("");
    setPendingSubHead("");
  };

  const removeRow = (index: number) => setDraft(rows.filter((_, i) => i !== index));

  if (mappingsQuery.isLoading || mastersQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading expense mapping…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {rows.length === 0 ? (
          <>
            This vendor has <strong>no mapping</strong>, so every expense head with approved
            budget stays selectable for it. Add rows to restrict it.
          </>
        ) : (
          <>
            Only these Head / Sub-head combinations are selectable for this vendor — and only
            where the branch also has approved budget with balance remaining.
          </>
        )}
      </p>

      {importedCount > 0 && (
        <p className="text-xs text-muted-foreground">
          {importedCount} imported from I-Spark.
        </p>
      )}

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Head</TableHead>
              <TableHead className="text-xs">Sub-head</TableHead>
              {!readOnly && <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={readOnly ? 2 : 3} className="text-xs text-muted-foreground">
                  No mapping — unrestricted.
                </TableCell>
              </TableRow>
            )}
            {rows.map((row, index) => {
              const label = labelFor(row);
              return (
                <TableRow key={`${row.headCode}-${row.subHeadCode}`}>
                  <TableCell className="text-xs">
                    {label.head}
                    {label.orphaned && (
                      <Badge variant="destructive" className="ml-1.5 text-[10px]">
                        not in master
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">{label.sub}</TableCell>
                  {!readOnly && (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        aria-label={`Remove ${label.head} / ${label.sub}`}
                        onClick={() => removeRow(index)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {!readOnly && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Head</Label>
              <Select
                value={pendingHead}
                onValueChange={(v) => {
                  setPendingHead(v);
                  setPendingSubHead("");
                }}
              >
                <SelectTrigger className="mt-1 h-8 text-sm">
                  <SelectValue placeholder="Select head" />
                </SelectTrigger>
                <SelectContent>
                  {heads.map((h) => (
                    <SelectItem key={h.headCode} value={h.headCode} className="text-sm">
                      {h.headName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Sub-head</Label>
              <Select value={pendingSubHead} onValueChange={setPendingSubHead} disabled={!pendingHead}>
                <SelectTrigger className="mt-1 h-8 text-sm">
                  <SelectValue placeholder="All sub-heads" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_SUB_HEADS} className="text-sm">
                    All sub-heads
                  </SelectItem>
                  {subHeadsForPending.map((s) => (
                    <SelectItem key={s.subHeadCode} value={s.subHeadCode} className="text-sm">
                      {s.subHeadName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <Button variant="outline" size="sm" onClick={addRow} disabled={!pendingHead}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Add mapping
            </Button>
            <div className="flex items-center gap-2">
              {draft && (
                <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
                  Discard changes
                </Button>
              )}
              <Button size="sm" disabled={!draft || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
                {saveMutation.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                Save mapping
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
