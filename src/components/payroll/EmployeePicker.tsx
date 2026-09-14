import { useState, useEffect, useRef } from 'react';
import { hrmsApi } from '@/lib/hrmsApi';
import { Input } from '@/components/ui/input';
import { Search, User } from 'lucide-react';

/**
 * Debounced employee search combobox.
 *
 * Extracted from SalaryChangeCenter.tsx, where it was page-local, when a second Payroll Head
 * screen needed the same control. Behaviour is unchanged: 350ms debounce, /api/employees search,
 * collapses to a chip with a Change button once an employee is chosen.
 *
 * A combobox rather than a Select on purpose. The form-input rule requires a dropdown for closed
 * sets; the employee list is neither closed nor small (1,100+ active), so it takes the rule's
 * combobox carve-out — the user picks from real suggestions and cannot type a free-text name.
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

export function employeeDisplayName(e: EmployeeSearchResult): string {
  return e.full_name ?? `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim();
}

export function EmployeePicker({
  placeholder,
  value,
  onSelect,
  disabled = false,
}: {
  placeholder: string;
  value: EmployeeSearchResult | null;
  onSelect: (e: EmployeeSearchResult | null) => void;
  disabled?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<EmployeeSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!search.trim() || value) { setResults([]); setOpen(false); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await hrmsApi.get<EmployeeSearchApiResponse | EmployeeSearchResult[]>(
          `/api/employees?search=${encodeURIComponent(search.trim())}&limit=10`
        );
        const list = Array.isArray(data) ? data : (data.employees ?? data.data ?? []);
        setResults(list);
        setOpen(list.length > 0);
      } catch { setResults([]); setOpen(false); }
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search, value]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
        <User className="h-4 w-4 text-slate-400 flex-shrink-0" />
        <span className="text-sm font-medium text-slate-800 flex-1 truncate">
          {employeeDisplayName(value)} ({value.employee_code})
        </span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => { onSelect(null); setSearch(''); }}
          className="text-xs text-slate-500 hover:text-slate-800 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-slate-400 rounded px-1"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative">
      <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
      <Input
        placeholder={placeholder}
        value={search}
        disabled={disabled}
        onChange={(e) => setSearch(e.target.value)}
        className="pl-8 h-9 text-sm rounded-xl"
      />
      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-xl border border-slate-200 bg-white shadow-lg max-h-56 overflow-y-auto">
          {results.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => { onSelect(r); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 cursor-pointer transition-colors flex items-center justify-between focus:outline-none focus:bg-slate-100"
            >
              <span className="font-medium text-slate-800">{employeeDisplayName(r)}</span>
              <span className="font-mono text-[11px] text-slate-500">{r.employee_code}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
