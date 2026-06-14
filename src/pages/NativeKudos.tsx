import { type FormEvent, useEffect, useState } from "react";
import { Heart, Send, Check, ChevronsUpDown } from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { KudosCard } from "@/components/engagement/KudosCard";
import type { ApiResponse, Kudos, KudosTemplate } from "@/components/engagement/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { hrmsApi } from "@/lib/hrmsApi";
import { useQuery } from "@tanstack/react-query";

interface KudosLimit {
  given: number;
  limit: number;
  remaining: number;
}

interface EmployeeOption {
  id: string;
  name: string;
  employee_code: string;
}

export default function NativeKudos() {
  const [kudos, setKudos] = useState<Kudos[]>([]);
  const [templates, setTemplates] = useState<KudosTemplate[]>([]);
  const [limit, setLimit] = useState<KudosLimit>({ given: 0, limit: 10, remaining: 10 });
  const [receiverId, setReceiverId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [message, setMessage] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [employeeSearchOpen, setEmployeeSearchOpen] = useState(false);

  // Fetch employees for search
  const { data: employees = [] } = useQuery<EmployeeOption[]>({
    queryKey: ["employees-for-kudos"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: any[] }>("/api/employees?limit=500");
      return (res.data ?? []).map((emp: any) => ({
        id: emp.id,
        name: `${emp.first_name} ${emp.last_name}`,
        employee_code: emp.employee_code,
      }));
    },
  });

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

  const submit = async (event: FormEvent) => {
    event.preventDefault();
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
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Recipient Employee</label>
                  <Popover open={employeeSearchOpen} onOpenChange={setEmployeeSearchOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={employeeSearchOpen}
                        className="w-full justify-between"
                      >
                        {receiverId
                          ? employees.find((emp) => emp.id === receiverId)?.name || "Select employee..."
                          : "Search by name or employee code..."}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-full p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search employee..." />
                        <CommandList>
                          <CommandEmpty>No employee found.</CommandEmpty>
                          <CommandGroup>
                            {employees.map((emp) => (
                              <CommandItem
                                key={emp.id}
                                value={`${emp.name} ${emp.employee_code}`}
                                onSelect={() => {
                                  setReceiverId(emp.id);
                                  setEmployeeSearchOpen(false);
                                }}
                              >
                                <Check
                                  className={cn(
                                    "mr-2 h-4 w-4",
                                    receiverId === emp.id ? "opacity-100" : "opacity-0"
                                  )}
                                />
                                <div className="flex flex-col">
                                  <span className="font-medium">{emp.name}</span>
                                  <span className="text-xs text-muted-foreground">{emp.employee_code}</span>
                                </div>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
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
