# AI Command Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ignored bottom-right chat bubble with a three-state AI Command Bar: ambient insight strip + `⌘K` command palette + inline page injection.

**Architecture:** 5 new files in `src/components/ai/`, modifications to `App.tsx`, `CompactDashboardLayout.tsx`, `TopBar.tsx`, and `src/components/ai/index.ts`. Uses `cmdk` v1.1.1 (already installed). Calls existing backend endpoints (`/api/ai/ask`, `/api/ai/role-insights`). Deletes `FloatingChatWidget.tsx`.

**Tech Stack:** React 18, TypeScript, cmdk v1.1.1, TanStack Query already present, Tailwind, shadcn/ui, Lucide icons, React Router v6.

## Global Constraints

- `cmdk` import: `import { Command } from "cmdk"` — package is `cmdk`, NOT `@cmdk-ui`
- All new components are named exports, not default exports (matches project convention)
- No new backend endpoints — use existing `/api/ai/ask` and `/api/ai/role-insights` only
- `FloatingChatWidget` must be deleted (not just unused) — it would conflict at root mount
- Ambient strip visible only on routes listed in `AMBIENT_ROUTES` constant — never on auth/form pages
- Strip height is 36px — `CompactDashboardLayout` must add `pb-9` to main content to prevent overlap
- `⌘K` / `Ctrl+K` global shortcut is exclusively owned by `AICommandBar` — remove the old handler from `CompactDashboardLayout.tsx`
- All AI calls must `.catch(() => null)` — never block UI if AI is unavailable
- TypeScript strict: no `any` in new files unless unavoidable from API response typing

---

## Task 1: Create `useAmbientInsights` hook

**Files:**
- Create: `src/hooks/useAmbientInsights.ts`

**Interfaces:**
- Produces: `export function useAmbientInsights(contextType: string): { chips: AmbientChip[]; loading: boolean; refresh: () => void }`
- Produces type: `export type AmbientChip = { label: string; severity: "critical" | "warning" | "info"; action_url?: string }`

- [ ] **Step 1: Write the file**

```typescript
import { useState, useEffect, useRef } from "react";
import { hrmsApi } from "@/lib/hrmsApi";

export type AmbientChip = {
  label: string;
  severity: "critical" | "warning" | "info";
  action_url?: string;
};

// Module-level cache: contextType -> { chips, expires_at }
const ambientCache = new Map<string, { chips: AmbientChip[]; expires_at: number }>();
const REFRESH_MS = 5 * 60 * 1000; // 5 minutes

export function useAmbientInsights(contextType: string): {
  chips: AmbientChip[];
  loading: boolean;
  refresh: () => void;
} {
  const [chips, setChips] = useState<AmbientChip[]>(() => {
    const cached = ambientCache.get(contextType);
    return cached && cached.expires_at > Date.now() ? cached.chips : [];
  });
  const [loading, setLoading] = useState(false);
  const tickRef = useRef(0);

  const doFetch = async (key: string, cancelled: { v: boolean }) => {
    const cached = ambientCache.get(key);
    if (cached && cached.expires_at > Date.now()) {
      if (!cancelled.v) setChips(cached.chips);
      return;
    }
    if (!cancelled.v) setLoading(true);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: { answer?: string; insights?: { label: string; severity?: string; action_url?: string }[] } }>(
        `/api/ai/role-insights?context_type=${encodeURIComponent(key)}`
      );
      if (cancelled.v) return;
      const raw = res?.data?.insights ?? [];
      const parsed: AmbientChip[] = raw.slice(0, 3).map((i) => ({
        label: i.label,
        severity: (["critical", "warning", "info"].includes(i.severity ?? "") ? i.severity : "info") as AmbientChip["severity"],
        action_url: i.action_url,
      }));
      ambientCache.set(key, { chips: parsed, expires_at: Date.now() + REFRESH_MS });
      setChips(parsed);
    } catch {
      // AI unavailable — keep existing chips, fail silently
    } finally {
      if (!cancelled.v) setLoading(false);
    }
  };

  useEffect(() => {
    if (!contextType) return;
    const cancelled = { v: false };
    void doFetch(contextType, cancelled);
    const interval = setInterval(() => void doFetch(contextType, cancelled), REFRESH_MS);
    return () => {
      cancelled.v = true;
      clearInterval(interval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextType, tickRef.current]);

  function refresh() {
    ambientCache.delete(contextType);
    setChips([]);
    tickRef.current += 1;
  }

  return { chips, loading, refresh };
}
```

- [ ] **Step 2: TypeScript check**

Run: `cd c:/Users/ADMIN/Desktop/HRMS2-latest && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useAmbientInsights.ts
git commit -m "feat(ai): add useAmbientInsights hook with 5-min module-level cache"
```

---

## Task 2: Create `AmbientStrip` component (State 1)

**Files:**
- Create: `src/components/ai/AmbientStrip.tsx`

**Interfaces:**
- Consumes: `useAmbientInsights(contextType)` from Task 1
- Produces: `export function AmbientStrip({ contextType, onOpen }: { contextType: string; onOpen: () => void }): JSX.Element`

The strip is a fixed 36px dark bar at the bottom of the viewport. It shows up to 3 severity chips and an "Ask anything ⌘K" trigger. Clicking anywhere opens the command palette via `onOpen`.

- [ ] **Step 1: Write the file**

```tsx
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAmbientInsights, type AmbientChip } from "@/hooks/useAmbientInsights";

const SEVERITY_DOT: Record<AmbientChip["severity"], string> = {
  critical: "bg-red-400 animate-pulse",
  warning:  "bg-amber-400",
  info:     "bg-slate-400",
};

const SEVERITY_TEXT: Record<AmbientChip["severity"], string> = {
  critical: "text-red-300",
  warning:  "text-amber-300",
  info:     "text-slate-300",
};

export function AmbientStrip({
  contextType,
  onOpen,
}: {
  contextType: string;
  onOpen: () => void;
}) {
  const { chips, loading } = useAmbientInsights(contextType);

  return (
    <div
      role="complementary"
      aria-label="AI Copilot insights"
      className="fixed bottom-0 left-0 right-0 z-40 flex h-9 items-center gap-3 bg-slate-900/95 px-4 backdrop-blur-sm select-none"
    >
      <Sparkles className="h-3.5 w-3.5 flex-shrink-0 text-brand-400 text-violet-400" />

      {loading && chips.length === 0 ? (
        <span className="text-xs text-slate-500">Loading insights…</span>
      ) : chips.length > 0 ? (
        <div className="flex items-center gap-3 flex-1 min-w-0 overflow-hidden">
          {chips.map((chip, i) => (
            <button
              key={i}
              type="button"
              onClick={onOpen}
              className="flex items-center gap-1.5 text-xs hover:opacity-80 transition-opacity flex-shrink-0"
            >
              <span className={cn("h-1.5 w-1.5 rounded-full flex-shrink-0", SEVERITY_DOT[chip.severity])} />
              <span className={cn(SEVERITY_TEXT[chip.severity])}>{chip.label}</span>
            </button>
          ))}
          {chips.length > 0 && <span className="text-slate-600 text-xs flex-shrink-0">·</span>}
        </div>
      ) : null}

      <button
        type="button"
        onClick={onOpen}
        className="ml-auto flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200 transition-colors flex-shrink-0"
      >
        Ask anything
        <kbd className="inline-flex h-5 items-center gap-0.5 rounded border border-slate-700 bg-slate-800 px-1.5 font-mono text-[10px] text-slate-400">
          ⌘K
        </kbd>
      </button>
    </div>
  );
}
```

- [ ] **Step 2: TypeScript check**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/components/ai/AmbientStrip.tsx
git commit -m "feat(ai): AmbientStrip — 36px dark bottom bar with contextual insight chips"
```

---

## Task 3: Create `CommandPalette` component (State 2)

**Files:**
- Create: `src/components/ai/CommandPalette.tsx`

**Interfaces:**
- Consumes: `navGroups` from `@/components/layout/navConfig` (type `NavGroup[]`)
- Consumes: `/api/ai/ask` POST endpoint
- Consumes: `/api/employees?search=&limit=8` GET endpoint
- Produces: `export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element`

Three input modes:
- No prefix → AI ask mode (calls `/api/ai/ask`, shows answer inline)
- `/` prefix → nav mode (filters `navGroups` items)
- `@` prefix → employee search mode (calls `/api/employees?search=`)

- [ ] **Step 1: Write the file**

```tsx
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Command } from "cmdk";
import {
  Sparkles, Search, Navigation, Users, Loader2,
  ArrowRight, AlertTriangle, CheckCircle2, Info,
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
    if (mode !== "employee" || query.length < 2) { setEmpResults([]); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setEmpLoading(true);
      try {
        const res = await hrmsApi.get<{ data: EmployeeResult[] }>(`/api/employees?search=${encodeURIComponent(query)}&limit=8`).catch(() => null);
        setEmpResults(res?.data ?? []);
      } finally {
        setEmpLoading(false);
      }
    }, 300);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, mode]);

  // AI ask on Enter (handled via form submit)
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
```

- [ ] **Step 2: TypeScript check**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/components/ai/CommandPalette.tsx
git commit -m "feat(ai): CommandPalette — cmdk-powered AI + nav + employee search overlay"
```

---

## Task 4: Create `AmbientInsightBar` component (State 3 — inline page injection)

**Files:**
- Create: `src/components/ai/AmbientInsightBar.tsx`

**Interfaces:**
- Consumes: `useAmbientInsights(contextType)` from Task 1
- Produces: `export function AmbientInsightBar({ contextType, onOpenPalette }: { contextType: string; onOpenPalette: () => void }): JSX.Element | null`

Renders a horizontal row of chips directly inside the page (above the page header). Returns `null` when no chips are available. Used on CEO/Operations/Quality/WFM dashboards.

- [ ] **Step 1: Write the file**

```tsx
import { Sparkles, AlertTriangle, Info, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAmbientInsights, type AmbientChip } from "@/hooks/useAmbientInsights";

const CHIP_CLASS: Record<AmbientChip["severity"], string> = {
  critical: "border-red-200 bg-red-50 text-red-700",
  warning:  "border-amber-200 bg-amber-50 text-amber-700",
  info:     "border-slate-200 bg-slate-50 text-slate-600",
};

const ChipIcon = ({ severity }: { severity: AmbientChip["severity"] }) => {
  if (severity === "critical") return <AlertTriangle className="h-3 w-3 flex-shrink-0" />;
  if (severity === "warning")  return <AlertTriangle className="h-3 w-3 flex-shrink-0" />;
  return <Info className="h-3 w-3 flex-shrink-0" />;
};

export function AmbientInsightBar({
  contextType,
  onOpenPalette,
}: {
  contextType: string;
  onOpenPalette: () => void;
}) {
  const { chips, loading } = useAmbientInsights(contextType);

  if (!loading && chips.length === 0) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="flex items-center gap-1 text-xs text-violet-600 font-semibold flex-shrink-0">
        <Sparkles className="h-3 w-3" />
        AI
      </span>
      {loading && chips.length === 0 ? (
        <span className="text-xs text-slate-400">Loading insights…</span>
      ) : (
        chips.map((chip, i) => (
          <button
            key={i}
            type="button"
            onClick={chip.action_url ? () => { window.location.href = chip.action_url!; } : onOpenPalette}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition hover:opacity-80",
              CHIP_CLASS[chip.severity]
            )}
          >
            <ChipIcon severity={chip.severity} />
            {chip.label}
          </button>
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 2: TypeScript check**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/components/ai/AmbientInsightBar.tsx
git commit -m "feat(ai): AmbientInsightBar — inline page-level insight chip row for dashboards"
```

---

## Task 5: Create `AICommandBar` root orchestrator

**Files:**
- Create: `src/components/ai/AICommandBar.tsx`

**Interfaces:**
- Consumes: `AmbientStrip` from Task 2
- Consumes: `CommandPalette` from Task 3
- Produces: `export function AICommandBar(): JSX.Element | null`

This is the root component mounted in `App.tsx`. It:
1. Listens globally for `⌘K` / `Ctrl+K` to toggle the palette
2. Determines current route context type
3. Decides whether to show the ambient strip (based on `AMBIENT_ROUTES`)
4. Renders `<AmbientStrip>` + `<CommandPalette>` together

- [ ] **Step 1: Write the file**

```tsx
import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { AmbientStrip } from "./AmbientStrip";
import { CommandPalette } from "./CommandPalette";

// Routes where the ambient strip is shown
const AMBIENT_ROUTES = [
  "/dashboard",
  "/my-dashboard",
  "/ceo/dashboard",
  "/operations/dashboard",
  "/operations-dashboard",
  "/quality/dashboard",
  "/quality-dashboard",
  "/wfm/dashboard",
  "/wfm-attendance",
  "/hr/dashboard",
  "/manager/dashboard",
  "/recruiter-dashboard",
  "/payroll-hr/dashboard",
  "/call-master",
  "/attendance",
  "/reports",
  "/work-inbox",
];

// Routes where neither strip nor palette should appear
const HIDDEN_ROUTES = [
  "/auth",
  "/login",
  "/register",
  "/peopleos/copilot",
  "/candidate-form",
  "/interview-registration",
  "/onboard",
  "/display/",
  "/break-desk",
  "/candidate-portal",
  "/portal/",
];

const ROUTE_CONTEXT: Record<string, string> = {
  "/dashboard":             "generic",
  "/my-dashboard":          "employee_self",
  "/ceo/dashboard":         "executive_dashboard",
  "/operations/dashboard":  "operations",
  "/operations-dashboard":  "operations",
  "/quality/dashboard":     "quality_operations",
  "/quality-dashboard":     "quality_operations",
  "/wfm/dashboard":         "wfm_roster",
  "/wfm-attendance":        "wfm_roster",
  "/hr/dashboard":          "hr_operations",
  "/manager/dashboard":     "manager_team",
  "/recruiter-dashboard":   "ats_recruiter",
  "/payroll-hr/dashboard":  "payroll_readiness",
  "/call-master":           "operations",
  "/attendance":            "wfm_roster",
};

function getContextType(pathname: string): string {
  // Exact match first
  if (ROUTE_CONTEXT[pathname]) return ROUTE_CONTEXT[pathname];
  // Prefix match
  for (const [route, ctx] of Object.entries(ROUTE_CONTEXT)) {
    if (pathname.startsWith(route + "/")) return ctx;
  }
  return "generic";
}

export function AICommandBar() {
  const { user } = useAuth();
  const location = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);

  const pathname = location.pathname;
  const isHidden = !user || HIDDEN_ROUTES.some((r) => pathname.startsWith(r));
  const showStrip = !isHidden && AMBIENT_ROUTES.some((r) => pathname === r || pathname.startsWith(r + "/"));
  const contextType = getContextType(pathname);

  // Global ⌘K / Ctrl+K handler
  useEffect(() => {
    if (isHidden) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        e.stopPropagation();
        setPaletteOpen((prev) => !prev);
      }
      if (e.key === "Escape" && paletteOpen) {
        setPaletteOpen(false);
      }
    };
    document.addEventListener("keydown", handler, true); // capture phase — overrides old handler
    return () => document.removeEventListener("keydown", handler, true);
  }, [isHidden, paletteOpen]);

  if (isHidden) return null;

  return (
    <>
      {showStrip && (
        <AmbientStrip
          contextType={contextType}
          onOpen={() => setPaletteOpen(true)}
        />
      )}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
      />
    </>
  );
}
```

- [ ] **Step 2: TypeScript check**

Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/components/ai/AICommandBar.tsx
git commit -m "feat(ai): AICommandBar orchestrator — global ⌘K handler, ambient strip, palette"
```

---

## Task 6: Wire up — replace FloatingChatWidget, update layout, update exports

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/layout/CompactDashboardLayout.tsx`
- Modify: `src/components/layout/TopBar.tsx`
- Modify: `src/components/ai/index.ts`
- Delete: `src/components/ai/FloatingChatWidget.tsx`

**Interfaces:**
- Consumes: `AICommandBar` from Task 5
- `FloatingChatWidget` export removed from `index.ts`

- [ ] **Step 1: Update `src/App.tsx`**

Change import (line 6):
```diff
-import { FloatingChatWidget } from "@/components/ai/FloatingChatWidget";
+import { AICommandBar } from "@/components/ai/AICommandBar";
```

Change mount (line 53):
```diff
-<FloatingChatWidget />
+<AICommandBar />
```

- [ ] **Step 2: Update `src/components/layout/CompactDashboardLayout.tsx`**

Remove the `⌘K` `useEffect` block (lines ~140–152). It currently does:
```ts
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      const input = document.querySelector<HTMLInputElement>('input[aria-label="Search modules"]');
      input?.focus();
    }
  };
  document.addEventListener("keydown", handler);
  return () => document.removeEventListener("keydown", handler);
}, []);
```
Delete the entire block. `AICommandBar` registers a capture-phase handler that takes precedence, so this is now dead code.

Also add `pb-9` to the main content wrapper so the ambient strip doesn't overlap content. Find the `<main>` or primary content div and add `pb-9` to its className.

- [ ] **Step 3: Update `src/components/layout/TopBar.tsx`**

Remove the static `⌘K` hint `<span>` from inside the search input wrapper:
```diff
-<span
-  className="cmd-key-hint pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2"
-  aria-hidden
->
-  ⌘K
-</span>
```
The hint now lives in the ambient strip and palette footer.

- [ ] **Step 4: Update `src/components/ai/index.ts`**

```typescript
export { AIInsightPanel } from "./AIInsightPanel";
export { AICommandBar } from "./AICommandBar";
export { AmbientStrip } from "./AmbientStrip";
export { CommandPalette } from "./CommandPalette";
export { AmbientInsightBar } from "./AmbientInsightBar";
// FloatingChatWidget removed — replaced by AICommandBar
```

- [ ] **Step 5: Delete FloatingChatWidget.tsx**

```bash
rm src/components/ai/FloatingChatWidget.tsx
```

- [ ] **Step 6: TypeScript check**

Run: `npx tsc --noEmit`
Expected: 0 errors. If any errors reference `FloatingChatWidget`, grep for remaining imports and remove them.

```bash
grep -r "FloatingChatWidget" src/
```
Expected: 0 matches.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(ai): wire AICommandBar — replace FloatingChatWidget, update layout padding, remove old ⌘K handler"
```

---

## Task 7: Final verification + push

- [ ] **Step 1: Full TypeScript check**

```bash
cd c:/Users/ADMIN/Desktop/HRMS2-latest
npx tsc --noEmit
```
Expected: 0 errors

```bash
cd backend
npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 2: Verify FloatingChatWidget is fully removed**

```bash
grep -r "FloatingChatWidget" src/
```
Expected: 0 matches

- [ ] **Step 3: Verify cmdk import resolves**

```bash
node -e "require('./node_modules/cmdk/dist/index.js'); console.log('cmdk OK')"
```
Expected: `cmdk OK`

- [ ] **Step 4: Push to trigger auto-deploy**

```bash
git push origin main
```

Expected: GitHub Actions deploys to https://mcnhrms.teammas.in within ~5 minutes.

---

## Summary of All Files Changed

| Action | File |
|--------|------|
| Create | `src/hooks/useAmbientInsights.ts` |
| Create | `src/components/ai/AmbientStrip.tsx` |
| Create | `src/components/ai/CommandPalette.tsx` |
| Create | `src/components/ai/AmbientInsightBar.tsx` |
| Create | `src/components/ai/AICommandBar.tsx` |
| Modify | `src/App.tsx` |
| Modify | `src/components/layout/CompactDashboardLayout.tsx` |
| Modify | `src/components/layout/TopBar.tsx` |
| Modify | `src/components/ai/index.ts` |
| Delete | `src/components/ai/FloatingChatWidget.tsx` |
