import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { SubmissionList } from "@/hooks/useTeamRoster";
import { STATUS_META, formatDmy, formatDmyTime } from "./teamRosterFormat";

interface Props {
  data: SubmissionList | undefined;
  isLoading: boolean;
  isError: boolean;
  showSubmitter: boolean;
  emptyText: string;
  onOpen: (id: number) => void;
  onPage: (offset: number) => void;
}

/** Shared list for "My Submissions" and the Approvals queues. Every row opens the detail drawer. */
export default function SubmissionsTable({ data, isLoading, isError, showSubmitter, emptyText, onOpen, onPage }: Props) {
  if (isLoading) return <div className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" aria-label="Loading" /></div>;
  if (isError) return <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Could not load the list. Please refresh.</p>;
  const items = data?.items ?? [];
  if (items.length === 0) return <p className="rounded-xl border border-dashed p-8 text-center text-sm text-slate-500">{emptyText}</p>;
  const total = data?.total ?? 0;
  const offset = data?.offset ?? 0;
  const limit = data?.limit ?? 25;
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-xl border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Number</TableHead>
              {showSubmitter && <TableHead>Submitted by</TableHead>}
              <TableHead>Period</TableHead>
              <TableHead>Changes</TableHead>
              <TableHead>Warnings</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Submitted</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((s) => (
              <TableRow
                key={s.id}
                tabIndex={0}
                role="button"
                aria-label={`Open submission ${s.submissionNo ?? s.id}`}
                className="cursor-pointer hover:bg-slate-50"
                onClick={() => onOpen(s.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(s.id); } }}
              >
                <TableCell className="font-medium">{s.submissionNo ?? s.id}</TableCell>
                {showSubmitter && <TableCell>{s.submitter.name}{s.submitter.code ? ` (${s.submitter.code})` : ""}</TableCell>}
                <TableCell className="whitespace-nowrap">{formatDmy(s.from)} - {formatDmy(s.to)}</TableCell>
                <TableCell>{s.appliedCount > 0 ? `${s.appliedCount} of ${s.lineCount} applied` : s.lineCount}</TableCell>
                <TableCell>{s.warningCount > 0 ? <span className="font-semibold text-amber-700">{s.warningCount}</span> : "None"}</TableCell>
                <TableCell><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_META[s.status]?.className ?? ""}`}>{STATUS_META[s.status]?.label ?? s.status}</span></TableCell>
                <TableCell className="whitespace-nowrap">{formatDmyTime(s.submittedAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {total > limit && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>{offset + 1}-{Math.min(offset + limit, total)} of {total}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => onPage(Math.max(offset - limit, 0))}>Previous</Button>
            <Button variant="outline" size="sm" disabled={offset + limit >= total} onClick={() => onPage(offset + limit)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
