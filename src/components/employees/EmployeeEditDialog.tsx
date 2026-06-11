import { useState, useEffect, useRef } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { isValidEmployeeCode } from "@/hooks/useNextEmployeeCode";
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
import { Loader2, Hash, IndianRupee, History, ChevronDown, ChevronUp } from "lucide-react";
import { format } from "date-fns";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { EmployeeLeaveEligibility, type EmployeeLeaveEligibilityHandle } from "./EmployeeLeaveEligibility";

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
  phone: string;
  address: string;
  city: string;
  country: string;
  date_of_birth: string;
  gender: string;
  designation: string;
  department_id: string;
  manager_id: string;
  hire_date: string;
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
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState<EditFormData>({
    employee_code: "",
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    country: "",
    date_of_birth: "",
    gender: "",
    designation: "",
    department_id: "",
    manager_id: "",
    hire_date: "",
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

  // Fetch salary structure for this employee
  const { data: salaryStructure, isLoading: isLoadingSalary } = useQuery({
    queryKey: ["employee-salary-structure", employee?.id],
    queryFn: async () => {
      if (!employee?.id) return null;
      const res = await hrmsApi.get<{success:boolean;data:any}>("/api/payroll/structures");
      return res.data ?? null;
    },
    enabled: open && !!employee?.id,
  });

  // Fetch salary history for this employee
  const { data: salaryHistory = [], isLoading: isLoadingHistory } = useQuery({
    queryKey: ["employee-salary-history", employee?.id],
    queryFn: async () => {
      if (!employee?.id) return [];
      const res = await hrmsApi.get<{success:boolean;data:any}>("/api/payroll/structures");
      return res.data ?? [];
    },
    enabled: open && !!employee?.id,
  });

  const [showHistory, setShowHistory] = useState(false);
  const [isDepartmentManager, setIsDepartmentManager] = useState(false);
  const eligibilityRef = useRef<EmployeeLeaveEligibilityHandle>(null);

  // Update salary data when structure is loaded
  useEffect(() => {
    if (salaryStructure) {
      setSalaryData({
        basic_salary: salaryStructure.basic_salary?.toString() || "",
        hra: salaryStructure.hra?.toString() || "",
        transport_allowance: salaryStructure.transport_allowance?.toString() || "",
        medical_allowance: salaryStructure.medical_allowance?.toString() || "",
        other_allowances: salaryStructure.other_allowances?.toString() || "",
        tax_deduction: salaryStructure.tax_deduction?.toString() || "",
        other_deductions: salaryStructure.other_deductions?.toString() || "",
        effective_from: salaryStructure.effective_from || new Date().toISOString().split("T")[0],
      });
    } else {
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
  }, [salaryStructure]);

  // Fetch full employee details when dialog opens
  const { data: employeeDetails, isLoading: isLoadingDetails } = useQuery({
    queryKey: ["employee-details", employee?.id],
    queryFn: async () => {
      if (!employee?.id) return null;
      const res = await hrmsApi.get<{success:boolean;data:any}>("/api/employees");
      return res.data ?? null;
    },
    enabled: open && !!employee?.id,
  });

  // Fetch managers (active employees who can be managers)
  const { data: managers = [] } = useQuery({
    queryKey: ["managers"],
    queryFn: async () => {
      const res = await hrmsApi.get<{success:boolean;data:any}>("/api/employees");
      return res.data ?? [];
    },
  });

  // Fetch departments
  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: async () => {
      const res = await hrmsApi.get<{success:boolean;data:any}>("/api/org/departments");
      return res.data ?? [];
    },
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
        phone: employeeDetails.phone || "",
        address: employeeDetails.address || "",
        city: employeeDetails.city || "",
        country: employeeDetails.country || "",
        date_of_birth: employeeDetails.date_of_birth || "",
        gender: employeeDetails.gender || "",
        designation: employeeDetails.designation || "",
        department_id: employeeDetails.department_id || "",
        manager_id: employeeDetails.manager_id || "",
        hire_date: employeeDetails.hire_date || "",
        employment_type: employeeDetails.employment_type || "full-time",
        working_hours_start: parseTime(employeeDetails.working_hours_start),
        working_hours_end: parseTime(employeeDetails.working_hours_end),
        working_days: employeeDetails.working_days || [1, 2, 3, 4, 5],
        status: employeeDetails.status || "active",
      });
    }
  }, [employeeDetails]);

  const updateMutation = useMutation({
    mutationFn: async ({ data, isDeptManager }: { data: EditFormData; isDeptManager: boolean }) => {
      await hrmsApi.patch(`/api/employees/${employee.id}`, data);

      // Update department manager status if employee has a department
      if (data.department_id) {
        if (isDeptManager) {
          // Set this employee as the department manager
          await hrmsApi.put(`/api/org/departments/${data.department_id}`, { manager_id: employee.id });
        } else {
          // Remove this employee as department manager if they were previously set
          await hrmsApi.put(`/api/org/departments/${data.department_id}`, { manager_id: null });
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      queryClient.invalidateQueries({ queryKey: ["departments"] });
    },
    onError: (error) => {
      toast.error(`Failed to update employee: ${error.message}`);
    },
  });

  const salaryMutation = useMutation({
    mutationFn: async (data: SalaryFormData) => {
      if (!employee?.id) throw new Error("Employee ID is required");

      const salaryPayload = {
        employee_id: employee.id,
        basic_salary: parseFloat(data.basic_salary) || 0,
        hra: parseFloat(data.hra) || 0,
        transport_allowance: parseFloat(data.transport_allowance) || 0,
        medical_allowance: parseFloat(data.medical_allowance) || 0,
        other_allowances: parseFloat(data.other_allowances) || 0,
        tax_deduction: parseFloat(data.tax_deduction) || 0,
        other_deductions: parseFloat(data.other_deductions) || 0,
        effective_from: data.effective_from,
      };

      await hrmsApi.patch(`/api/employees/${employee.id}`, { salary_info: salaryPayload });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["salary-structures"] });
      queryClient.invalidateQueries({ queryKey: ["employee-salary-structure", employee?.id] });
    },
    onError: (error) => {
      toast.error(`Failed to update salary structure: ${error.message}`);
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.employee_code || !isValidEmployeeCode(formData.employee_code)) {
      toast.error("Employee code must be in format ACQ001");
      return;
    }
    if (!formData.first_name || !formData.last_name || !formData.email || !formData.designation) {
      toast.error("Please fill in all required fields");
      return;
    }
    if (!isDepartmentManager && !formData.manager_id) {
      toast.error("Reporting manager is required for employees who are not department managers");
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

  if (!employee) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
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
                      className="pl-9 font-mono"
                      required
                    />
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="first_name">First Name *</Label>
                    <Input
                      id="first_name"
                      value={formData.first_name}
                      onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="last_name">Last Name *</Label>
                    <Input
                      id="last_name"
                      value={formData.last_name}
                      onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                      required
                    />
                  </div>
                </div>

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
                    <Input
                      id="designation"
                      value={formData.designation}
                      onChange={(e) => setFormData({ ...formData, designation: e.target.value })}
                      required
                    />
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
                  <Label htmlFor="manager">
                    Reporting Manager {!isDepartmentManager && '*'}
                  </Label>
                  <Select
                    value={formData.manager_id}
                    onValueChange={(value) => setFormData({ ...formData, manager_id: value === "none" ? "" : value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select manager" />
                    </SelectTrigger>
                    <SelectContent>
                      {isDepartmentManager && <SelectItem value="none">No Manager</SelectItem>}
                      {managers
                        .filter((mgr) => mgr.id !== employee?.id)
                        .map((mgr) => (
                          <SelectItem key={mgr.id} value={mgr.id}>
                            {mgr.first_name} {mgr.last_name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
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
                ) : (
                  <>
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
                                          {format(new Date(history.effective_from), "MMM d, yyyy")}
                                          {history.effective_to && (
                                            <> → {format(new Date(history.effective_to), "MMM d, yyyy")}</>
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
      </DialogContent>
    </Dialog>
  );
}
