import { type FormEvent, useEffect, useRef, useState } from "react";
import { Heart, Search, Send, X } from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { KudosCard } from "@/components/engagement/KudosCard";
import type { ApiResponse, Kudos, KudosTemplate } from "@/components/engagement/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { hrmsApi } from "@/lib/hrmsApi";

interface EmployeeSearchResult {
  id: string;
  employee_code: string;
  first_name: string;
  last_name: string | null;
  full_name?: string;
}

interface KudosLimit {
  given: number;
  limit: number;
  remaining: number;
}

export default function NativeKudos() {
  const [kudos, setKudos] = useState<Kudos[]>([]);
  const [templates, setTemplates] = useState<KudosTemplate[]>([]);
  const [limit, setLimit] = useState<KudosLimit>({ given: 0, limit: 10, remaining: 10 });
  const [receiverId, setReceiverId] = useState("");
  const [receiverName, setReceiverName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<EmployeeSearchResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const [templateId, setTemplateId] = useState("");
  const [message, setMessage] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    const [wallResponse, templatesResponse, limitResponse] = await Promise.all([
      hrmsApi.get<ApiResponse<Kudos[]>>("/api/engagement/kudos/wall?limit=40"),
      hrmsApi.get<ApiResponse<KudosTemplate[]>>("/api/engagement/kudos/templates"),
      hrmsApi.get<ApiResponse<KudosLimit>>("/api/engagement/kudos/limit/me"),
    ]);
    setKudos(wallResponse.data);
    setTemplates(templatesResponse.data);
    setLimit(limitResponse.data);
  };

  useEffect(() => {
    load().catch((requestError: Error) => setError(requestError.message));
  }, []);

  // Search employees when query changes
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.length < 2) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await hrmsApi.get<{ success: boolean; data: EmployeeSearchResult[] }>(
          `/api/employees/options/search?q=${encodeURIComponent(searchQuery)}&limit=10`
        );
        setSearchResults(res.data ?? []);
        setShowDropdown(true);
      } catch {
        setSearchResults([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Close dropdown on outside click
  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const selectEmployee = (emp: EmployeeSearchResult) => {
    setReceiverId(emp.id);
    const name = emp.full_name || `${emp.first_name} ${emp.last_name ?? ""}`.trim();
    setReceiverName(`${name} (${emp.employee_code})`);
    setSearchQuery("");
    setSearchResults([]);
    setShowDropdown(false);
  };

  const clearReceiver = () => {
    setReceiverId("");
    setReceiverName("");
    setSearchQuery("");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!receiverId) {
      toast.error("Please select a recipient");
      return;
    }
    if (!message && !templateId) {
      toast.error("Please enter a message or select a template");
      return;
    }
    setSending(true);
    try {
      await hrmsApi.post("/api/engagement/kudos", {
        receiverId,
        templateId: templateId || undefined,
        message: message || undefined,
        isAnonymous: anonymous,
      });
      setReceiverId("");
      setTemplateId("");
      setMessage("");
      setAnonymous(false);
      await load();
      toast.success("Kudos sent");
    } catch (requestError) {
      toast.error(requestError instanceof Error ? requestError.message : "Unable to send kudos");
    } finally {
      setSending(false);
    }
  };

  return (
    <DashboardLayout>
      <main className="space-y-6 p-6 lg:p-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Kudos Wall</h1>
          <p className="mt-1 text-slate-500">Make good work visible with a quick note of appreciation.</p>
        </div>
        {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Heart className="h-5 w-5 text-rose-600" /> Give kudos</CardTitle>
              <p className="text-sm text-slate-500">{limit.remaining} of {limit.limit} notes remaining this month</p>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={submit}>
                <div ref={searchRef} className="relative">
                  <label className="mb-1 block text-sm font-medium text-slate-700">Recipient</label>
                  {receiverId ? (
                    <div className="flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm">
                      <span className="flex-1 truncate">{receiverName}</span>
                      <button type="button" onClick={clearReceiver} className="text-slate-400 hover:text-slate-700">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <Input
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="Search by name or employee code"
                          className="pl-9"
                          autoComplete="off"
                        />
                      </div>
                      {showDropdown && searchResults.length > 0 && (
                        <div className="absolute z-50 mt-1 w-full rounded-md border bg-white shadow-lg">
                          {searchResults.map((emp) => {
                            const name = emp.full_name || `${emp.first_name} ${emp.last_name ?? ""}`.trim();
                            return (
                              <button
                                key={emp.id}
                                type="button"
                                className="w-full px-4 py-2.5 text-left text-sm hover:bg-slate-50 first:rounded-t-md last:rounded-b-md"
                                onClick={() => selectEmployee(emp)}
                              >
                                <span className="font-medium">{name}</span>
                                <span className="ml-2 text-slate-500">{emp.employee_code}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                  <input type="hidden" name="receiverId" value={receiverId} required />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Recognition</label>
                  <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
                    <option value="">General appreciation</option>
                    {templates.map((template) => <option key={template.kudos_template_id} value={template.kudos_template_id}>{template.kudos_title} (+{template.points_value})</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Message</label>
                  <Textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="What did they do well?" rows={4} />
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input type="checkbox" checked={anonymous} onChange={(event) => setAnonymous(event.target.checked)} />
                  Send anonymously
                </label>
                <Button className="w-full gap-2" disabled={sending || limit.remaining === 0}><Send className="h-4 w-4" />{sending ? "Sending..." : "Send kudos"}</Button>
              </form>
            </CardContent>
          </Card>

          <div className="grid gap-3 md:grid-cols-2">
            {kudos.map((item) => <KudosCard key={item.kudos_id} kudos={item} />)}
            {kudos.length === 0 && <p className="text-sm text-slate-500">The kudos wall is ready for its first note.</p>}
          </div>
        </div>
      </main>
    </DashboardLayout>
  );
}
