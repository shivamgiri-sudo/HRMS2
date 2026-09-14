import { useCallback, useEffect, useRef, useState } from "react";
import { hrmsApi } from "@/lib/hrmsApi";

interface MentionSuggestion {
  id: string;
  full_name: string;
  employee_code: string;
  designation: string | null;
}

interface MentionTextareaProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  minRows?: number;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  disabled?: boolean;
}

export function MentionTextarea({
  value,
  onChange,
  placeholder,
  className,
  minRows = 2,
  onKeyDown,
  disabled,
}: MentionTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [suggestions, setSuggestions] = useState<MentionSuggestion[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuIdx, setMenuIdx] = useState(0);
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchSuggestions = useCallback(async (q: string) => {
    if (q.length < 1) { setSuggestions([]); return; }
    try {
      const res = await hrmsApi.get<{ success: boolean; data: MentionSuggestion[] }>(
        `/engagement/mention-search?q=${encodeURIComponent(q)}`,
      );
      setSuggestions(res.data ?? []);
    } catch {
      setSuggestions([]);
    }
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    const caret = e.target.selectionStart ?? val.length;
    onChange(val);

    // Detect @mention being typed
    const before = val.slice(0, caret);
    const match = before.match(/@([\w.]*)$/);
    if (match) {
      const start = caret - match[0].length;
      setMentionStart(start);
      const q = match[1];
      setQuery(q);
      setMenuIdx(0);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => void fetchSuggestions(q), 200);
      setMenuOpen(true);
    } else {
      setMenuOpen(false);
      setSuggestions([]);
      setMentionStart(null);
    }
  }

  function insertMention(person: MentionSuggestion) {
    if (mentionStart === null) return;
    const caret = textareaRef.current?.selectionStart ?? value.length;
    const before = value.slice(0, mentionStart);
    const after = value.slice(caret);
    const mention = `@${person.full_name.replace(/\s+/g, "_")} `;
    const newVal = before + mention + after;
    onChange(newVal);
    setMenuOpen(false);
    setSuggestions([]);
    setMentionStart(null);
    // Restore focus and move caret after inserted mention
    setTimeout(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        const pos = before.length + mention.length;
        ta.setSelectionRange(pos, pos);
      }
    }, 0);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (menuOpen && suggestions.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMenuIdx((i) => Math.min(i + 1, suggestions.length - 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setMenuIdx((i) => Math.max(i - 1, 0)); return; }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const s = suggestions[menuIdx];
        if (s) insertMention(s);
        return;
      }
      if (e.key === "Escape") { setMenuOpen(false); return; }
    }
    onKeyDown?.(e);
  }

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (textareaRef.current && !textareaRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="relative w-full">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        rows={minRows}
        className={className}
        style={{ resize: "none" }}
      />

      {menuOpen && suggestions.length > 0 && (
        <ul
          className="absolute left-0 z-50 mt-1 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
          style={{ top: "100%" }}
        >
          {suggestions.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); insertMention(s); }}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition ${
                  i === menuIdx ? "bg-[color:var(--brand-50)] text-[color:var(--brand-700)]" : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[color:var(--brand-100)] text-[10px] font-bold text-[color:var(--brand-700)]">
                  {s.full_name.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold">{s.full_name}</p>
                  <p className="text-[11px] text-slate-400">{s.employee_code}{s.designation ? ` · ${s.designation}` : ""}</p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
