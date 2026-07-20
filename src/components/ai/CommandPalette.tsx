import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Command } from "cmdk";
import {
  Sparkles, Navigation, Users, Loader2,
  ArrowRight, AlertTriangle, CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { hrmsApi } from "@/lib/hrmsApi";
import { navGroups } from "@/components/layout/navConfig";

type Mode = "ai" | "nav" | "employee";
type AISeverity = "critical" | "high" | "medium" | "low";

interface AIResponse {
  answer: string;
  insights?: Array<{ key: string; label: string; severity?: AISeverity; count?: number }>;
  actions?: Array<{ key: string; label: string; url: string }>;
}

interface EmployeeResult {
  id: string;
  employee_code: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  branch_name?: string;
  designation_name?: string;
}

const SEVERITY_CLASS: Record<AISeverity, string> = {
  critical: "border-red-300 bg-red-50 text-red-700",
  high:     "border-amber-300 bg-amber-50 text-amber-700",
  medium:   "border-blue-300 bg-blue-50 text-blue-700",
  low:      "border-slate-300 bg-slate-50 text-slate-600",
};

function getMode(value: string): Mode {
  if (value.startsWith("/")) return "nav";
  if (value.startsWith("@")) return "employee";
  return "ai";
}

// Flatten all nav items with their labels and hrefs
function flatNavItems() {
  return navGroups.flatMap((g) =>
    g.items.flatMap((item) => {
      const base = [{ label: item.label, href: item.href, group: g.title, description: item.description }];
      const children = (item.children ?? []).map((c) => ({
        label: c.label, href: c.href, group: item.label, description: c.description,
      }));
      return [...base, ...children];
    })
  );
}

const ALL_NAV = flatNavItems();

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<AIResponse | null>(null);
  const [empResults, setEmpResults] = useState<EmployeeResult[]>([]);
  const [empLoading, setEmpLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mode: Mode = getMode(value);
  const query = value.startsWith("/") || value.startsWith("@") ? value.slice(1) : value;

  // Reset state when closing
  useEffect(() => {
    if (!open) {
      setValue("");
      setAiResult(null);
      setEmpResults([]);
      setAiLoading(false);
      setEmpLoading(false);
    }
  }, [open]);

  // Nav filter
  const navResults = mode === "nav"
    ? ALL_NAV.filter((item) =>
        item.label.toLowerCase().includes(query.toLowerCase()) ||
        (item.description ?? "").toLowerCase().includes(query.toLowerCase())
      ).slice(0, 8)
    : [];

  // Employee search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (mode !== "employee" || query.length < 2) { setEmpResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setEmpLoading(true);
      try {
        const res = await hrmsApi.get<{ data: EmployeeResult[] }>(`/api/employees?search=${encodeURIComponent(query)}&limit=8`).catch(() => null);
        setEmpResults(res?.data ?? []);
      } finally {
        setEmpLoading(false);
      }
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, mode]);

  // AI ask
  const askAI = async () => {
    if (!query.trim() || aiLoading) return;
    setAiLoading(true);
    setAiResult(null);
    try {
      const res = await hrmsApi.post<{ success: boolean; data: AIResponse }>("/api/ai/ask", {
        question: query,
        context_type: "generic",
      }).catch(() => null);
      setAiResult(res?.data ?? { answer: "Unable to get a response. Try the full chat →" });
    } finally {
      setAiLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "Enter" && mode === "ai" && query.trim()) {
      e.preventDefault();
      void askAI();
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]"
      role="dialog"
      aria-modal="true"
      aria-label="AI Command Palette"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-[640px] mx-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl animate-in slide-in-from-top-4 duration-150">
        <Command shouldFilter={false} onKeyDown={handleKeyDown}>
          {/* Header */}
          <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
            <Sparkles className="h-4 w-4 text-violet-500 flex-shrink-0" />
            <Command.Input
              value={value}
              onValueChange={setValue}
              placeholder="Ask anything… or type / to navigate, @ to find an employee"
              className="flex-1 bg-transparent text-sm text-slate-900 placeholder:text-slate-400 outline-none"
              autoFocus
            />
            {(aiLoading || empLoading) && <Loader2 className="h-4 w-4 animate-spin text-slate-400 flex-shrink-0" />}
          </div>

          <Command.List className="max-h-[400px] overflow-y-auto">

            {/* AI mode: empty state suggestions */}
            {mode === "ai" && !query && !aiResult && (
              <Command.Group heading="Suggested for you">
                {[
                  "What are my top risks today?",
                  "Which employees need attention?",
                  "Show me pending actions",
                  "Who hasn't clocked in yet?",
                ].map((prompt) => (
                  <Command.Item
                    key={prompt}
                    onSelect={() => { setValue(prompt); }}
                    className="flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 aria-selected:bg-slate-50"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-violet-400 flex-shrink-0" />
                    {prompt}
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {/* AI mode: result */}
            {mode === "ai" && aiResult && (
              <div className="px-4 py-3 space-y-3">
                <p className="text-sm text-slate-800 leading-relaxed">{aiResult.answer}</p>
                {(aiResult.insights ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {(aiResult.insights ?? []).slice(0, 3).map((ins) => (
                      <span key={ins.key} className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs", SEVERITY_CLASS[ins.severity ?? "low"])}>
                        {(ins.severity === "critical" || ins.severity === "high") ? <AlertTriangle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
                        {ins.label}{ins.count !== undefined ? ` (${ins.count})` : ""}
                      </span>
                    ))}
                  </div>
                )}
                {(aiResult.actions ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {(aiResult.actions ?? []).slice(0, 2).map((action) => (
                      <a key={action.key} href={action.url} onClick={onClose}
                        className="inline-flex items-center gap-1 rounded-lg bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700 hover:bg-violet-100 transition">
                        {action.label} <ArrowRight className="h-3 w-3" />
                      </a>
                    ))}
                  </div>
                )}
                <div className="flex justify-end pt-1 border-t border-slate-100">
                  <a href="/peopleos/copilot" onClick={onClose}
                    className="text-xs text-violet-600 hover:underline flex items-center gap-1">
                    Open full conversation <ArrowRight className="h-3 w-3" />
                  </a>
                </div>
              </div>
            )}

            {/* AI mode: loading */}
            {mode === "ai" && aiLoading && (
              <div className="flex items-center gap-3 px-4 py-4 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                Thinking…
              </div>
            )}

            {/* Nav mode */}
            {mode === "nav" && navResults.length > 0 && (
              <Command.Group heading="Navigate">
                {navResults.map((item) => (
                  <Command.Item
                    key={item.href}
                    onSelect={() => { navigate(item.href); onClose(); }}
                    className="flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm hover:bg-slate-50 aria-selected:bg-slate-50"
                  >
                    <Navigation className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-slate-800">{item.label}</span>
                      {item.group && <span className="ml-2 text-xs text-slate-400">{item.group}</span>}
                    </div>
                    <code className="text-[10px] text-slate-400 font-mono flex-shrink-0">{item.href}</code>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {mode === "nav" && query && navResults.length === 0 && (
              <Command.Empty className="px-4 py-6 text-sm text-center text-slate-400">No pages matching "{query}"</Command.Empty>
            )}

            {/* Employee mode */}
            {mode === "employee" && empResults.length > 0 && (
              <Command.Group heading="Employees">
                {empResults.map((emp) => {
                  const name = emp.full_name ?? `${emp.first_name ?? ""} ${emp.last_name ?? ""}`.trim() || emp.employee_code;
                  return (
                    <Command.Item
                      key={emp.id}
                      onSelect={() => { navigate(`/employees/${emp.id}`); onClose(); }}
                      className="flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm hover:bg-slate-50 aria-selected:bg-slate-50"
                    >
                      <Users className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-slate-800">{name}</span>
                        <span className="ml-2 text-xs text-slate-400">{emp.employee_code}</span>
                      </div>
                      {emp.branch_name && <span className="text-xs text-slate-400 flex-shrink-0">{emp.branch_name}</span>}
                    </Command.Item>
                  );
                })}
              </Command.Group>
            )}

            {mode === "employee" && query.length >= 2 && !empLoading && empResults.length === 0 && (
              <Command.Empty className="px-4 py-6 text-sm text-center text-slate-400">No employees found for "{query}"</Command.Empty>
            )}

            {mode === "employee" && query.length < 2 && (
              <div className="px-4 py-4 text-xs text-slate-400 text-center">Type at least 2 characters to search employees</div>
            )}

          </Command.List>

          {/* Footer */}
          <div className="flex items-center gap-4 border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
            <span><kbd className="font-mono">↵</kbd> {mode === "ai" ? "ask AI" : "select"}</span>
            <span><kbd className="font-mono">/</kbd> navigate</span>
            <span><kbd className="font-mono">@</kbd> find employee</span>
            <span className="ml-auto"><kbd className="font-mono">Esc</kbd> close</span>
          </div>
        </Command>
      </div>
    </div>
  );
}
