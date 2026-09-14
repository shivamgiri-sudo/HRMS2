import { Badge } from "@/components/ui/badge";
import type { CandidateDocument } from "./types";

export function DocumentMetadataPanel({ document }: { document: CandidateDocument }) {
  const size = document.file_size ? `${Math.round(document.file_size / 1024)} KB` : "Not captured";
  return (
    <div className="grid gap-3 border-l border-slate-200 bg-slate-50 p-4 text-sm md:w-72">
      <div>
        <div className="text-xs font-semibold uppercase text-slate-500">Document</div>
        <div className="mt-1 font-semibold text-slate-900">{document.document_name}</div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><div className="text-xs text-slate-500">Type</div><div className="font-medium">{document.document_type}</div></div>
        <div><div className="text-xs text-slate-500">Category</div><div className="font-medium">{document.document_category}</div></div>
        <div><div className="text-xs text-slate-500">Size</div><div className="font-medium">{size}</div></div>
        <div><div className="text-xs text-slate-500">Name match</div><div className="font-medium">{document.name_match_status}</div></div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge variant={document.verification_status === "verified" ? "default" : "outline"}>{document.verification_status}</Badge>
        {document.mandatory_flag && <Badge variant="outline">Mandatory</Badge>}
        {document.sensitive_flag && <Badge variant="outline">Sensitive</Badge>}
      </div>
    </div>
  );
}
