import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  FileText,
  Plus,
  Upload,
  Columns3,
  Pencil,
  X,
  Loader2,
  FileSearch,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { HrmsModernShell } from "@/components/ui/hrms-modern";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { hrmsApi } from "@/lib/hrmsApi";

interface Template {
  id: string;
  document_code: string;
  document_name: string;
  document_category: string;
  template_version: string;
  template_storage_path: string | null;
  template_mime_type: string | null;
  fill_mode: string | null;
  requires_candidate_esign: boolean;
  requires_hr_upload: boolean;
  requires_hr_verification: boolean;
  is_mandatory: boolean;
  active_status: boolean;
  field_count?: number;
  created_at: string;
  updated_at: string;
}

interface FieldMap {
  id?: string;
  field_key: string;
  mapping_mode: "placeholder" | "acroform" | "pdf_coordinate_overlay" | "pdf_box_grid";
  placeholder_token?: string;
  pdf_field_name?: string;
  source_path: string;
  transform_rule?: string;
  checked_when?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  page_no?: number;
  max_length?: number;
  is_mandatory?: boolean;
  schema_field_tooltip?: string | null;
  schema_suggested_path?: string | null;
  mapping_confirmed?: boolean | number | null;
}

const CATEGORIES = [
  { value: "appointment", label: "Appointment" },
  { value: "nda", label: "NDA" },
  { value: "epf", label: "EPF" },
  { value: "statutory", label: "Statutory" },
  { value: "other", label: "Other" },
];

const FILL_MODES = [
  { value: "placeholder", label: "Placeholder" },
  { value: "acroform", label: "AcroForm" },
  { value: "fillable_pdf", label: "Fillable PDF" },
  { value: "pdf_overlay", label: "PDF Overlay" },
  { value: "pdf_box_grid", label: "PDF Box Grid" },
];

const SOURCE_PATHS = [
  {
    group: "Employee",
    options: [
      "employee.full_name",
      "employee.employee_code",
      "employee.designation",
      "employee.date_of_joining",
      "employee.department_name",
      "employee.branch_name",
      "employee.process_name",
      "employee.ctc",
      "employee.basic_salary",
    ],
  },
  {
    group: "Personal",
    options: [
      "employee.father_name",
      "employee.mother_name",
      "employee.gender",
      "employee.date_of_birth",
      "employee.marital_status",
      "employee.nationality",
      "employee.qualification",
      "employee.permanent_address",
      "employee.present_address",
    ],
  },
  {
    group: "Statutory",
    options: [
      "statutory.pan_number",
      "statutory.aadhaar_number",
      "statutory.bank_account_number",
      "statutory.ifsc_code",
      "statutory.uan",
      "statutory.esic_number",
    ],
  },
  {
    group: "EPF",
    options: [
      "epf.date_of_birth",
      "epf.father_name",
      "epf.gender",
      "epf.marital_status",
      "epf.nationality",
      "epf.member_of_epf_before",
      "epf.member_of_eps_before",
    ],
  },
  {
    group: "System",
    options: [
      "system.current_date",
      "system.company_name",
      "system.company_address",
    ],
  },
];

const TRANSFORM_RULES = [
  { value: "", label: "(none)" },
  { value: "uppercase", label: "uppercase" },
  { value: "date_day", label: "date_day" },
  { value: "date_month", label: "date_month" },
  { value: "date_year", label: "date_year" },
  { value: "date_year_1", label: "date_year_1" },
  { value: "date_year_2", label: "date_year_2" },
  { value: "date_year_3", label: "date_year_3" },
  { value: "date_year_4", label: "date_year_4" },
  { value: "date_ddmmyyyy", label: "date_ddmmyyyy (comb 8-char)" },
  { value: "digits_only", label: "digits_only" },
  { value: "aadhaar_last4", label: "aadhaar_last4" },
  { value: "slice_0_25", label: "slice_0_25" },
  { value: "slice_25_50", label: "slice_25_50" },
  { value: "slice_50_75", label: "slice_50_75" },
  { value: "slice_0_14", label: "slice_0_14" },
  { value: "slice_14_28", label: "slice_14_28" },
  { value: "slice_28_42", label: "slice_28_42" },
];

const MAPPING_MODES: FieldMap["mapping_mode"][] = [
  "placeholder",
  "acroform",
  "pdf_coordinate_overlay",
  "pdf_box_grid",
];

const emptyTemplate = (): Partial<Template> => ({
  document_code: "",
  document_name: "",
  document_category: "appointment",
  template_version: "1.0",
  fill_mode: "placeholder",
  requires_candidate_esign: false,
  requires_hr_upload: false,
  requires_hr_verification: false,
  is_mandatory: false,
  active_status: true,
});

export default function JoiningDocumentTemplateAdmin() {
  const queryClient = useQueryClient();

  const [editOpen, setEditOpen] = useState(false);
  const [editData, setEditData] = useState<Partial<Template>>(emptyTemplate());
  const [isNew, setIsNew] = useState(true);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadTemplateId, setUploadTemplateId] = useState<string>("");
  const [uploadFillMode, setUploadFillMode] = useState("placeholder");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const schemaInputRef = useRef<HTMLInputElement>(null);

  const [fieldSheetOpen, setFieldSheetOpen] = useState(false);
  const [fieldTemplate, setFieldTemplate] = useState<Template | null>(null);
  const [fieldMaps, setFieldMaps] = useState<FieldMap[]>([]);

  const { data: templates, isLoading } = useQuery<Template[]>({
    queryKey: ["document-templates"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: Template[] }>(
        "/api/hr/document-templates"
      );
      return res.data;
    },
  });

  const upsertMutation = useMutation({
    mutationFn: (body: Partial<Template>) =>
      hrmsApi.put("/api/hr/document-templates", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document-templates"] });
      setEditOpen(false);
      toast.success(isNew ? "Template created" : "Template updated");
    },
    onError: (err: Error) => toast.error(err.message || "Save failed"),
  });

  const uploadMutation = useMutation({
    mutationFn: (formData: FormData) =>
      hrmsApi.postForm(`/api/hr/document-templates/${uploadTemplateId}/upload`, formData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document-templates"] });
      setUploadOpen(false);
      toast.success("File uploaded successfully");
    },
    onError: (err: Error) => toast.error(err.message || "Upload failed"),
  });

  const fieldMapQuery = useQuery<FieldMap[]>({
    queryKey: ["field-map", fieldTemplate?.id, fieldTemplate?.document_code],
    queryFn: async () => {
      if (!fieldTemplate) return [];
      const res = await hrmsApi.get<{ success: boolean; data: FieldMap[] }>(
        `/api/hr/document-templates/${fieldTemplate.id}/field-map?documentCode=${fieldTemplate.document_code}`
      );
      return res.data;
    },
    enabled: !!fieldTemplate,
  });

  const saveFieldMapMutation = useMutation({
    mutationFn: () =>
      hrmsApi.put(`/api/hr/document-templates/${fieldTemplate!.id}/field-map`, {
        document_code: fieldTemplate!.document_code,
        maps: fieldMaps,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document-templates"] });
      queryClient.invalidateQueries({ queryKey: ["field-map"] });
      toast.success("Field mappings saved");
    },
    onError: (err: Error) => toast.error(err.message || "Save failed"),
  });

  const handleOpenEdit = (template?: Template) => {
    if (template) {
      setEditData({ ...template });
      setIsNew(false);
    } else {
      setEditData(emptyTemplate());
      setIsNew(true);
    }
    setEditOpen(true);
  };

  const handleSaveTemplate = () => {
    if (!editData.document_code || !editData.document_name) {
      toast.error("Document code and name are required");
      return;
    }
    upsertMutation.mutate(editData);
  };

  const handleOpenUpload = (template: Template) => {
    setUploadTemplateId(template.id);
    setUploadFillMode(template.fill_mode || "placeholder");
    setUploadOpen(true);
  };

  const handleUploadSubmit = () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      toast.error("Please select a template file");
      return;
    }
    const schemaFile = schemaInputRef.current?.files?.[0];
    const formData = new FormData();
    formData.append("template", file);
    formData.append("fill_mode", uploadFillMode);
    if (schemaFile) formData.append("schema", schemaFile);
    uploadMutation.mutate(formData);
  };

  const handleOpenFieldMap = (template: Template) => {
    setFieldTemplate(template);
    setFieldSheetOpen(true);
  };

  const handleFieldMapLoaded = () => {
    if (fieldMapQuery.data) {
      setFieldMaps([...fieldMapQuery.data]);
    }
  };

  if (fieldMapQuery.data && fieldSheetOpen && fieldMaps.length === 0 && fieldMapQuery.data.length > 0) {
    handleFieldMapLoaded();
  }

  const addFieldRow = () => {
    setFieldMaps((prev) => [
      ...prev,
      {
        field_key: "",
        mapping_mode: "placeholder",
        source_path: "",
        is_mandatory: false,
      },
    ]);
  };

  const removeFieldRow = (idx: number) => {
    setFieldMaps((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateFieldRow = (idx: number, updates: Partial<FieldMap>) => {
    setFieldMaps((prev) =>
      prev.map((f, i) => (i === idx ? { ...f, ...updates } : f))
    );
  };

  const fillModeBadgeColor = (mode: string | null) => {
    switch (mode) {
      case "placeholder":
        return "bg-blue-50 text-blue-700 border-blue-200";
      case "acroform":
        return "bg-purple-50 text-purple-700 border-purple-200";
      case "fillable_pdf":
        return "bg-indigo-50 text-indigo-700 border-indigo-200";
      case "pdf_overlay":
        return "bg-amber-50 text-amber-700 border-amber-200";
      case "pdf_box_grid":
        return "bg-teal-50 text-teal-700 border-teal-200";
      default:
        return "bg-slate-50 text-slate-600 border-slate-200";
    }
  };

  return (
    <DashboardLayout>
      <HrmsModernShell
        eyebrow="HR Administration"
        title="Joining Document Templates"
        description="Manage document templates, field mappings and fill configurations for employee onboarding"
        icon={<FileText className="h-5 w-5 text-white" />}
        actions={
          <Button
            onClick={() => handleOpenEdit()}
            className="min-h-[44px] gap-2 bg-emerald-600 hover:bg-emerald-700"
          >
            <Plus className="h-4 w-4" />
            Add Template
          </Button>
        }
      >
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="space-y-3 p-6">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : !templates || templates.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-400">
                <FileSearch className="h-12 w-12" />
                <p className="text-sm font-medium">No document templates configured</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleOpenEdit()}
                  className="mt-2 gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Create First Template
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Document Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Fill Mode</TableHead>
                    <TableHead className="text-center">Fields</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead className="text-center">Mandatory</TableHead>
                    <TableHead className="text-center">E-Sign</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {templates.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-mono text-xs font-semibold">
                        {t.document_code}
                      </TableCell>
                      <TableCell className="font-medium">{t.document_name}</TableCell>
                      <TableCell className="capitalize">{t.document_category}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={fillModeBadgeColor(t.fill_mode)}
                        >
                          {t.fill_mode || "—"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="text-sm font-semibold text-slate-700">
                          {t.field_count ?? 0}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">
                        v{t.template_version}
                      </TableCell>
                      <TableCell className="text-center">
                        {t.is_mandatory ? (
                          <Badge className="bg-amber-50 text-amber-700 border-amber-200" variant="outline">
                            Yes
                          </Badge>
                        ) : (
                          <span className="text-xs text-slate-400">No</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {t.requires_candidate_esign ? (
                          <Badge className="bg-blue-50 text-blue-700 border-blue-200" variant="outline">
                            Yes
                          </Badge>
                        ) : (
                          <span className="text-xs text-slate-400">No</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {t.active_status ? (
                          <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200" variant="outline">
                            Active
                          </Badge>
                        ) : (
                          <Badge className="bg-rose-50 text-rose-700 border-rose-200" variant="outline">
                            Inactive
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="min-h-[44px] gap-1.5"
                            onClick={() => handleOpenUpload(t)}
                          >
                            <Upload className="h-3.5 w-3.5" />
                            Upload
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="min-h-[44px] gap-1.5"
                            onClick={() => handleOpenFieldMap(t)}
                          >
                            <Columns3 className="h-3.5 w-3.5" />
                            Fields
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="min-h-[44px] gap-1.5"
                            onClick={() => handleOpenEdit(t)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Edit
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Add/Edit Template Dialog */}
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{isNew ? "Add Template" : "Edit Template"}</DialogTitle>
              <DialogDescription>
                {isNew
                  ? "Configure a new joining document template"
                  : `Editing ${editData.document_code}`}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-2">
              <div className="grid gap-2">
                <Label htmlFor="doc_code">Document Code</Label>
                <Input
                  id="doc_code"
                  value={editData.document_code || ""}
                  onChange={(e) =>
                    setEditData((d) => ({ ...d, document_code: e.target.value }))
                  }
                  readOnly={!isNew}
                  className={!isNew ? "bg-slate-50" : ""}
                  placeholder="e.g. APPT_LETTER"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="doc_name">Document Name</Label>
                <Input
                  id="doc_name"
                  value={editData.document_name || ""}
                  onChange={(e) =>
                    setEditData((d) => ({ ...d, document_name: e.target.value }))
                  }
                  placeholder="e.g. Appointment Letter"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Category</Label>
                  <Select
                    value={editData.document_category || "appointment"}
                    onValueChange={(v) =>
                      setEditData((d) => ({ ...d, document_category: v }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Fill Mode</Label>
                  <Select
                    value={editData.fill_mode || "placeholder"}
                    onValueChange={(v) =>
                      setEditData((d) => ({ ...d, fill_mode: v }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FILL_MODES.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="version">Version</Label>
                <Input
                  id="version"
                  value={editData.template_version || ""}
                  onChange={(e) =>
                    setEditData((d) => ({ ...d, template_version: e.target.value }))
                  }
                  placeholder="1.0"
                />
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 pt-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="is_mandatory"
                    checked={!!editData.is_mandatory}
                    onCheckedChange={(c) =>
                      setEditData((d) => ({ ...d, is_mandatory: !!c }))
                    }
                  />
                  <Label htmlFor="is_mandatory" className="text-sm">
                    Mandatory
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="esign"
                    checked={!!editData.requires_candidate_esign}
                    onCheckedChange={(c) =>
                      setEditData((d) => ({ ...d, requires_candidate_esign: !!c }))
                    }
                  />
                  <Label htmlFor="esign" className="text-sm">
                    Requires E-Sign
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="hr_upload"
                    checked={!!editData.requires_hr_upload}
                    onCheckedChange={(c) =>
                      setEditData((d) => ({ ...d, requires_hr_upload: !!c }))
                    }
                  />
                  <Label htmlFor="hr_upload" className="text-sm">
                    HR Upload Required
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="hr_verify"
                    checked={!!editData.requires_hr_verification}
                    onCheckedChange={(c) =>
                      setEditData((d) => ({
                        ...d,
                        requires_hr_verification: !!c,
                      }))
                    }
                  />
                  <Label htmlFor="hr_verify" className="text-sm">
                    HR Verification
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="active"
                    checked={editData.active_status !== false}
                    onCheckedChange={(c) =>
                      setEditData((d) => ({ ...d, active_status: !!c }))
                    }
                  />
                  <Label htmlFor="active" className="text-sm">
                    Active
                  </Label>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleSaveTemplate}
                disabled={upsertMutation.isPending}
                className="min-h-[44px] gap-2 bg-emerald-600 hover:bg-emerald-700"
              >
                {upsertMutation.isPending && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                Save Template
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Upload File Dialog */}
        <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Upload Template File</DialogTitle>
              <DialogDescription>
                Upload a PDF or DOCX template. Optionally attach a field-map JSON schema to auto-populate all field coordinates and source paths.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-2">
              <div className="grid gap-2">
                <Label>Template File <span className="text-rose-500">*</span></Label>
                <Input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx"
                  className="cursor-pointer"
                />
              </div>
              <div className="grid gap-2">
                <Label>
                  Field Map JSON{" "}
                  <span className="ml-1 text-xs font-normal text-slate-400">(optional — auto-seeds field coordinates &amp; source paths)</span>
                </Label>
                <Input
                  ref={schemaInputRef}
                  type="file"
                  accept=".json"
                  className="cursor-pointer"
                />
                <p className="text-xs text-slate-400">
                  Upload the box-grid or overlay mapping JSON alongside the PDF to pre-fill all field rows. Admin can then confirm or adjust each mapping in the Fields drawer.
                </p>
              </div>
              <div className="grid gap-2">
                <Label>Fill Mode</Label>
                <Select value={uploadFillMode} onValueChange={setUploadFillMode}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FILL_MODES.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setUploadOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleUploadSubmit}
                disabled={uploadMutation.isPending}
                className="min-h-[44px] gap-2 bg-emerald-600 hover:bg-emerald-700"
              >
                {uploadMutation.isPending && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                Upload
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Field Map Editor Sheet */}
        <Sheet
          open={fieldSheetOpen}
          onOpenChange={(open) => {
            setFieldSheetOpen(open);
            if (!open) {
              setFieldTemplate(null);
              setFieldMaps([]);
            }
          }}
        >
          <SheetContent side="right" className="w-[640px] max-w-full overflow-y-auto sm:max-w-[640px]">
            <SheetHeader className="pb-2">
              <SheetTitle>
                Field Mappings — {fieldTemplate?.document_name}
              </SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-2">
                <span>Fill mode:</span>
                <Badge variant="outline" className={fillModeBadgeColor(fieldTemplate?.fill_mode ?? null)}>
                  {fieldTemplate?.fill_mode || "—"}
                </Badge>
                {fieldMaps.length > 0 && (
                  <>
                    <span className="ml-2 text-xs text-slate-500">
                      {fieldMaps.filter((f) => f.mapping_confirmed).length}/{fieldMaps.length} confirmed
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                      onClick={() =>
                        setFieldMaps((prev) => prev.map((f) => ({ ...f, mapping_confirmed: 1 })))
                      }
                    >
                      Confirm All
                    </Button>
                  </>
                )}
              </SheetDescription>
            </SheetHeader>

            {fieldMapQuery.isLoading ? (
              <div className="space-y-3 pt-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-4 pt-2">
                {fieldMaps.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-10 text-slate-400">
                    <Columns3 className="h-8 w-8" />
                    <p className="text-sm">No field mappings yet</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {fieldMaps.map((field, idx) => (
                      <Card key={idx} className={`relative ${field.mapping_confirmed ? "border-emerald-200" : field.schema_suggested_path ? "border-amber-200" : ""}`}>
                        <CardContent className="grid grid-cols-2 gap-3 p-3">
                          {/* Status badge row */}
                          <div className="col-span-2 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              {field.mapping_confirmed ? (
                                <Badge className="h-5 px-1.5 text-[10px] bg-emerald-50 text-emerald-700 border-emerald-300" variant="outline">
                                  Confirmed
                                </Badge>
                              ) : field.schema_suggested_path ? (
                                <Badge className="h-5 px-1.5 text-[10px] bg-amber-50 text-amber-700 border-amber-300" variant="outline">
                                  Suggested
                                </Badge>
                              ) : null}
                              {field.schema_field_tooltip && (
                                <span className="truncate text-xs text-slate-400" title={field.schema_field_tooltip}>
                                  {field.schema_field_tooltip}
                                </span>
                              )}
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className={`h-6 px-2 text-[10px] ${field.mapping_confirmed ? "text-slate-400 hover:text-slate-600" : "text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50"}`}
                              onClick={() => updateFieldRow(idx, { mapping_confirmed: field.mapping_confirmed ? 0 : 1 })}
                            >
                              {field.mapping_confirmed ? "Unconfirm" : "Confirm"}
                            </Button>
                          </div>
                          {field.schema_suggested_path && !field.mapping_confirmed && (
                            <div className="col-span-2 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
                              Suggested: <span className="font-mono">{field.schema_suggested_path}</span>
                            </div>
                          )}
                          <div className="grid gap-1">
                            <Label className="text-xs text-slate-500">Field Key</Label>
                            <Input
                              value={field.field_key}
                              onChange={(e) =>
                                updateFieldRow(idx, { field_key: e.target.value })
                              }
                              placeholder="field_key"
                              className="h-9 text-sm"
                            />
                          </div>
                          <div className="grid gap-1">
                            <Label className="text-xs text-slate-500">Source Path</Label>
                            <Select
                              value={field.source_path}
                              onValueChange={(v) =>
                                updateFieldRow(idx, { source_path: v, mapping_confirmed: 1 })
                              }
                            >
                              <SelectTrigger className="h-9 text-sm">
                                <SelectValue placeholder="Select source" />
                              </SelectTrigger>
                              <SelectContent>
                                {SOURCE_PATHS.map((group) => (
                                  <div key={group.group}>
                                    <div className="px-2 py-1.5 text-xs font-semibold text-slate-500">
                                      {group.group}
                                    </div>
                                    {group.options.map((opt) => (
                                      <SelectItem key={opt} value={opt}>
                                        {opt}
                                      </SelectItem>
                                    ))}
                                  </div>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="grid gap-1">
                            <Label className="text-xs text-slate-500">
                              {field.mapping_mode === "placeholder"
                                ? "Placeholder Token"
                                : "PDF Field Name"}
                            </Label>
                            <Input
                              value={
                                field.mapping_mode === "placeholder"
                                  ? field.placeholder_token || ""
                                  : field.pdf_field_name || ""
                              }
                              onChange={(e) =>
                                updateFieldRow(idx, {
                                  ...(field.mapping_mode === "placeholder"
                                    ? { placeholder_token: e.target.value }
                                    : { pdf_field_name: e.target.value }),
                                })
                              }
                              placeholder={
                                field.mapping_mode === "placeholder"
                                  ? "{{FULL_NAME}}"
                                  : "pdf_field_name"
                              }
                              className="h-9 text-sm"
                            />
                          </div>
                          <div className="grid gap-1">
                            <Label className="text-xs text-slate-500">Transform</Label>
                            <Select
                              value={field.transform_rule || ""}
                              onValueChange={(v) =>
                                updateFieldRow(idx, {
                                  transform_rule: v || undefined,
                                })
                              }
                            >
                              <SelectTrigger className="h-9 text-sm">
                                <SelectValue placeholder="(none)" />
                              </SelectTrigger>
                              <SelectContent>
                                {TRANSFORM_RULES.map((tr) => (
                                  <SelectItem key={tr.value || "__none"} value={tr.value || "__none"}>
                                    {tr.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="col-span-2 flex items-center gap-3">
                            <div className="flex items-center gap-2">
                              <Checkbox
                                checked={!!field.is_mandatory}
                                onCheckedChange={(c) =>
                                  updateFieldRow(idx, { is_mandatory: !!c })
                                }
                              />
                              <Label className="text-xs">Mandatory</Label>
                            </div>
                            <div className="grid gap-1">
                              <Select
                                value={field.mapping_mode}
                                onValueChange={(v) =>
                                  updateFieldRow(idx, {
                                    mapping_mode: v as FieldMap["mapping_mode"],
                                  })
                                }
                              >
                                <SelectTrigger className="h-8 w-[160px] text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {MAPPING_MODES.map((mm) => (
                                    <SelectItem key={mm} value={mm}>
                                      {mm}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="absolute right-2 top-2 h-7 w-7 p-0 text-slate-400 hover:text-rose-600"
                            onClick={() => removeFieldRow(idx)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}

                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-[44px] gap-2"
                  onClick={addFieldRow}
                >
                  <Plus className="h-4 w-4" />
                  Add Field
                </Button>

                <Button
                  onClick={() => saveFieldMapMutation.mutate()}
                  disabled={saveFieldMapMutation.isPending}
                  className="min-h-[44px] gap-2 bg-emerald-600 hover:bg-emerald-700"
                >
                  {saveFieldMapMutation.isPending && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                  Save All
                </Button>
              </div>
            )}
          </SheetContent>
        </Sheet>
      </HrmsModernShell>
    </DashboardLayout>
  );
}
