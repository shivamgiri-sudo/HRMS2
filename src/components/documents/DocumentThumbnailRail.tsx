import { FileText } from "lucide-react";
import type { CandidateDocument } from "./types";

type Props = {
  documents: CandidateDocument[];
  selectedId?: string;
  onSelect: (document: CandidateDocument) => void;
};

export function DocumentThumbnailRail({ documents, selectedId, onSelect }: Props) {
  return (
    <div className="flex gap-2 overflow-x-auto border-t border-slate-200 bg-slate-50 p-3">
      {documents.map((document) => (
        <button
          key={document.id}
          type="button"
          onClick={() => onSelect(document)}
          className={`flex min-w-44 items-center gap-2 rounded border px-3 py-2 text-left text-xs ${selectedId === document.id ? "border-slate-900 bg-white" : "border-slate-200 bg-white hover:border-slate-400"}`}
        >
          <FileText className="h-4 w-4 shrink-0 text-slate-500" />
          <span className="truncate font-medium text-slate-700">{document.document_name}</span>
        </button>
      ))}
    </div>
  );
}
