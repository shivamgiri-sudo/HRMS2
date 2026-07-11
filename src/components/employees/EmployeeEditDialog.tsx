import { useState, useEffect, useRef, useMemo } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
import { useAuth } from "@/contexts/AuthContext";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Employee } from "./EmployeeTable";
import { Loader2, Hash, IndianRupee, History, ChevronDown, ChevronUp, Eye, EyeOff, ChevronsUpDown, Check } from "lucide-react";
import { format } from "date-fns";
import { parseLocalDate } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { EmployeeLeaveEligibility, type EmployeeLeaveEligibilityHandle } from "./EmployeeLeaveEligibility";
import { fetchAllEmployeeRows } from "@/hooks/useEmployees";

const WEEKDAYS = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
];

interface EmployeeEditDialogProps {
  employee: Employee | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface EditFormData {
  employee_code: string;
  first_name: string;
  last_name: string;
  email: string;
  official_email: string;
  phone: string;
  personal_email: string;
  personal_mobile: string;
  address: string;
  city: string;
  country: string;
  date_of_birth: string;
  gender: string;
  designation_id: string;
  department_id: string;
  manager_id: string;
  hire_date: string;
  salary_start_date: string | null;
  employment_type: string;
  working_hours_start: string;
  working_hours_end: string;
  working_days: number[];
  status: string;
}

interface SalaryFormData {
  basic_salary: string;
  hra: string;
  transport_allowance: string;
  medical_allowance: string;
  other_allowances: string;
  tax_deduction: string;
  other_deductions: string;
  effective_from: string;
}

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
};

export function EmployeeEditDialog({ employee, open, onOpenChange }: EmployeeEditDialogProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState<EditFormData>({
    employee_code: "",
    first_name: "",
    last_name: "",
    email: "",
    official_email: "",
    phone: "",
    personal_email: "",
    personal_mobile: "",
    address: "",
    city: "",
    country: "",
    date_of_birth: "",
    gender: "",
    designation_id: "",
    department_id: "",
    manager_id: "",
    hire_date: "",
    salary_start_date: null,
    employment_type: "full-time",
    working_hours_start: "09:00",
    working_hours_end: "18:00",
    working_days: [1, 2, 3, 4, 5],
    status: "active",
  });

  const [salaryData, setSalaryData] = useState<SalaryFormData>({
    basic_salary: "",
    hra: "",
    transport_allowance: "",
    medical_allowance: "",
    other_allowances: "",
    tax_deduction: "",
    other_deductions: "",
    effective_from: new Date().toISOString().split("T")[0],
  });
  const [selectedSalaryStructureId, setSelectedSalaryStructureId] = useState("");
  const [salaryVisible, setSalaryVisible] = useState(false);

  // Fetch salary structure for this employee
  const { data: salaryContext, isLoading: isLoadingSalary } = useQuery({
    queryKey: ["employee-salary-structure", employee?.id],
    queryFn: async () => {
      if (!employee?.id) return null;
      const [assignmentResponse, structuresResponse] = await Promise.all([
        hrmsApi.get<{ data: any }>(`/api/payroll/salary-assignments/${employee.id}`),
        hrmsApi.get<{ data: any[] }>("/api/payroll/structures"),
      ]);
      return {
        assignment: assignmentResponse.data ?? null,
        structures: structuresResponse.data ?? [],
      };
    },
    enabled: open && !!employee?.id,
  });
  const salaryStructure = salaryContext?.assignment ?? null;
  const salaryStructures = salaryContext?.structures ?? [];

  // Fetch salary history for this employee
  const { data: salaryHistory = [], isLoading: isLoadingHistory } = useQuery({
    queryKey: ["employee-salary-history", employee?.id],
    queryFn: async () => {
      if (!employee?.id) return [];
      const res = await hrmsApi.get<{data:any[]}>(`/api/payroll/salary-assignments/${employee.id}/history`);
      return res.data ?? [];
    },
    enabled: open && !!employee?.id,
  });

  const [showHistory, setShowHistory] = useState(false);
  const [isDepartmentManager, setIsDepartmentManager] = useState(false);
  const [managerSearchOpen, setManagerSearchOpen] = useState(false);
  const [managerSearchQuery, setManagerSearchQuery] = useState("");
  const eligibilityRef = useRef<EmployeeLeaveEligibilityHandle>(null);

  // Update salary data when structure is loaded
  useEffect(() => {
    if (salaryStructure) {
      const monthlyCtc = Number(salaryStructure.ctc_annual ?? 0) / 12;
      const basic = monthlyCtc * Number(salaryStructure.basic_pct ?? 40) / 100;
      const hra = monthlyCtc * Number(salaryStructure.hra_pct ?? 20) / 100;
      setSelectedSalaryStructureId(salaryStructure.structure_id ?? "");
      setSalaryData({
        basic_salary: basic.toFixed(2),
        hra: hra.toFixed(2),
        transport_allowance: "0",
        medical_allowance: "0",
        other_allowances: Math.max(0, monthlyCtc - basic - hra).toFixed(2),
        tax_deduction: "0",
        other_deductions: "0",
        effective_from: salaryStructure.effective_from || new Date().toISOString().split("T")[0],
      });
    } else {
      setSelectedSalaryStructureId(salaryStructures[0]?.id ?? "");
      setSalaryData({
        basic_salary: "",
        hra: "",
        transport_allowance: "",
        medical_allowance: "",
        other_allowances: "",
        tax_deduction: "",
        other_deductions: "",
        effective_from: new Date().toISOString().split("T")[0],
      });
    }
  }, [salaryStructure, salaryStructures]);

  // Fetch full employee details when dialog opens
  const { data: employeeDetails, isLoading: isLoadingDetails } = useQuery({
    queryKey: ["employee-details", employee?.id],
    queryFn: async () => {
      if (!employee?.id) return null;
      const res = await hrmsApi.get<{success:boolean;data:any}>(`/api/employees/${employee.id}`);
      return res.data ?? null;
    },
    enabled: open && !!employee?.id,
  });

  // Fetch managers (active employees who can be managers)
  const { data: managers = [] } = useQuery({
    queryKey: ["managers"],
    queryFn: () => fetchAllEmployeeRows("active"),
    staleTime: 60_000,
  });

  // Check if there's a pending reporting manager change for this employee
  const { data: pendingManagerRequest } = useQuery({
    queryKey: ["reporting-manager-pending", employee?.id],
    queryFn: async () => {
      if (!employee?.id) return null;
      const res = await hrmsApi.get<{ success: boolean; data: any[] }>("/api/employees/reporting-manager-requests");
      const pending = (res.data ?? []).find((r: any) => r.employee_id === employee.id);
      return pending ?? null;
    },
    enabled: open && !!employee?.id,
    staleTime: 10_000,
  });

  const filteredManagers = useMemo(() => {
    const q = managerSearchQuery.toLowerCase();
    return managers
      .filter((m) => m.id !== employee?.id)
      .filter((m) => {
        if (!q) return true;
        const name = `${m.first_name} ${m.last_name ?? ""}`.toLowerCase();
        return name.includes(q) || m.employee_code.toLowerCase().includes(q);
      });
  }, [managers, managerSearchQuery, employee?.id]);

  const selectedManagerLabel = useMemo(() => {
    if (!formData.manager_id) return null;
    const m = managers.find((m) => m.id === formData.manager_id);
    if (!m) return null;
    return `${m.employee_code} — ${m.first_name} ${m.last_name ?? ""}`.trim();
  }, [managers, formData.manager_id]);

  // Fetch departments
  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: async () => {
      const res = await hrmsApi.get<{success:boolean;data:any}>("/api/org/departments");
      return (res.data ?? []).map((dept: any) => ({
        ...dept,
        name: dept.dept_name || dept.name
      }));
    },
  });

  // Fetch designations
  const { data: designations = [] } = useQuery({
    queryKey: ["designations"],
    queryFn: async () => {
      const res = await hrmsApi.get<{data: any[]}>("/api/org/designations");
      return res.data ?? [];
    },
    staleTime: 120_000,
  });

  // Initialize isDepartmentManager state based on whether employee is a department head
  useEffect(() => {
    const isHead = departments.some((dept) => dept.manager_id === employee?.id);
    setIsDepartmentManager(isHead);
  }, [departments, employee?.id]);

  // Parse working hours from TIME format (HH:MM:SS) to input format (HH:MM)
  const parseTime = (time: string | null) => {
    if (!time) return '09:00';
    return time.substring(0, 5);
  };

  // Update form when employee details are loaded
  useEffect(() => {
    if (employeeDetails) {
      setFormData({
        employee_code: employeeDetails.employee_code || "",
        first_name: employeeDetails.first_name || "",
        last_name: employeeDetails.last_name || "",
        email: employeeDetails.email || "",
        official_email: employeeDetails.official_email || "",
        phone: employeeDetails.mobile || employeeDetails.phone || "",
        personal_email: employeeDetails.personal_email || "",
        personal_mobile: employeeDetails.personal_mobile || "",
        address: employeeDetails.address1 || employeeDetails.address || "",
        city: employeeDetails.city || "",
        country: employeeDetails.country || "",
        date_of_birth: employeeDetails.date_of_birth?.slice?.(0, 10) || "",
        gender: employeeDetails.gender || "",
        designation_id: employeeDetails.designation_id || "",
        department_id: employeeDetails.department_id || "",
        manager_id: employeeDetails.reporting_manager_id || employeeDetails.manager_id || "",
        hire_date: employeeDetails.date_of_joining?.slice?.(0, 10) || employeeDetails.hire_date?.slice?.(0, 10) || "",
        salary_start_date: employeeDetails.salary_start_date?.slice?.(0, 10) || null,
        employment_type: employeeDetails.employment_type || "full-time",
        working_hours_start: parseTime(employeeDetails.working_hours_start),
        working_hours_end: parseTime(employeeDetails.working_hours_end),
        working_days: employeeDetails.working_days || [1, 2, 3, 4, 5],
        status: String(employeeDetails.employment_status || employeeDetails.status || "active").toLowerCase(),
      });
    }
  }, [employeeDetails]);

  const updateMutation = useMutation({
    mutationFn: async ({ data, isDeptManager }: { data: EditFormData; isDeptManager: boolean }) => {
      const result = await hrmsApi.patch<{ success?: boolean; pendingApproval?: boolean; message?: string }>(`/api/employees/${employee.id}`, {
        // Note: employeeCode, firstName, and lastName are protected and cannot be updated
        email: data.email,
        officialEmail: data.official_email || null,
        mobile: data.phone || null,
        personalEmail: data.personal_email || null,
        personalMobile: data.personal_mobile || null,
        address1: data.address || null,
        city: data.city || null,
        country: data.country || null,
        dateOfBirth: data.date_of_birth || undefined,
        gender: data.gender || undefined,
        designationId: data.designation_id || null,
        departmentId: data.department_id || null,
        reportingManagerId: data.manager_id || null,
        dateOfJoining: data.hire_date,
        salaryStartDate: data.salary_start_date || null,
        employmentType: data.employment_type,
        workingHoursStart: data.working_hours_start,
        workingHoursEnd: data.working_hours_end,
        workingDays: data.working_days,
        employmentStatus: data.status
          ? data.status.split(" ").map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ")
          : undefined,
      });
      return result;

      // Update department manager status if employee has a department
      if (data.department_id) {
        const department = departments.find((item) => item.id === data.department_id);
        if (isDeptManager) {
          // Set this employee as the department manager
          await hrmsApi.put(`/api/org/departments/${data.department_id}`, { manager_id: employee.id });
        } else if (department?.manager_id === employee.id) {
          // Only clear the department head when this employee currently owns that role.
          await hrmsApi.put(`/api/org/departments/${data.department_id}`, { manager_id: null });
        }
      }
      return result;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      queryClient.invalidateQueries({ queryKey: ["employee-directory"] });
      queryClient.invalidateQueries({ queryKey: ["departments"] });
      queryClient.invalidateQueries({ queryKey: ["reporting-manager-pending", employee?.id] });
      if (result?.pendingApproval) {
        toast.info(result.message ?? "Reporting manager change submitted for WFM approval");
      }
    },
    onError: (error) => {
      toast.error(`Failed to update employee: ${error.message}`);
    },
  });

  const salaryMutation = useMutation({
    mutationFn: async (data: SalaryFormData) => {
      if (!employee?.id) throw new Error("Employee ID is required");
      if (!selectedSalaryStructureId) throw new Error("Select a salary structure");

      const grossMonthly =
        (parseFloat(data.basic_salary) || 0) +
        (parseFloat(data.hra) || 0) +
        (parseFloat(data.transport_allowance) || 0) +
        (parseFloat(data.medical_allowance) || 0) +
        (parseFloat(data.other_allowances) || 0);

      await hrmsApi.post("/api/payroll/salary-assignments", {
        employeeId: employee.id,
        structureId: selectedSalaryStructureId,
        ctcAnnual: Math.round(grossMonthly * 12 * 100) / 100,
        effectiveFrom: data.effective_from,
        migrationMode: true,
        reason: "Direct salary assignment via employee edit dialog by super admin",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["salary-structures"] });
      queryClient.invalidateQueries({ queryKey: ["employee-salary-structure", employee?.id] });
      queryClient.invalidateQueries({ queryKey: ["employee-salary-history", employee?.id] });
      queryClient.invalidateQueries({ queryKey: ["employee-stat-card", employee?.id] });
    },
    onError: (error) => {
      toast.error(`Failed to update salary structure: ${error.message}`);
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.employee_code.trim()) {
      toast.error("Employee code is required");
      return;
    }
    // Validate official email format if provided
    if (formData.official_email && !/^[a-zA-Z0-9._%+-]+@(teammas\.in|teammas\.co\.in)$/.test(formData.official_email)) {
      toast.error("Official email must be @teammas.in or @teammas.co.in");
      return;
    }
    // Validate salary_start_date is not before hire_date
    if (formData.salary_start_date && formData.hire_date) {
      const salaryDate = new Date(formData.salary_start_date);
      const hireDate = new Date(formData.hire_date);
      if (salaryDate < hireDate) {
        toast.error('Salary start date cannot be before date of joining');
        return;
      }
    }
    // Note: first_name, last_name, and employee_code are protected fields and cannot be updated
    if (!formData.email || !formData.designation_id) {
      toast.error("Please fill in all required fields (email, designation)");
      return;
    }
    try {
      // Update employee details and department manager status
      await updateMutation.mutateAsync({ data: formData, isDeptManager: isDepartmentManager });
      
      // Update salary structure if basic salary is provided
      if (salaryData.basic_salary) {
        await salaryMutation.mutateAsync(salaryData);
      }

      // Save leave eligibility selections
      if (eligibilityRef.current) {
        await eligibilityRef.current.save();
      }

      toast.success("Employee updated successfully");
      onOpenChange(false);
    } catch {
      // Errors are handled in individual mutation error handlers
    }
  };

  // Calculate salary totals for display
  const calculateSalaryTotals = () => {
    const basic = parseFloat(salaryData.basic_salary) || 0;
    const hra = parseFloat(salaryData.hra) || 0;
    const transport = parseFloat(salaryData.transport_allowance) || 0;
    const medical = parseFloat(salaryData.medical_allowance) || 0;
    const other = parseFloat(salaryData.other_allowances) || 0;
    const tax = parseFloat(salaryData.tax_deduction) || 0;
    const otherDed = parseFloat(salaryData.other_deductions) || 0;

    const totalAllowances = hra + transport + medical + other;
    const totalDeductions = tax + otherDed;
    const netSalary = basic + totalAllowances - totalDeductions;

    return { totalAllowances, totalDeductions, netSalary };
  };

  const salaryTotals = calculateSalaryTotals();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {employee && <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Employee</DialogTitle>
        </DialogHeader>
        {isLoadingDetails ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <Tabs defaultValue="basic" className="w-full">
              <TabsList className="grid w-full grid-cols-5">
                <TabsTrigger value="basic">Basic Info</TabsTrigger>
                <TabsTrigger value="job">Job Details</TabsTrigger>
                <TabsTrigger value="schedule">Schedule</TabsTrigger>
                <TabsTrigger value="salary">Salary</TabsTrigger>
                <TabsTrigger value="leaves">Leaves</TabsTrigger>
              </TabsList>
              
              <TabsContent value="basic" className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label htmlFor="employee_code">Employee Number *</Label>
                  <div className="relative">
                    <Hash className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="employee_code"
                      value={formData.employee_code}
                      onChange={(e) => setFormData({ ...formData, employee_code: e.target.value.toUpperCase() })}
                      className="pl-9 font-mono bg-slate-50"
                      required
                      disabled
                      title="Employee code cannot be changed"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">Employee code cannot be modified</p>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="first_name">First Name *</Label>
                    <Input
                      id="first_name"
                      value={formData.first_name}
                      onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                      className="bg-slate-50"
                      required
                      disabled
                      title="Name cannot be changed"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="last_name">Last Name *</Label>
                    <Input
                      id="last_name"
                      value={formData.last_name}
                      onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                      className="bg-slate-50"
                      required
                      disabled
                      title="Name cannot be changed"
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground -mt-2">Employee name cannot be modified</p>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">Email *</Label>
                    <Input
                      id="email"
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone</Label>
                    <Input
                      id="phone"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="official_email">Official Email</Label>
                  <Input
                    id="official_email"
                    type="email"
                    placeholder="firstname.lastname@teammas.in"
                    value={formData.official_email}
                    onChange={(e) => setFormData({ ...formData, official_email: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">Must be @teammas.in or @teammas.co.in</p>
                </div>

                {/* Personal Contact Section */}
                <div className="pt-2 border-t">
                  <h4 className="text-sm font-medium mb-3">Personal Contact Information</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="personal_email">Personal Email</Label>
                      <Input
                        id="personal_email"
                        type="email"
                        placeholder="personal@gmail.com"
                        value={formData.personal_email}
                        onChange={(e) => setFormData({ ...formData, personal_email: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="personal_mobile">Personal Mobile</Label>
                      <Input
                        id="personal_mobile"
                        placeholder="+91 98765 43210"
                        value={formData.personal_mobile}
                        onChange={(e) => setFormData({ ...formData, personal_mobile: e.target.value })}
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="date_of_birth">Date of Birth</Label>
                    <Input
                      id="date_of_birth"
                      type="date"
                      value={formData.date_of_birth}
                      onChange={(e) => setFormData({ ...formData, date_of_birth: e.target.value })}
                      max={new Date(new Date().getFullYear() - 18, new Date().getMonth(), new Date().getDate()).toISOString().split('T')[0]}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="gender">Gender</Label>
                    <Select
                      value={formData.gender}
                      onValueChange={(value) => setFormData({ ...formData, gender: value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select gender" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="male">Male</SelectItem>
                        <SelectItem value="female">Female</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                        <SelectItem value="prefer_not_to_say">Prefer not to say</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="address">Address</Label>
                  <Input
                    id="address"
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    placeholder="Street address"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="city">City</Label>
                    <Input
                      id="city"
                      value={formData.city}
                      onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="country">Country</Label>
                    <Input
                      id="country"
                      value={formData.country}
                      onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                    />
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="job" className="space-y-4 mt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="designation">Designation *</Label>
                    <Select
                      value={formData.designation_id}
                      onValueChange={(value) => setFormData({ ...formData, designation_id: value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select designation" />
                      </SelectTrigger>
                      <SelectContent>
                        {designations.map((d: any) => (
                          <SelectItem key={d.id} value={d.id}>
                            {d.designation_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="hire_date">Join Date *</Label>
                    <Input
                      id="hire_date"
                      type="date"
                      value={formData.hire_date}
                      onChange={(e) => setFormData({ ...formData, hire_date: e.target.value })}
                      required
                    />
                  </div>
                </div>

                {/* Salary Start Date - HR/Admin only */}
                {(user?.role === 'super_admin' || user?.role === 'admin' || user?.role === 'hr') && (
                  <div className="space-y-2">
                    <Label htmlFor="salary_start_date" className="text-sm font-semibold text-slate-700">
                      Salary Start Date
                      <span className="ml-2 text-xs font-normal text-slate-500">
                        (Optional - defaults to Date of Joining)
                      </span>
                    </Label>
                    <Input
                      id="salary_start_date"
                      type="date"
                      value={formData.salary_start_date || ''}
                      onChange={(e) => setFormData({ ...formData, salary_start_date: e.target.value || null })}
                      className="w-full"
                    />
                    {formData.hire_date && formData.salary_start_date && formData.salary_start_date !== formData.hire_date && (
                      <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs">
                        <p className="font-semibold text-amber-800">Training Period</p>
                        <p className="mt-1 text-amber-700">
                          {(() => {
                            const hire = new Date(formData.hire_date);
                            const salary = new Date(formData.salary_start_date);
                            const diffDays = Math.ceil((salary.getTime() - hire.getTime()) / (1000 * 60 * 60 * 24));
                            return diffDays > 0
                              ? `${diffDays} day(s) unpaid training period from joining to salary start.`
                              : `Salary starts ${Math.abs(diffDays)} day(s) before joining (unusual - verify this is correct).`;
                          })()}
                        </p>
                      </div>
                    )}
                    {formData.salary_start_date && formData.hire_date && new Date(formData.salary_start_date) < new Date(formData.hire_date) && (
                      <p className="text-xs text-rose-600 font-medium">
                        ⚠️ Salary start date cannot be before date of joining
                      </p>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="department">Department</Label>
                    <Select
                      value={formData.department_id}
                      onValueChange={(value) => setFormData({ ...formData, department_id: value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select department" />
                      </SelectTrigger>
                      <SelectContent>
                        {departments.map((dept) => (
                          <SelectItem key={dept.id} value={dept.id}>
                            {dept.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="employment_type">Employment Type</Label>
                    <Select
                      value={formData.employment_type}
                      onValueChange={(value) => setFormData({ ...formData, employment_type: value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="full-time">Full-time</SelectItem>
                        <SelectItem value="part-time">Part-time</SelectItem>
                        <SelectItem value="contract">Contract</SelectItem>
                        <SelectItem value="intern">Intern</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Department Manager Toggle */}
                <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-4">
                  <div className="space-y-0.5">
                    <Label htmlFor="department-manager" className="text-base font-medium">
                      Department Manager
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Tag this employee as the head of their department
                    </p>
                  </div>
                  <Switch
                    id="department-manager"
                    checked={isDepartmentManager}
                    onCheckedChange={(checked) => {
                      setIsDepartmentManager(checked);
                      // Clear manager_id when toggling on department manager
                      if (checked) {
                        setFormData({ ...formData, manager_id: "" });
                      }
                    }}
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label>
                      Reporting Manager {!isDepartmentManager && '*'}
                    </Label>
                    {pendingManagerRequest && (
                      <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                        Pending WFM approval
                      </span>
                    )}
                  </div>
                  <Popover open={managerSearchOpen} onOpenChange={setManagerSearchOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        className="w-full justify-between font-normal"
                      >
                        <span className="truncate">
                          {selectedManagerLabel ?? "Search by name or code…"}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                      <Command shouldFilter={false}>
                        <CommandInput
                          placeholder="Search name or emp code…"
                          value={managerSearchQuery}
                          onValueChange={setManagerSearchQuery}
                        />
                        <CommandList>
                          <CommandEmpty>No employee found.</CommandEmpty>
                          <CommandGroup>
                            {isDepartmentManager && (
                              <CommandItem
                                value="none"
                                onSelect={() => {
                                  setFormData({ ...formData, manager_id: "" });
                                  setManagerSearchOpen(false);
                                  setManagerSearchQuery("");
                                }}
                              >
                                <Check className={`mr-2 h-4 w-4 ${!formData.manager_id ? "opacity-100" : "opacity-0"}`} />
                                No Manager
                              </CommandItem>
                            )}
                            {filteredManagers.map((mgr) => (
                              <CommandItem
                                key={mgr.id}
                                value={mgr.id}
                                onSelect={() => {
                                  setFormData({ ...formData, manager_id: mgr.id });
                                  setManagerSearchOpen(false);
                                  setManagerSearchQuery("");
                                }}
                              >
                                <Check className={`mr-2 h-4 w-4 ${formData.manager_id === mgr.id ? "opacity-100" : "opacity-0"}`} />
                                <span className="font-mono text-xs text-muted-foreground mr-2">{mgr.employee_code}</span>
                                {mgr.first_name} {mgr.last_name ?? ""}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  {!isDepartmentManager && (
                    <p className="text-xs text-muted-foreground">
                      Required for employees who are not department managers
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="status">Status</Label>
                  <Select
                    value={formData.status}
                    onValueChange={(value) => setFormData({ ...formData, status: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                      <SelectItem value="onboarding">Onboarding</SelectItem>
                      <SelectItem value="offboarded">Offboarded</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </TabsContent>

              <TabsContent value="schedule" className="space-y-4 mt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="working_hours_start">Work Start Time</Label>
                    <Input
                      id="working_hours_start"
                      type="time"
                      value={formData.working_hours_start}
                      onChange={(e) => setFormData({ ...formData, working_hours_start: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="working_hours_end">Work End Time</Label>
                    <Input
                      id="working_hours_end"
                      type="time"
                      value={formData.working_hours_end}
                      onChange={(e) => setFormData({ ...formData, working_hours_end: e.target.value })}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Working Days</Label>
                  <div className="flex flex-wrap gap-2">
                    {WEEKDAYS.map((day) => (
                      <label
                        key={day.value}
                        className="flex items-center gap-2 rounded-md border border-border px-3 py-2 cursor-pointer hover:bg-muted/50"
                      >
                        <Checkbox
                          checked={formData.working_days.includes(day.value)}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setFormData({
                                ...formData,
                                working_days: [...formData.working_days, day.value].sort(),
                              });
                            } else {
                              setFormData({
                                ...formData,
                                working_days: formData.working_days.filter((d) => d !== day.value),
                              });
                            }
                          }}
                        />
                        <span className="text-sm">{day.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="salary" className="space-y-4 mt-4">
                {isLoadingSalary ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : !salaryVisible ? (
                  <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-8 text-center">
                    <IndianRupee className="mx-auto h-8 w-8 text-[#1B6AB5]" />
                    <h3 className="mt-3 font-black text-slate-900">Salary details are protected</h3>
                    <p className="mt-1 text-sm text-slate-500">Reveal only when you are ready to review or revise compensation.</p>
                    <Button type="button" className="mt-4" onClick={() => setSalaryVisible(true)}>
                      <Eye className="mr-2 h-4 w-4" /> View salary
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-end justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50/50 p-4">
                      <div className="flex-1 space-y-2">
                        <Label>Salary Structure *</Label>
                        <Select value={selectedSalaryStructureId} onValueChange={setSelectedSalaryStructureId}>
                          <SelectTrigger><SelectValue placeholder="Select salary structure" /></SelectTrigger>
                          <SelectContent>
                            {salaryStructures.map((structure: any) => (
                              <SelectItem key={structure.id} value={structure.id}>
                                {structure.structure_name} ({structure.structure_code})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button type="button" variant="outline" onClick={() => setSalaryVisible(false)}>
                        <EyeOff className="mr-2 h-4 w-4" /> Hide
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="basic_salary">Basic Salary *</Label>
                        <div className="relative">
                          <IndianRupee className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            id="basic_salary"
                            type="number"
                            value={salaryData.basic_salary}
                            onChange={(e) => setSalaryData({ ...salaryData, basic_salary: e.target.value })}
                            className="pl-9"
                            placeholder="0"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="effective_from">Effective From *</Label>
                        <Input
                          id="effective_from"
                          type="date"
                          value={salaryData.effective_from}
                          onChange={(e) => setSalaryData({ ...salaryData, effective_from: e.target.value })}
                        />
                      </div>
                    </div>

                    <div className="space-y-3">
                      <h4 className="text-sm font-medium text-muted-foreground">Allowances</h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="hra">HRA</Label>
                          <div className="relative">
                            <IndianRupee className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                              id="hra"
                              type="number"
                              value={salaryData.hra}
                              onChange={(e) => setSalaryData({ ...salaryData, hra: e.target.value })}
                              className="pl-9"
                              placeholder="0"
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="transport_allowance">Transport Allowance</Label>
                          <div className="relative">
                            <IndianRupee className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                              id="transport_allowance"
                              type="number"
                              value={salaryData.transport_allowance}
                              onChange={(e) => setSalaryData({ ...salaryData, transport_allowance: e.target.value })}
                              className="pl-9"
                              placeholder="0"
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="medical_allowance">Medical Allowance</Label>
                          <div className="relative">
                            <IndianRupee className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                              id="medical_allowance"
                              type="number"
                              value={salaryData.medical_allowance}
                              onChange={(e) => setSalaryData({ ...salaryData, medical_allowance: e.target.value })}
                              className="pl-9"
                              placeholder="0"
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="other_allowances">Other Allowances</Label>
                          <div className="relative">
                            <IndianRupee className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                              id="other_allowances"
                              type="number"
                              value={salaryData.other_allowances}
                              onChange={(e) => setSalaryData({ ...salaryData, other_allowances: e.target.value })}
                              className="pl-9"
                              placeholder="0"
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <h4 className="text-sm font-medium text-muted-foreground">Deductions</h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="tax_deduction">Tax Deduction</Label>
                          <div className="relative">
                            <IndianRupee className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                              id="tax_deduction"
                              type="number"
                              value={salaryData.tax_deduction}
                              onChange={(e) => setSalaryData({ ...salaryData, tax_deduction: e.target.value })}
                              className="pl-9"
                              placeholder="0"
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="other_deductions">Other Deductions</Label>
                          <div className="relative">
                            <IndianRupee className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                              id="other_deductions"
                              type="number"
                              value={salaryData.other_deductions}
                              onChange={(e) => setSalaryData({ ...salaryData, other_deductions: e.target.value })}
                              className="pl-9"
                              placeholder="0"
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-lg border border-border bg-muted/50 p-4 space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Total Allowances</span>
                        <span className="text-green-600 dark:text-green-400">+{formatCurrency(salaryTotals.totalAllowances)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Total Deductions</span>
                        <span className="text-red-600 dark:text-red-400">-{formatCurrency(salaryTotals.totalDeductions)}</span>
                      </div>
                      <div className="border-t border-border pt-2 flex justify-between font-medium">
                        <span>Net Salary</span>
                        <span>{formatCurrency(salaryTotals.netSalary)}</span>
                      </div>
                    </div>

                    {/* Salary History Section */}
                    {salaryHistory.length > 0 && (
                      <Collapsible open={showHistory} onOpenChange={setShowHistory}>
                        <CollapsibleTrigger asChild>
                          <Button variant="ghost" className="w-full justify-between p-3 h-auto">
                            <div className="flex items-center gap-2">
                              <History className="h-4 w-4 text-muted-foreground" />
                              <span className="text-sm font-medium">
                                Salary History ({salaryHistory.length} revision{salaryHistory.length > 1 ? 's' : ''})
                              </span>
                            </div>
                            {showHistory ? (
                              <ChevronUp className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            )}
                          </Button>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <ScrollArea className="h-[200px] mt-2">
                            <div className="space-y-3 pr-4">
                              {isLoadingHistory ? (
                                <div className="flex items-center justify-center py-4">
                                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                </div>
                              ) : (
                                salaryHistory.map((history) => {
                                  const historyAllowances =
                                    Number(history.hra || 0) +
                                    Number(history.transport_allowance || 0) +
                                    Number(history.medical_allowance || 0) +
                                    Number(history.other_allowances || 0);
                                  const historyDeductions =
                                    Number(history.tax_deduction || 0) +
                                    Number(history.other_deductions || 0);
                                  const historyNet =
                                    Number(history.basic_salary) + historyAllowances - historyDeductions;

                                  return (
                                    <div
                                      key={history.id}
                                      className="rounded-lg border border-border bg-card p-3 space-y-2"
                                    >
                                      <div className="flex items-center justify-between">
                                        <span className="text-xs font-medium text-muted-foreground">
                                          {format(parseLocalDate(history.effective_from), "MMM d, yyyy")}
                                          {history.effective_to && (
                                            <> → {format(parseLocalDate(history.effective_to), "MMM d, yyyy")}</>
                                          )}
                                        </span>
                                      </div>
                                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                                        <div className="flex justify-between">
                                          <span className="text-muted-foreground">Basic</span>
                                          <span>{formatCurrency(Number(history.basic_salary))}</span>
                                        </div>
                                        <div className="flex justify-between">
                                          <span className="text-muted-foreground">Allowances</span>
                                          <span className="text-green-600 dark:text-green-400">
                                            +{formatCurrency(historyAllowances)}
                                          </span>
                                        </div>
                                        <div className="flex justify-between">
                                          <span className="text-muted-foreground">Deductions</span>
                                          <span className="text-red-600 dark:text-red-400">
                                            -{formatCurrency(historyDeductions)}
                                          </span>
                                        </div>
                                        <div className="flex justify-between font-medium">
                                          <span>Net</span>
                                          <span>{formatCurrency(historyNet)}</span>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </ScrollArea>
                        </CollapsibleContent>
                      </Collapsible>
                    )}
                  </>
                )}
              </TabsContent>

              <TabsContent value="leaves" className="space-y-4 mt-4">
                {employee?.id ? (
                  <EmployeeLeaveEligibility ref={eligibilityRef} employeeId={employee.id} />
                ) : (
                  <div className="text-sm text-muted-foreground">
                    Save the employee first to manage leave eligibility.
                  </div>
                )}
              </TabsContent>
            </Tabs>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={updateMutation.isPending || salaryMutation.isPending}>
                {(updateMutation.isPending || salaryMutation.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>}
    </Dialog>
  );
}
