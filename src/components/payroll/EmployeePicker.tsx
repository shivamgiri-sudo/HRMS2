import { useState, useEffect, useRef } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Input } from "@/components/ui/input";
import { Search, User } from "lucide-react";

/**
 * Employee search box shared by the Salary Change tab and the Increment tab of the Salary Change Center:
 * type a name or employee code, pick the match. Replaces the "all active employees" dropdown the increment
 * page used to load.
 */

export interface EmployeeSearchResult {
  id: string;
  employee_code: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
}
interface EmployeeSearchApiResponse {
  employees?: EmployeeSearchResult[];
  data?: EmployeeSearchResult[];
}

interface SuccessData {
  employeeName: string;
  employeeCode: string;
  oldCtc: number;
  newCtc: number;
  effectiveDate: string;
  requestedBy: string;
}

export function displayName(e: EmployeeSearchResult) {
  return e.full_name ?? `${e.first_name ?? ""} ${e.last_name ?? ""}`.trim();
}

// ── Reusable debounced employee search combobox ──────────────────────────────

export function EmployeePicker({
  placeholder,
  value,
  onSelect,
}: {
  placeholder: string;
  value: EmployeeSearchResult | null;
  onSelect: (e: EmployeeSearchResult | null) => void;
}) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<EmployeeSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!search.trim() || value) {
      setResults([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await hrmsApi.get<
          EmployeeSearchApiResponse | EmployeeSearchResult[]
        >(
          `/api/employees?search=${encodeURIComponent(search.trim())}&limit=10`,
        );
        const list = Array.isArray(data)
          ? data
          : (data.employees ?? data.data ?? []);
        setResults(list);
        setOpen(list.length > 0);
      } catch {
        setResults([]);
        setOpen(false);
      }
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search, value]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
        <User className="h-4 w-4 text-slate-400 flex-shrink-0" />
        <span className="text-sm font-medium text-slate-800 flex-1 truncate">
          {displayName(value)}{" "}
          <span className="text-slate-400 font-normal">
            ({value.employee_code})
          </span>
        </span>
        <button
          type="button"
          onClick={() => {
            onSelect(null);
            setSearch("");
          }}
          className="text-xs text-slate-400 hover:text-red-500 cursor-pointer transition-colors"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
      <Input
        placeholder={placeholder}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="pl-9 h-10 text-sm rounded-xl"
      />
      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-xl border border-slate-200 bg-white shadow-lg max-h-56 overflow-y-auto">
          {results.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => {
                onSelect(r);
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2.5 text-sm hover:bg-slate-50 cursor-pointer flex items-center justify-between border-b border-slate-50 last:border-0"
            >
              <span className="font-medium text-slate-800">
                {displayName(r)}
              </span>
              <span className="font-mono text-[11px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                {r.employee_code}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

