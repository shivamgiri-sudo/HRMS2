import { useState } from 'react';
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { useQuery, useMutation } from '@tanstack/react-query';
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { hrmsApi } from '@/lib/hrmsApi';
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { Textarea } from '@/components/ui/textarea';
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { FilePen, CheckCircle, ChevronRight, Search, Copy } from 'lucide-react';
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Employee {
  id: string;
  employee_code: string;
  first_name: string;
  last_name: string;
  designation_name?: string;
  date_of_joining?: string;
}

interface LetterTemplate {
  id: string;
  template_code: string;
  template_name: string;
  letter_type: string;
}

interface GeneratedLetter {
  id: string;
  letter_type: string;
  template_name: string;
  issued_date: string | null;
  acknowledged_at: string | null;
  created_at: string;
}

interface GenerateResult {
  id: string;
  letter_type: string;
  generated_text: string;
}

// ── Step indicator ────────────────────────────────────────────────────────────

const STEPS = ['Employee', 'Template', 'Variables', 'Generate'];

function StepBar({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-1 mb-6">
      {STEPS.map((label, i) => (
        <div key={label} className="flex items-center gap-1">
          <div className={cn(
            'flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-colors',
            i < current ? 'bg-green-500 text-white' :
            i === current ? 'bg-blue-600 text-white' :
            'bg-slate-200 text-slate-500'
          )}>
            {i < current ? <CheckCircle className="h-4 w-4" /> : i + 1}
          </div>
          <span className={cn(
            'text-xs font-medium hidden sm:inline',
            i === current ? 'text-blue-700' : 'text-slate-500'
          )}>{label}</span>
          {i < STEPS.length - 1 && <ChevronRight className="h-3 w-3 text-slate-300" />}
        </div>
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function NativeOfferLetterGeneration() {
  const { toast } = useToast();

  // Generate Letter state
  const [step, setStep] = useState(0);
  const [empSearch, setEmpSearch] = useState('');
  const [selectedEmp, setSelectedEmp] = useState<Employee | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<LetterTemplate | null>(null);
  const [overrideVars, setOverrideVars] = useState<Record<string, string>>({
    ctc_annual: '',
    effective_date: '',
    reporting_manager: '',
  });
  const [generateResult, setGenerateResult] = useState<GenerateResult | null>(null);

  // Generated Letters tab state
  const [listEmpId, setListEmpId] = useState('');
  const [fetchEmpId, setFetchEmpId] = useState('');

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: empSearchData, isFetching: empFetching } = useQuery({
    queryKey: ['employees-search', empSearch],
    queryFn: () => hrmsApi.get<{ data: Employee[] }>(`/api/employees?search=${encodeURIComponent(empSearch)}&limit=10`),
    enabled: empSearch.trim().length >= 2,
    staleTime: 30_000,
  });

  const { data: templatesData } = useQuery({
    queryKey: ['letter-templates'],
    queryFn: () => hrmsApi.get<{ data: LetterTemplate[] }>('/api/letters/templates'),
    staleTime: 60_000,
  });

  const { data: lettersData, isFetching: lettersFetching, refetch: refetchLetters } = useQuery({
    queryKey: ['generated-letters', fetchEmpId],
    queryFn: () => hrmsApi.get<{ data: GeneratedLetter[] }>(`/api/letters/employee/${fetchEmpId}`),
    enabled: fetchEmpId.trim().length > 0,
    staleTime: 30_000,
  });

  // ── Mutations ─────────────────────────────────────────────────────────────────

  const generateMut = useMutation({
    mutationFn: () => hrmsApi.post<{ data: GenerateResult }>('/api/letters/generate', {
      employee_id: selectedEmp!.id,
      template_code: selectedTemplate!.template_code,
      override_vars: Object.fromEntries(
        Object.entries(overrideVars).filter(([, v]) => v.trim() !== '')
      ),
    }),
    onSuccess: (res) => {
      setGenerateResult(res.data);
      setStep(4); // success state
      toast({ title: 'Letter generated', description: `ID: ${res.data.id}` });
    },
    onError: (err: Error) => {
      toast({ title: 'Generation failed', description: err.message, variant: 'destructive' });
    },
  });

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const employees = empSearchData?.data ?? [];
  const templates = templatesData?.data ?? [];
  const letters = lettersData?.data ?? [];

  function resetGenerate() {
    setStep(0);
    setEmpSearch('');
    setSelectedEmp(null);
    setSelectedTemplate(null);
    setOverrideVars({ ctc_annual: '', effective_date: '', reporting_manager: '' });
    setGenerateResult(null);
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <DashboardLayout>
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white shadow">
            <FilePen className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Offer Letter Generation</h1>
            <p className="text-sm text-slate-500">Generate, send and track HR letters for employees</p>
          </div>
        </div>

        <Tabs defaultValue="generate">
          <TabsList>
            <TabsTrigger value="generate">Generate Letter</TabsTrigger>
            <TabsTrigger value="list">Generated Letters</TabsTrigger>
          </TabsList>

          {/* ── Tab 1: Generate ─────────────────────────────────────────────── */}
          <TabsContent value="generate" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {step < 4 ? 'New Letter' : 'Letter Generated Successfully'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {step < 4 && <StepBar current={step} />}

                {/* Success screen */}
                {step === 4 && generateResult && (
                  <div className="space-y-4">
                    <div className="rounded-xl border border-green-200 bg-green-50 p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <CheckCircle className="h-5 w-5 text-green-600" />
                        <span className="font-semibold text-green-800">Letter generated</span>
                      </div>
                      <p className="text-sm text-green-700">Letter ID: <span className="font-mono font-bold">{generateResult.id}</span></p>
                      <p className="text-sm text-green-700">Type: <Badge variant="outline">{generateResult.letter_type}</Badge></p>
                    </div>
                    <div>
                      <Label className="text-xs text-slate-500 mb-1 block">Generated text preview</Label>
                      <Textarea
                        readOnly
                        className="font-mono text-xs h-48 resize-none bg-slate-50"
                        value={generateResult.generated_text}
                      />
                    </div>
                    <Button onClick={resetGenerate} variant="outline">Generate Another</Button>
                  </div>
                )}

                {/* Step 0: Employee Selection */}
                {step === 0 && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Search Employee (name or code)</Label>
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <Input
                          className="pl-9"
                          placeholder="Type at least 2 characters..."
                          value={empSearch}
                          onChange={(e) => setEmpSearch(e.target.value)}
                        />
                      </div>
                      {empFetching && <p className="text-xs text-slate-400">Searching...</p>}
                    </div>

                    {employees.length > 0 && (
                      <div className="rounded-xl border divide-y">
                        {employees.map((emp) => (
                          <button
                            key={emp.id}
                            type="button"
                            onClick={() => { setSelectedEmp(emp); setEmpSearch(''); }}
                            className={cn(
                              'w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors',
                              selectedEmp?.id === emp.id && 'bg-blue-50'
                            )}
                          >
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700 text-xs font-bold">
                              {emp.first_name?.[0]}{emp.last_name?.[0]}
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-slate-800">{emp.first_name} {emp.last_name}</p>
                              <p className="text-xs text-slate-500">{emp.employee_code}{emp.designation_name ? ` · ${emp.designation_name}` : ''}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}

                    {selectedEmp && (
                      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 flex items-center justify-between">
                        <div>
                          <p className="font-semibold text-blue-900">{selectedEmp.first_name} {selectedEmp.last_name}</p>
                          <p className="text-xs text-blue-600">{selectedEmp.employee_code}{selectedEmp.designation_name ? ` · ${selectedEmp.designation_name}` : ''}</p>
                          {selectedEmp.date_of_joining && (
                            <p className="text-xs text-blue-500">Joined: {selectedEmp.date_of_joining}</p>
                          )}
                        </div>
                        <Button onClick={() => setStep(1)} disabled={!selectedEmp}>
                          Next: Template
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {/* Step 1: Template Selection */}
                {step === 1 && (
                  <div className="space-y-4">
                    <p className="text-sm text-slate-600">
                      Employee: <span className="font-semibold">{selectedEmp?.first_name} {selectedEmp?.last_name}</span>
                    </p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {templates.map((tpl) => (
                        <button
                          key={tpl.id}
                          type="button"
                          onClick={() => setSelectedTemplate(tpl)}
                          className={cn(
                            'rounded-xl border p-4 text-left transition-all hover:shadow-md',
                            selectedTemplate?.id === tpl.id
                              ? 'border-blue-500 bg-blue-50 shadow-blue-100 shadow-md'
                              : 'border-slate-200 hover:border-slate-300'
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="font-semibold text-slate-800 text-sm leading-tight">{tpl.template_name}</p>
                            {selectedTemplate?.id === tpl.id && (
                              <CheckCircle className="h-4 w-4 shrink-0 text-blue-600" />
                            )}
                          </div>
                          <p className="mt-1 font-mono text-xs text-slate-500">{tpl.template_code}</p>
                          <Badge variant="secondary" className="mt-2 text-xs">{tpl.letter_type}</Badge>
                        </button>
                      ))}
                      {templates.length === 0 && (
                        <p className="text-sm text-slate-400 col-span-3">No active templates found.</p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => setStep(0)}>Back</Button>
                      <Button onClick={() => setStep(2)} disabled={!selectedTemplate}>Next: Variables</Button>
                    </div>
                  </div>
                )}

                {/* Step 2: Override Variables */}
                {step === 2 && (
                  <div className="space-y-4">
                    <p className="text-sm text-slate-600">
                      Template: <span className="font-semibold">{selectedTemplate?.template_name}</span>
                    </p>
                    <p className="text-xs text-slate-500">
                      Override template variables. Leave blank to use defaults from employee record.
                    </p>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label>CTC Annual (override)</Label>
                        <Input
                          placeholder="e.g. 480000"
                          value={overrideVars.ctc_annual}
                          onChange={(e) => setOverrideVars(v => ({ ...v, ctc_annual: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>Effective / Start Date (override)</Label>
                        <Input
                          type="date"
                          value={overrideVars.effective_date}
                          onChange={(e) => setOverrideVars(v => ({ ...v, effective_date: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-1 sm:col-span-2">
                        <Label>Reporting Manager (override)</Label>
                        <Input
                          placeholder="e.g. Ravi Kumar"
                          value={overrideVars.reporting_manager}
                          onChange={(e) => setOverrideVars(v => ({ ...v, reporting_manager: e.target.value }))}
                        />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs text-slate-500">All overrides as JSON</Label>
                      <Textarea
                        readOnly
                        className="mt-1 font-mono text-xs h-24 resize-none bg-slate-50"
                        value={JSON.stringify(
                          Object.fromEntries(Object.entries(overrideVars).filter(([, v]) => v.trim() !== '')),
                          null, 2
                        )}
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
                      <Button onClick={() => setStep(3)}>Next: Review &amp; Generate</Button>
                    </div>
                  </div>
                )}

                {/* Step 3: Review + Generate */}
                {step === 3 && (
                  <div className="space-y-4">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                      <p className="text-sm"><span className="font-semibold w-32 inline-block text-slate-600">Employee:</span> {selectedEmp?.first_name} {selectedEmp?.last_name} ({selectedEmp?.employee_code})</p>
                      <p className="text-sm"><span className="font-semibold w-32 inline-block text-slate-600">Template:</span> {selectedTemplate?.template_name}</p>
                      <p className="text-sm"><span className="font-semibold w-32 inline-block text-slate-600">Letter Type:</span> <Badge variant="secondary">{selectedTemplate?.letter_type}</Badge></p>
                      {Object.entries(overrideVars).filter(([, v]) => v.trim()).map(([k, v]) => (
                        <p key={k} className="text-sm">
                          <span className="font-semibold w-32 inline-block text-slate-600 capitalize">{k.replace(/_/g, ' ')}:</span> {v}
                        </p>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => setStep(2)}>Back</Button>
                      <Button
                        onClick={() => generateMut.mutate()}
                        disabled={generateMut.isPending}
                        className="bg-blue-600 hover:bg-blue-700"
                      >
                        {generateMut.isPending ? 'Generating...' : 'Generate Letter'}
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Tab 2: Generated Letters ──────────────────────────────────────── */}
          <TabsContent value="list" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Letters by Employee</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <Input
                    placeholder="Paste employee UUID..."
                    value={listEmpId}
                    onChange={(e) => setListEmpId(e.target.value)}
                    className="max-w-sm"
                  />
                  <Button
                    onClick={() => { setFetchEmpId(listEmpId.trim()); refetchLetters(); }}
                    disabled={listEmpId.trim().length === 0}
                  >
                    Load
                  </Button>
                </div>

                {lettersFetching && <p className="text-sm text-slate-400">Loading...</p>}

                {letters.length > 0 && (
                  <div className="rounded-xl border overflow-hidden">
                    <Table className="smarthr-table">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Template</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Generated At</TableHead>
                          <TableHead>Acknowledged</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {letters.map((letter) => (
                          <TableRow key={letter.id} className="hover:bg-gray-50 transition-colors">
                            <TableCell className="font-medium text-sm">{letter.template_name}</TableCell>
                            <TableCell><Badge variant="secondary">{letter.letter_type}</Badge></TableCell>
                            <TableCell className="text-sm text-slate-500">
                              {formatISTDate(letter.created_at)}
                            </TableCell>
                            <TableCell>
                              {letter.acknowledged_at ? (
                                <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
                                  <CheckCircle className="h-3 w-3 mr-1" />
                                  {formatISTDate(letter.acknowledged_at)}
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-slate-400">Pending</Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  navigator.clipboard.writeText(letter.id);
                                  toast({ title: 'Copied', description: 'Letter ID copied to clipboard' });
                                }}
                              >
                                <Copy className="h-3.5 w-3.5 mr-1" />
                                Copy ID
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {fetchEmpId && !lettersFetching && letters.length === 0 && (
                  <p className="text-sm text-slate-400">No letters found for this employee.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
