import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, normalizeStatus } from "@/components/ui/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CheckCircle2, Upload, User, Briefcase, FileText, Loader2, ShieldAlert, Calendar, Mail, Phone, MapPin, Pencil, X, Check, Download, ExternalLink, Send, Clock, UserPlus, Eye, XCircle, Hash } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useDepartments } from "@/hooks/useEmployees";
import { useNextEmployeeCode, isValidEmployeeCode } from "@/hooks/useNextEmployeeCode";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi, getAuthToken } from "@/lib/hrmsApi";
import { useIsAdminOrHR } from "@/hooks/useUserRole";
import { useOnboardingRequests, OnboardingRequest } from "@/hooks/useOnboardingRequests";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate, useLocation } from "react-router-dom";
import { format } from "date-fns";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

// Fetch employees who are in onboarding status
const useOnboardingEmployees = () => {
  return useQuery({
    queryKey: ['onboarding-employees'],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: any[] }>("/api/employees?employment_status=Onboarding");
      return (res.data ?? []).map((emp: any) => ({
        ...emp,
        // normalize backend field names to match expected shape
        hire_date: emp.hire_date || emp.date_of_joining,
        departments: emp.departments || (emp.department_name ? { name: emp.department_name } : null),
      }));
    },
  });
};

// Fetch documents for a specific employee
const useEmployeeDocuments = (employeeId: string | null) => {
  return useQuery({
    queryKey: ['employee-documents', employeeId],
    queryFn: async () => {
      if (!employeeId) return [];
      const res = await hrmsApi.get<{ data: any[] }>(`/api/employee-docs/${employeeId}`);
      return res.data ?? [];
    },
    enabled: !!employeeId,
  });
};

// Fetch active employees who can be managers
const useManagers = () => {
  return useQuery({
    queryKey: ['managers'],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: any[] }>("/api/employees?employment_status=Active");
      return (res.data ?? []).map((emp: any) => ({
        id: emp.id,
        first_name: emp.first_name,
        last_name: emp.last_name,
      }));
    },
  });
};

// Fetch user IDs that are already linked to employees
const useLinkedUserIds = () => {
  return useQuery({
    queryKey: ['linked-user-ids'],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data: any[] }>("/api/employees");
      const employees = res.data ?? [];
      return new Set(employees.map((e: any) => e.user_id).filter(Boolean) as string[]);
    },
  });
};

// Fetch users without employee records (available to link)
const useUnlinkedUsers = () => {
  return useQuery({
    queryKey: ['unlinked-users'],
    queryFn: async () => {
      // Get all employees to determine which user IDs are already linked
      const res = await hrmsApi.get<{ data: any[] }>("/api/employees");
      const employees = res.data ?? [];
      const linkedUserIds = new Set(employees.map((e: any) => e.user_id).filter(Boolean));

      // Use active employees as a stand-in user list (those without an employee record linked)
      // Since profiles are stored in MySQL, return employees as "users"
      // that aren't already linked (i.e. users who have employee records but may need relinking)
      // For now, return an empty array — users will be created on invite
      return [] as Array<{ id: string; email: string; full_name: string; avatar_url: string | null }>;
    },
  });
};

// No longer needed - using useNextEmployeeCode hook instead

interface DocumentUpload {
  file: File | null;
  uploading: boolean;
  uploaded: boolean;
  url: string | null;
}

interface FormData {
  employeeCode: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  departmentId: string;
  designation: string;
  managerId: string;
  joinDate: string;
  salary: string;
  isDepartmentManager: boolean;
  linkedUserId: string;
  workingHoursStart: string;
  workingHoursEnd: string;
  workingDays: number[];
}

const WEEKDAYS = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
];

const initialFormData: FormData = {
  employeeCode: '',
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  address: '',
  departmentId: '',
  designation: '',
  managerId: '',
  joinDate: '',
  salary: '',
  isDepartmentManager: false,
  linkedUserId: '',
  workingHoursStart: '09:00',
  workingHoursEnd: '18:00',
  workingDays: [1, 2, 3, 4, 5], // Mon-Fri
};

const REQUIRED_DOCUMENT_TYPES = [
  { key: 'id_proof', label: 'ID Proof', accept: '.pdf,.jpg,.jpeg,.png' },
  { key: 'offer_letter', label: 'Offer Letter', accept: '.pdf,.doc,.docx' },
  { key: 'resume', label: 'Resume', accept: '.pdf,.doc,.docx' },
];

const ALL_DOCUMENT_TYPES = [
  { key: 'contract', label: 'Contract', accept: '.pdf,.doc,.docx' },
  ...REQUIRED_DOCUMENT_TYPES,
  { key: 'other', label: 'Others', accept: '.pdf,.doc,.docx,.jpg,.jpeg,.png' },
];

const initialDocuments: Record<string, DocumentUpload> = {
  id_proof: { file: null, uploading: false, uploaded: false, url: null },
  offer_letter: { file: null, uploading: false, uploaded: false, url: null },
  resume: { file: null, uploading: false, uploaded: false, url: null },
};

const Onboarding = () => {
  const currentLocation = useLocation();
  const searchParams = new URLSearchParams(currentLocation.search);
  const initialTab = searchParams.get('tab') || 'add';
  const [activeTab, setActiveTab] = useState(initialTab);
  const [selectedEmployee, setSelectedEmployee] = useState<any | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editFormData, setEditFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    address: '',
    departmentId: '',
    designation: '',
    managerId: '',
    joinDate: '',
    workingHoursStart: '09:00',
    workingHoursEnd: '18:00',
    workingDays: [1, 2, 3, 4, 5] as number[],
  });
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [documents, setDocuments] = useState<Record<string, DocumentUpload>>(initialDocuments);
  const [additionalDoc, setAdditionalDoc] = useState<{ file: File | null; type: string }>({ file: null, type: '' });
  const [isUploadingAdditional, setIsUploadingAdditional] = useState(false);
  const [resendingInvite, setResendingInvite] = useState<string | null>(null);
  
  // Requests tab state
  const [selectedRequest, setSelectedRequest] = useState<OnboardingRequest | null>(null);
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [requestToAction, setRequestToAction] = useState<OnboardingRequest | null>(null);
  const [rejectionRemarks, setRejectionRemarks] = useState("");
  
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isAdminOrHR, isLoading: roleLoading } = useIsAdminOrHR();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  
  const { data: departments = [], isLoading: loadingDepartments } = useDepartments();
  const { data: managers = [], isLoading: loadingManagers } = useManagers();
  const { data: onboardingEmployees = [], isLoading: loadingOnboarding } = useOnboardingEmployees();
  const { data: unlinkedUsers = [], isLoading: loadingUsers } = useUnlinkedUsers();
  const { data: linkedUserIds = new Set<string>() } = useLinkedUserIds();
  const { data: employeeDocs = [], isLoading: loadingDocs } = useEmployeeDocuments(selectedEmployee?.id || null);
  const { requests, isLoading: loadingRequests, approveRequest, rejectRequest } = useOnboardingRequests();
  const { data: nextEmployeeCode, isLoading: loadingNextCode } = useNextEmployeeCode();

  // Helper to check if an employee already exists for a user
  const hasEmployeeRecord = (userId: string) => linkedUserIds.has(userId);

  const pendingRequests = requests.filter((r) => r.status === "pending");
  const approvedRequests = requests.filter((r) => r.status === "approved");
  const rejectedRequests = requests.filter((r) => r.status === "rejected");

  // Get file URL for document viewing/download
  const getDocumentUrl = (filePath: string) => {
    if (!filePath) return null;
    const HRMS_API = import.meta.env.VITE_HRMS_API_URL || "http://localhost:5055";
    // Legacy URLs or full URLs — use as-is
    const isLegacyUrl = filePath.startsWith("https://") || filePath.startsWith("http://");
    return isLegacyUrl ? filePath : `${HRMS_API}/api/files/employee-documents/${filePath}`;
  };

  const handleViewDocument = async (filePath: string) => {
    const url = getDocumentUrl(filePath);
    if (url && (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("/"))) {
      window.open(url, '_blank', 'noopener noreferrer');
    }
  };

  const handleDownloadDocument = async (filePath: string, fileName: string) => {
    const url = getDocumentUrl(filePath);
    if (url) {
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const handleFileSelect = (docType: string, file: File | null) => {
    setDocuments(prev => ({
      ...prev,
      [docType]: { ...prev[docType], file, uploaded: false, url: null }
    }));
  };

  // Upload a single document
  const uploadDocument = async (employeeId: string, docType: string, file: File) => {
    const HRMS_API = import.meta.env.VITE_HRMS_API_URL || "http://localhost:5055";
    const token = getAuthToken();

    // Step 1: upload file to local storage
    const formData = new FormData();
    formData.append("file", file);
    const uploadResponse = await fetch(
      `${HRMS_API}/api/files/upload?category=employee-documents`,
      { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: formData }
    );
    if (!uploadResponse.ok) throw new Error("File upload failed");
    const uploadData = await uploadResponse.json();
    const publicUrl = `${HRMS_API}${uploadData.url}`;

    // Step 2: register metadata
    await hrmsApi.post(`/api/employee-docs/${employeeId}`, {
      document_type: docType,
      document_name: file.name,
      file_url: publicUrl,
    });

    return uploadData.filename;
  };

  // Upload additional document for existing employee
  const handleUploadAdditionalDocument = async () => {
    if (!selectedEmployee || !additionalDoc.file || !additionalDoc.type) {
      toast({
        title: "Error",
        description: "Please select a document type and file",
        variant: "destructive",
      });
      return;
    }

    setIsUploadingAdditional(true);
    try {
      await uploadDocument(selectedEmployee.id, additionalDoc.type, additionalDoc.file);
      queryClient.invalidateQueries({ queryKey: ['employee-documents', selectedEmployee.id] });
      setAdditionalDoc({ file: null, type: '' });
      toast({
        title: "Success",
        description: "Document uploaded successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to upload document",
        variant: "destructive",
      });
    } finally {
      setIsUploadingAdditional(false);
    }
  };

  const createEmployeeMutation = useMutation({
    mutationFn: async (data: FormData) => {
      // Get department name for notification
      const selectedDept = departments.find(d => d.id === data.departmentId);
      let linkedUserId = data.linkedUserId;
      let inviteSent = false;

      // If no linked user, create a user account for the employee
      if (!linkedUserId) {
        try {
          const invite = await hrmsApi.post<{ userId?: string; inviteSent?: boolean }>("/api/auth/invite-user", {
            email: data.email.trim(),
          });
          linkedUserId = invite.userId ?? linkedUserId;
          inviteSent = Boolean(invite.inviteSent);
        } catch (err) {
          console.error("Error inviting user account:", err);
          // Continue with employee creation even if user creation fails
        }
      }

      // Create employee — field names must match backend Zod schema (camelCase)
      const createRes = await hrmsApi.post<{ data: any }>("/api/employees", {
        employeeCode: data.employeeCode.trim().toUpperCase(),
        firstName: data.firstName.trim(),
        lastName: data.lastName.trim(),
        email: data.email.trim(),
        mobile: data.phone.trim() || null,
        dateOfJoining: data.joinDate,
        departmentId: data.departmentId || null,
        reportingManagerId: data.managerId || null,
        // designationId requires a UUID; free-text designation is not accepted by the schema
        // employmentStatus is not in createEmployeeSchema; we set it via PATCH after creation
      });
      const employee = createRes.data;

      // Set employment status to Onboarding via PATCH (updateEmployeeSchema accepts employmentStatus)
      await hrmsApi.patch(`/api/employees/${employee.id}`, { employmentStatus: "Onboarding" }).catch(() => {});

      // Upload documents
      const docsToUpload = Object.entries(documents).filter(([_, doc]) => doc.file);
      for (const [docType, doc] of docsToUpload) {
        if (doc.file) {
          try {
            await uploadDocument(employee.id, docType, doc.file);
          } catch (err) {
            console.error(`Failed to upload ${docType}:`, err);
          }
        }
      }

      // If salary is provided, create salary structure
      if (data.salary && parseFloat(data.salary) > 0) {
        await hrmsApi.post("/api/payroll/structures", {
          employee_id: employee.id,
          basic_salary: parseFloat(data.salary),
          effective_from: data.joinDate,
        }).catch(err => console.warn("Salary structure creation failed:", err.message));
      }

      // Send onboarding notification (fire and forget)
      hrmsApi.post("/api/communication/dispatch/send", {
        template_name: "employee_onboarding",
        recipient_employee_ids: [employee.id],
        data: {
          employee_name: `${data.firstName.trim()} ${data.lastName.trim()}`,
          department_name: selectedDept?.name || "",
          email: data.email.trim(),
        },
        channel: "email",
      }).catch(() => {});

      return { employee, inviteSent };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['onboarding-employees'] });
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      queryClient.invalidateQueries({ queryKey: ['unlinked-users'] });
      queryClient.invalidateQueries({ queryKey: ['linked-user-ids'] });
      queryClient.invalidateQueries({ queryKey: ['next-employee-code'] });
      setFormData(initialFormData);
      setDocuments(initialDocuments);
      setActiveTab('pending');
      toast({
        title: "Employee Added",
        description: result.inviteSent 
          ? "New employee has been added and an email invite has been sent to set up their account."
          : "New employee has been added to the onboarding queue.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add employee. Please try again.",
        variant: "destructive",
      });
    },
  });

  const activateEmployeeMutation = useMutation({
    mutationFn: async (employeeId: string) => {
      // Update employee status to active (camelCase field name per updateEmployeeSchema)
      await hrmsApi.patch(`/api/employees/${employeeId}`, { employmentStatus: "Active" });

      // Initialize leave balances for the current year
      const currentYear = new Date().getFullYear();
      const leaveTypesRes = await hrmsApi.get<{ data: any[] }>("/api/leave/types");
      const leaveTypes = leaveTypesRes.data ?? [];

      if (leaveTypes.length > 0) {
        const leaveBalances = leaveTypes.map((lt: any) => ({
          employee_id: employeeId,
          leave_type_id: lt.id,
          year: currentYear,
          allocated_days: lt.max_days_per_year || lt.days_per_year || 0,
        }));

        await hrmsApi.post("/api/leave/balance/seed", leaveBalances).catch(err => {
          console.error('Failed to initialize leave balances:', err);
        });
      }

      return employeeId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['onboarding-employees'] });
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      setSelectedEmployee(null);
      toast({
        title: "Employee Activated",
        description: "Employee has been marked as active and leave balances have been initialized.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to activate employee.",
        variant: "destructive",
      });
    },
  });

  const updateEmployeeMutation = useMutation({
    mutationFn: async (data: typeof editFormData & { id: string }) => {
      await hrmsApi.patch(`/api/employees/${data.id}`, {
        firstName: data.firstName.trim(),
        lastName: data.lastName.trim(),
        email: data.email.trim(),
        mobile: data.phone.trim() || null,
        departmentId: data.departmentId || null,
        reportingManagerId: data.managerId || null,
        dateOfJoining: data.joinDate,
        // designationId requires UUID; free-text designation skipped
      });
      return data.id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['onboarding-employees'] });
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      setIsEditing(false);
      setSelectedEmployee(null);
      toast({
        title: "Employee Updated",
        description: "Employee details have been updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update employee.",
        variant: "destructive",
      });
    },
  });

  // Resend invite handler
  const handleResendInvite = async (employee: any) => {
    setResendingInvite(employee.id);
    try {
      const invite = await hrmsApi.post<{ userId?: string; inviteSent?: boolean }>("/api/auth/invite-user", {
        email: employee.email,
        employeeId: employee.id,
      });
      const userId = invite.userId || null;

      // Link user account to employee record
      if (userId && !employee.user_id) {
        await hrmsApi.patch(`/api/employees/${employee.id}`, { userId }).catch(() => {});
        queryClient.invalidateQueries({ queryKey: ['onboarding-employees'] });
      }

      toast({
        title: "Invite Sent",
        description: invite.inviteSent
          ? `A password setup link has been sent to ${employee.email}.`
          : `A password setup token was created for ${employee.email}; SMTP is not configured.`,
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to resend invite.",
        variant: "destructive",
      });
    } finally {
      setResendingInvite(null);
    }
  };

  // Request handling functions - using SmartHR status badges
  const getRequestStatusBadge = (status: string) => {
    return <StatusBadge status={normalizeStatus(status)} />;
  };

  const getInitials = (name: string) => {
    return (name || "?")
      .split(" ")
      .map((n) => n[0] ?? "")
      .join("")
      .toUpperCase()
      .slice(0, 2) || "?";
  };

  const handleApproveRequest = (request: OnboardingRequest) => {
    setRequestToAction(request);
    setApproveDialogOpen(true);
  };

  const handleRejectRequest = (request: OnboardingRequest) => {
    setRequestToAction(request);
    setRejectionRemarks("");
    setRejectDialogOpen(true);
  };

  const confirmApprove = () => {
    if (requestToAction && user) {
      approveRequest.mutate({ requestId: requestToAction.id, userId: user.id });
      setApproveDialogOpen(false);
      setRequestToAction(null);
    }
  };

  const confirmReject = () => {
    if (requestToAction && user) {
      if (!rejectionRemarks.trim()) {
        toast({
          title: "Remarks Required",
          description: "Please provide remarks for rejection.",
          variant: "destructive",
        });
        return;
      }
      rejectRequest.mutate({
        requestId: requestToAction.id,
        userId: user.id,
        rejectionReason: rejectionRemarks.trim()
      });
      setRejectDialogOpen(false);
      setRequestToAction(null);
      setRejectionRemarks("");
    }
  };

  const handleCreateEmployeeFromRequest = (request: OnboardingRequest) => {
    // Switch to add tab with pre-filled data
    const nameParts = request.full_name.split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';
    
    setFormData(prev => ({
      ...prev,
      firstName,
      lastName,
      email: request.email,
      linkedUserId: request.user_id,
    }));
    setActiveTab('add');
  };

  const openEditMode = (employee: any) => {
    // Parse working hours from TIME format (HH:MM:SS) to input format (HH:MM)
    const parseTime = (time: string | null) => {
      if (!time) return '09:00';
      return time.substring(0, 5); // Extract HH:MM from HH:MM:SS
    };
    
    setEditFormData({
      firstName: employee.first_name || '',
      lastName: employee.last_name || '',
      email: employee.email || '',
      phone: employee.phone || '',
      address: employee.address || '',
      departmentId: employee.department_id || '',
      designation: employee.designation || '',
      managerId: employee.manager_id || '',
      joinDate: employee.hire_date || '',
      workingHoursStart: parseTime(employee.working_hours_start),
      workingHoursEnd: parseTime(employee.working_hours_end),
      workingDays: employee.working_days || [1, 2, 3, 4, 5],
    });
    setIsEditing(true);
  };

  const handleEditSubmit = () => {
    if (!selectedEmployee) return;
    
    if (!editFormData.firstName.trim()) {
      toast({ title: "Error", description: "First name is required", variant: "destructive" });
      return;
    }
    if (!editFormData.lastName.trim()) {
      toast({ title: "Error", description: "Last name is required", variant: "destructive" });
      return;
    }
    if (!editFormData.email.trim()) {
      toast({ title: "Error", description: "Email is required", variant: "destructive" });
      return;
    }
    if (!editFormData.designation.trim()) {
      toast({ title: "Error", description: "Designation is required", variant: "destructive" });
      return;
    }
    if (!editFormData.joinDate) {
      toast({ title: "Error", description: "Join date is required", variant: "destructive" });
      return;
    }

    updateEmployeeMutation.mutate({ ...editFormData, id: selectedEmployee.id });
  };

  if (roleLoading) {
    return (
      <DashboardLayout>
        <div className="flex min-h-[400px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  // Redirect non-admin/HR users
  if (!isAdminOrHR) {
    return (
      <DashboardLayout>
        <div className="flex min-h-[400px] flex-col items-center justify-center space-y-4">
          <ShieldAlert className="h-16 w-16 text-destructive" />
          <h2 className="text-2xl font-bold text-foreground">Access Denied</h2>
          <p className="text-muted-foreground">You don't have permission to access this page.</p>
          <p className="text-sm text-muted-foreground">Only administrators and HR personnel can manage onboarding.</p>
        </div>
      </DashboardLayout>
    );
  }

  const handleInputChange = (field: keyof FormData, value: string | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  // When a user is selected, auto-fill name and email
  const handleUserSelect = (userId: string) => {
    const actualUserId = userId === 'none' ? '' : userId;
    handleInputChange('linkedUserId', actualUserId);
    
    if (actualUserId) {
      const selectedUser = unlinkedUsers.find(u => u.id === actualUserId);
      if (selectedUser) {
        const nameParts = (selectedUser.full_name || '').split(' ');
        const firstName = nameParts[0] || '';
        const lastName = nameParts.slice(1).join(' ') || '';
        
        setFormData(prev => ({
          ...prev,
          linkedUserId: actualUserId,
          firstName: prev.firstName || firstName,
          lastName: prev.lastName || lastName,
          email: prev.email || selectedUser.email || '',
        }));
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Use next code if not set
    const codeToUse = formData.employeeCode.trim() || nextEmployeeCode || '';
    
    // Validation
    if (!codeToUse) {
      toast({ title: "Error", description: "Employee code is required", variant: "destructive" });
      return;
    }
    if (!isValidEmployeeCode(codeToUse)) {
      toast({ title: "Error", description: "Employee code must be in format ACQ001", variant: "destructive" });
      return;
    }
    if (!formData.firstName.trim()) {
      toast({ title: "Error", description: "First name is required", variant: "destructive" });
      return;
    }
    if (!formData.lastName.trim()) {
      toast({ title: "Error", description: "Last name is required", variant: "destructive" });
      return;
    }
    if (!formData.email.trim()) {
      toast({ title: "Error", description: "Email is required", variant: "destructive" });
      return;
    }
    if (!formData.designation.trim()) {
      toast({ title: "Error", description: "Designation is required", variant: "destructive" });
      return;
    }
    if (!formData.joinDate) {
      toast({ title: "Error", description: "Join date is required", variant: "destructive" });
      return;
    }
    if (!formData.isDepartmentManager && !formData.managerId) {
      toast({ title: "Error", description: "Reporting manager is required for non-department managers", variant: "destructive" });
      return;
    }

    createEmployeeMutation.mutate({ ...formData, employeeCode: codeToUse });
  };

  const isSubmitting = createEmployeeMutation.isPending;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid h-auto w-full grid-cols-1 gap-1 sm:h-10 sm:max-w-xl sm:grid-cols-3">
            <TabsTrigger value="add" className="w-full justify-center">
              <span className="hidden sm:inline">Add Employee</span>
              <span className="sm:hidden">Add</span>
            </TabsTrigger>
            <TabsTrigger value="pending" className="w-full justify-center">
              <span className="hidden sm:inline">Pending</span>
              <span className="sm:hidden">Pending</span>
              {(onboardingEmployees.length + approvedRequests.filter(r => !hasEmployeeRecord(r.user_id)).length) > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {onboardingEmployees.length + approvedRequests.filter(r => !hasEmployeeRecord(r.user_id)).length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="requests" className="w-full justify-center">
              <span className="hidden sm:inline">Requests</span>
              <span className="sm:hidden">Requests</span>
              {pendingRequests.length > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {pendingRequests.length}
                </Badge>
              )}
              {pendingRequests.length > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {pendingRequests.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="add" className="mt-6">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid gap-6 lg:grid-cols-2">
                {/* Personal Information */}
                <Card>
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                        <User className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <CardTitle className="text-lg">Personal Information</CardTitle>
                        <CardDescription>Basic details of the employee</CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Link User Account */}
                    <div className="space-y-2">
                      <Label htmlFor="linkedUser">Link to User Account</Label>
                      <Select 
                        disabled={loadingUsers || isSubmitting}
                        value={formData.linkedUserId}
                        onValueChange={handleUserSelect}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={loadingUsers ? "Loading..." : "Select user account (optional)"} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No linked account</SelectItem>
                          {unlinkedUsers.map((user) => (
                            <SelectItem key={user.id} value={user.id}>
                              {user.full_name || user.email} {user.full_name && `(${user.email})`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Link this employee to an existing user account so they can log in
                      </p>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="firstName">First Name *</Label>
                        <Input 
                          id="firstName" 
                          placeholder="John" 
                          value={formData.firstName}
                          onChange={(e) => handleInputChange('firstName', e.target.value)}
                          disabled={isSubmitting}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="lastName">Last Name *</Label>
                        <Input 
                          id="lastName" 
                          placeholder="Doe" 
                          value={formData.lastName}
                          onChange={(e) => handleInputChange('lastName', e.target.value)}
                          disabled={isSubmitting}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="email">Email Address *</Label>
                      <Input 
                        id="email" 
                        type="email" 
                        placeholder="john.doe@company.com" 
                        value={formData.email}
                        onChange={(e) => handleInputChange('email', e.target.value)}
                        disabled={isSubmitting}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="phone">Phone Number</Label>
                      <Input 
                        id="phone" 
                        placeholder="+1 (555) 000-0000" 
                        value={formData.phone}
                        onChange={(e) => handleInputChange('phone', e.target.value)}
                        disabled={isSubmitting}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="address">Address</Label>
                      <Textarea 
                        id="address" 
                        placeholder="Enter full address" 
                        rows={3} 
                        value={formData.address}
                        onChange={(e) => handleInputChange('address', e.target.value)}
                        disabled={isSubmitting}
                      />
                    </div>
                  </CardContent>
                </Card>

                {/* Job Information */}
                <Card>
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                        <Briefcase className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <CardTitle className="text-lg">Job Information</CardTitle>
                        <CardDescription>Role and department details</CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="employeeCode">Employee Number</Label>
                      <div className="relative">
                        <Hash className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="employeeCode"
                          value={formData.employeeCode || nextEmployeeCode || ''}
                          readOnly
                          disabled
                          className="pl-9 font-mono bg-slate-50 cursor-not-allowed"
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Auto-assigned on employee creation. Format: MAS##### / IDC##### / #####C
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="department">Department</Label>
                      <Select 
                        disabled={loadingDepartments || isSubmitting}
                        value={formData.departmentId}
                        onValueChange={(value) => handleInputChange('departmentId', value)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={loadingDepartments ? "Loading..." : "Select department"} />
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
                      <Label htmlFor="designation">Designation *</Label>
                      <Input 
                        id="designation" 
                        placeholder="e.g., Senior Developer" 
                        value={formData.designation}
                        onChange={(e) => handleInputChange('designation', e.target.value)}
                        disabled={isSubmitting}
                      />
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-border p-3">
                      <div className="space-y-0.5">
                        <Label htmlFor="isDeptManager">Department Manager</Label>
                        <p className="text-xs text-muted-foreground">
                          Tag this employee as the head of their department
                        </p>
                      </div>
                      <Switch
                        id="isDeptManager"
                        checked={formData.isDepartmentManager}
                        onCheckedChange={(checked) => handleInputChange('isDepartmentManager', checked)}
                        disabled={isSubmitting}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="manager">
                        Reporting Manager {!formData.isDepartmentManager && '*'}
                      </Label>
                      <Select 
                        disabled={loadingManagers || isSubmitting}
                        value={formData.managerId}
                        onValueChange={(value) => handleInputChange('managerId', value)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={loadingManagers ? "Loading..." : "Select manager"} />
                        </SelectTrigger>
                        <SelectContent>
                          {managers.map((manager) => (
                            <SelectItem key={manager.id} value={manager.id}>
                              {manager.first_name} {manager.last_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {!formData.isDepartmentManager && (
                        <p className="text-xs text-muted-foreground">
                          Required for employees who are not department managers
                        </p>
                      )}
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="joinDate">Join Date *</Label>
                        <Input 
                          id="joinDate" 
                          type="date" 
                          value={formData.joinDate}
                          onChange={(e) => handleInputChange('joinDate', e.target.value)}
                          disabled={isSubmitting}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="salary">Base Salary</Label>
                        <Input 
                          id="salary" 
                          type="number" 
                          placeholder="50000" 
                          value={formData.salary}
                          onChange={(e) => handleInputChange('salary', e.target.value)}
                          disabled={isSubmitting}
                        />
                      </div>
                    </div>
                    
                    {/* Working Hours Section */}
                    <div className="space-y-4 rounded-lg border border-border p-4">
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-primary" />
                        <Label className="text-base font-medium">Working Schedule</Label>
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="workingHoursStart">Start Time</Label>
                          <Input 
                            id="workingHoursStart" 
                            type="time" 
                            value={formData.workingHoursStart}
                            onChange={(e) => handleInputChange('workingHoursStart', e.target.value)}
                            disabled={isSubmitting}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="workingHoursEnd">End Time</Label>
                          <Input 
                            id="workingHoursEnd" 
                            type="time" 
                            value={formData.workingHoursEnd}
                            onChange={(e) => handleInputChange('workingHoursEnd', e.target.value)}
                            disabled={isSubmitting}
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Working Days</Label>
                        <div className="flex flex-wrap gap-2">
                          {WEEKDAYS.map((day) => (
                            <Button
                              key={day.value}
                              type="button"
                              variant={formData.workingDays.includes(day.value) ? "default" : "outline"}
                              size="sm"
                              disabled={isSubmitting}
                              onClick={() => {
                                const newDays = formData.workingDays.includes(day.value)
                                  ? formData.workingDays.filter(d => d !== day.value)
                                  : [...formData.workingDays, day.value].sort((a, b) => a - b);
                                setFormData(prev => ({ ...prev, workingDays: newDays }));
                              }}
                            >
                              {day.label}
                            </Button>
                          ))}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Select the days this employee will work
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Documents */}
                <Card className="lg:col-span-2">
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                        <FileText className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <CardTitle className="text-lg">Documents</CardTitle>
                        <CardDescription>Upload required documents (optional)</CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-4 sm:grid-cols-3">
                      {REQUIRED_DOCUMENT_TYPES.map((docType) => {
                        const doc = documents[docType.key];
                        return (
                          <label
                            key={docType.key}
                            className={`relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 transition-colors cursor-pointer ${
                              doc.file 
                                ? 'border-primary bg-primary/5' 
                                : 'border-border hover:border-primary hover:bg-primary/5'
                            } ${isSubmitting ? 'opacity-50 pointer-events-none' : ''}`}
                          >
                            <input
                              type="file"
                              accept={docType.accept}
                              className="sr-only"
                              disabled={isSubmitting}
                              onChange={(e) => {
                                const file = e.target.files?.[0] || null;
                                handleFileSelect(docType.key, file);
                              }}
                            />
                            {doc.file ? (
                              <>
                                <Check className="mb-2 h-8 w-8 text-primary" />
                                <p className="text-sm font-medium text-foreground truncate max-w-full px-2">
                                  {doc.file.name}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {(doc.file.size / 1024).toFixed(1)} KB
                                </p>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="absolute top-2 right-2 h-6 w-6"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handleFileSelect(docType.key, null);
                                  }}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </>
                            ) : (
                              <>
                                <Upload className="mb-2 h-8 w-8 text-muted-foreground" />
                                <p className="text-sm font-medium text-foreground">{docType.label}</p>
                                <p className="text-xs text-muted-foreground">Click to upload</p>
                              </>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="flex justify-end gap-3">
                <Button 
                  variant="outline" 
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => {
                    setFormData(initialFormData);
                    setDocuments(initialDocuments);
                  }}
                >
                  Clear Form
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Add Employee
                </Button>
              </div>
            </form>
          </TabsContent>

          <TabsContent value="pending" className="mt-6">
            <div className="space-y-4">
              {/* Approved requests awaiting employee creation */}
              {approvedRequests.filter(r => !hasEmployeeRecord(r.user_id)).length > 0 && (
                <>
                  <h3 className="text-sm font-medium text-muted-foreground">Approved Requests – Awaiting Employee Creation</h3>
                  {approvedRequests.filter(r => !hasEmployeeRecord(r.user_id)).map((request) => (
                    <Card key={request.id}>
                      <CardContent className="p-6">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex items-center gap-4">
                            <Avatar className="h-12 w-12">
                              <AvatarFallback>{getInitials(request.full_name)}</AvatarFallback>
                            </Avatar>
                            <div>
                              <h3 className="font-semibold text-foreground">{request.full_name}</h3>
                              <p className="text-sm text-muted-foreground">
                                {request.email} · Approved on {(request.reviewed_at || request.updated_at) ? format(new Date(request.reviewed_at || request.updated_at), "MMM d, yyyy") : "—"}
                              </p>
                              {request.message && (
                                <p className="text-xs text-muted-foreground mt-1 italic">"{request.message}"</p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
                            <Badge variant="default" className="bg-primary/10 text-primary hover:bg-primary/10">Approved</Badge>
                            <Button 
                              size="sm"
                              onClick={() => handleCreateEmployeeFromRequest(request)}
                            >
                              <UserPlus className="mr-2 h-4 w-4" />
                              Create Employee
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </>
              )}

              {/* Existing onboarding employees */}
              {onboardingEmployees.length > 0 && (
                <>
                  <h3 className="text-sm font-medium text-muted-foreground">Employees in Onboarding</h3>
                  {onboardingEmployees.map((employee) => {
                    const name = `${employee.first_name} ${employee.last_name}`;
                    const departmentName = employee.departments?.name || 'Unassigned';
                    const hireDate = employee.hire_date
                      ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(employee.hire_date) ? `${employee.hire_date}T00:00:00` : employee.hire_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                      : 'TBD';
                    
                    return (
                      <Card key={employee.id}>
                        <CardContent className="p-6">
                          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex items-center gap-4">
                              <Avatar className="h-12 w-12">
                                <AvatarImage src={employee.avatar_url || undefined} />
                                <AvatarFallback>
                                  {name.split(" ").map((n) => n[0]).join("")}
                                </AvatarFallback>
                              </Avatar>
                              <div>
                                <h3 className="font-semibold text-foreground">{name}</h3>
                                <p className="text-sm text-muted-foreground">
                                  {departmentName} · Starts {hireDate}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
                              <Badge variant="secondary">Onboarding</Badge>
                              <Button 
                                variant="ghost" 
                                size="sm"
                                onClick={() => handleResendInvite(employee)}
                                disabled={resendingInvite === employee.id}
                                title="Resend login invitation email"
                              >
                                {resendingInvite === employee.id ? (
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                  <Send className="mr-2 h-4 w-4" />
                                )}
                                {resendingInvite === employee.id ? 'Sending...' : 'Resend Invite'}
                              </Button>
                              <Button 
                                variant="outline" 
                                size="sm"
                                onClick={() => setSelectedEmployee(employee)}
                              >
                                View Details
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </>
              )}

              {/* Empty state */}
              {loadingOnboarding || loadingRequests ? (
                <Card>
                  <CardContent className="p-6 text-center text-muted-foreground">
                    Loading...
                  </CardContent>
                </Card>
              ) : onboardingEmployees.length === 0 && approvedRequests.filter(r => !hasEmployeeRecord(r.user_id)).length === 0 ? (
                <Card>
                  <CardContent className="p-6 text-center text-muted-foreground">
                    No employees currently in onboarding
                  </CardContent>
                </Card>
              ) : null}
            </div>
          </TabsContent>

          {/* Requests Tab */}
          <TabsContent value="requests" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>Join Requests</CardTitle>
                <CardDescription>
                  Review onboarding requests from users who have signed up
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loadingRequests ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  </div>
                ) : requests.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <UserPlus className="mb-4 h-12 w-12 text-muted-foreground" />
                    <h3 className="text-lg font-semibold text-foreground">No Requests</h3>
                    <p className="text-muted-foreground">
                      There are no onboarding requests at this time
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Stats */}
                    <div className="grid gap-4 sm:grid-cols-3 mb-6">
                      <Card>
                        <CardContent className="pt-4 pb-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-2xl font-bold">{pendingRequests.length}</p>
                              <p className="text-xs text-muted-foreground">Pending</p>
                            </div>
                            <Clock className="h-5 w-5 text-muted-foreground" />
                          </div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-4 pb-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-2xl font-bold">{approvedRequests.length}</p>
                              <p className="text-xs text-muted-foreground">Approved</p>
                            </div>
                            <CheckCircle2 className="h-5 w-5 text-green-600" />
                          </div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-4 pb-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-2xl font-bold">{rejectedRequests.length}</p>
                              <p className="text-xs text-muted-foreground">Rejected</p>
                            </div>
                            <XCircle className="h-5 w-5 text-destructive" />
                          </div>
                        </CardContent>
                      </Card>
                    </div>

                    {/* Requests Table */}
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>User</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead className="hidden md:table-cell">Message</TableHead>
                          <TableHead className="hidden sm:table-cell">Submitted</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {requests.map((request) => (
                          <TableRow key={request.id}>
                            <TableCell>
                              <div className="flex items-center gap-3">
                                <Avatar className="h-8 w-8">
                                  <AvatarFallback>{getInitials(request.full_name)}</AvatarFallback>
                                </Avatar>
                                <span className="font-medium">{request.full_name}</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-muted-foreground">{request.email}</TableCell>
                            <TableCell className="hidden md:table-cell max-w-[200px] truncate text-muted-foreground">
                              {request.message || "-"}
                            </TableCell>
                            <TableCell className="hidden sm:table-cell text-muted-foreground">
                              {request.created_at ? format(new Date(request.created_at), "MMM d, yyyy") : "—"}
                            </TableCell>
                            <TableCell>{getRequestStatusBadge(request.status)}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setSelectedRequest(request)}
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                                {request.status === "pending" && (
                                  <>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="text-green-600 hover:bg-green-50 hover:text-green-700"
                                      onClick={() => handleApproveRequest(request)}
                                      disabled={approveRequest.isPending}
                                    >
                                      <Check className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="text-destructive hover:bg-destructive/10"
                                      onClick={() => handleRejectRequest(request)}
                                      disabled={rejectRequest.isPending}
                                    >
                                      <X className="h-4 w-4" />
                                    </Button>
                                  </>
                                )}
                                {request.status === "approved" && !hasEmployeeRecord(request.user_id) && (
                                  <Button
                                    size="sm"
                                    onClick={() => handleCreateEmployeeFromRequest(request)}
                                  >
                                    <UserPlus className="mr-1 h-4 w-4" />
                                    <span className="hidden sm:inline">Create Employee</span>
                                  </Button>
                                )}
                                {request.status === "approved" && hasEmployeeRecord(request.user_id) && (
                                  <Badge variant="secondary" className="text-xs">
                                    <CheckCircle2 className="mr-1 h-3 w-3" />
                                    Created
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Employee Details Dialog */}
        <Dialog 
          open={!!selectedEmployee} 
          onOpenChange={(open) => {
            if (!open) {
              setSelectedEmployee(null);
              setIsEditing(false);
            }
          }}
        >
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{isEditing ? 'Edit Employee' : 'Employee Details'}</DialogTitle>
              <DialogDescription>
                {isEditing ? 'Update onboarding employee information' : 'Onboarding employee information'}
              </DialogDescription>
            </DialogHeader>
            {selectedEmployee && !isEditing && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <Avatar className="h-16 w-16">
                      <AvatarImage src={selectedEmployee.avatar_url || undefined} />
                      <AvatarFallback className="text-lg">
                        {`${selectedEmployee.first_name} ${selectedEmployee.last_name}`.split(" ").map((n: string) => n[0]).join("")}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <h3 className="text-lg font-semibold">{selectedEmployee.first_name} {selectedEmployee.last_name}</h3>
                      <p className="text-sm text-muted-foreground">{selectedEmployee.designation || 'No designation'}</p>
                    </div>
                  </div>
                  <Button variant="outline" size="icon" onClick={() => openEditMode(selectedEmployee)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                </div>
                
                <div className="space-y-3 rounded-lg border p-4">
                  <div className="flex items-center gap-3">
                    <Briefcase className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">Department</p>
                      <p className="text-sm font-medium">{selectedEmployee.departments?.name || 'Unassigned'}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">Start Date</p>
                      <p className="text-sm font-medium">
                        {selectedEmployee.hire_date
                          ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(selectedEmployee.hire_date) ? `${selectedEmployee.hire_date}T00:00:00` : selectedEmployee.hire_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
                          : 'TBD'}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">Email</p>
                      <p className="text-sm font-medium">{selectedEmployee.email || '-'}</p>
                    </div>
                  </div>
                  
                  {selectedEmployee.phone && (
                    <div className="flex items-center gap-3">
                      <Phone className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-xs text-muted-foreground">Phone</p>
                        <p className="text-sm font-medium">{selectedEmployee.phone}</p>
                      </div>
                    </div>
                  )}
                  
                  {selectedEmployee.address && (
                    <div className="flex items-center gap-3">
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-xs text-muted-foreground">Address</p>
                        <p className="text-sm font-medium">{selectedEmployee.address}</p>
                      </div>
                    </div>
                  )}
                  
                  {/* Working Schedule */}
                  <div className="flex items-start gap-3">
                    <Clock className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Working Schedule</p>
                      <p className="text-sm font-medium">
                        {selectedEmployee.working_hours_start?.substring(0, 5) || '09:00'} - {selectedEmployee.working_hours_end?.substring(0, 5) || '18:00'}
                      </p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {WEEKDAYS.map((day) => {
                          const isWorkingDay = (selectedEmployee.working_days || [1, 2, 3, 4, 5]).includes(day.value);
                          return (
                            <Badge
                              key={day.value}
                              variant={isWorkingDay ? "default" : "outline"}
                              className={`text-xs px-2 py-0 ${!isWorkingDay ? 'opacity-40' : ''}`}
                            >
                              {day.label}
                            </Badge>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* Documents Section */}
                <div className="space-y-3">
                  <p className="text-sm font-medium text-foreground flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Documents
                  </p>
                  {loadingDocs ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                  ) : employeeDocs.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-2">No documents uploaded</p>
                  ) : (
                    <div className="space-y-2">
                      {employeeDocs.map((doc) => {
                        const docTypeLabel = ALL_DOCUMENT_TYPES.find(d => d.key === doc.document_type)?.label || doc.document_type;
                        return (
                          <div
                            key={doc.id}
                            className="flex items-center justify-between rounded-lg border p-3"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate">{docTypeLabel}</p>
                                <p className="text-xs text-muted-foreground truncate">{doc.document_name}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => handleViewDocument(doc.file_url)}
                                title="View"
                              >
                                <ExternalLink className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => handleDownloadDocument(doc.file_url, doc.document_name)}
                                title="Download"
                              >
                                <Download className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  
                  {/* Upload Additional Document */}
                  <div className="space-y-3 pt-2 border-t">
                    <p className="text-xs font-medium text-muted-foreground">Upload Additional Document</p>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Select
                        value={additionalDoc.type}
                        onValueChange={(value) => setAdditionalDoc(prev => ({ ...prev, type: value }))}
                        disabled={isUploadingAdditional}
                      >
                        <SelectTrigger className="w-full sm:w-[140px]">
                          <SelectValue placeholder="Type" />
                        </SelectTrigger>
                        <SelectContent>
                          {ALL_DOCUMENT_TYPES.map((docType) => (
                            <SelectItem key={docType.key} value={docType.key}>
                              {docType.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="flex gap-2 flex-1">
                        <Input
                          type="file"
                          accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                          disabled={isUploadingAdditional}
                          onChange={(e) => setAdditionalDoc(prev => ({ ...prev, file: e.target.files?.[0] || null }))}
                          className="text-xs flex-1 min-w-0"
                        />
                        <Button
                          size="sm"
                          onClick={handleUploadAdditionalDocument}
                          disabled={isUploadingAdditional || !additionalDoc.file || !additionalDoc.type}
                        >
                          {isUploadingAdditional ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Upload className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                    {additionalDoc.file && (
                      <p className="text-xs text-muted-foreground truncate">
                        Selected: {additionalDoc.file.name}
                      </p>
                    )}
                  </div>
                </div>
                
                <div className="flex items-center justify-between pt-2">
                  <Badge variant="secondary">Onboarding</Badge>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button 
                        size="sm"
                        disabled={activateEmployeeMutation.isPending}
                      >
                        {activateEmployeeMutation.isPending ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <CheckCircle2 className="mr-2 h-4 w-4" />
                        )}
                        Activate Employee
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Activate Employee</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will mark {selectedEmployee.first_name} {selectedEmployee.last_name} as an active employee and initialize their leave balances for the current year. Are you sure?
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => activateEmployeeMutation.mutate(selectedEmployee.id)}
                        >
                          Activate
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            )}
            
            {selectedEmployee && isEditing && (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="edit-firstName">First Name *</Label>
                    <Input
                      id="edit-firstName"
                      value={editFormData.firstName}
                      onChange={(e) => setEditFormData({ ...editFormData, firstName: e.target.value })}
                      disabled={updateEmployeeMutation.isPending}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-lastName">Last Name *</Label>
                    <Input
                      id="edit-lastName"
                      value={editFormData.lastName}
                      onChange={(e) => setEditFormData({ ...editFormData, lastName: e.target.value })}
                      disabled={updateEmployeeMutation.isPending}
                    />
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="edit-email">Email *</Label>
                  <Input
                    id="edit-email"
                    type="email"
                    value={editFormData.email}
                    onChange={(e) => setEditFormData({ ...editFormData, email: e.target.value })}
                    disabled={updateEmployeeMutation.isPending}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="edit-phone">Phone</Label>
                  <Input
                    id="edit-phone"
                    value={editFormData.phone}
                    onChange={(e) => setEditFormData({ ...editFormData, phone: e.target.value })}
                    disabled={updateEmployeeMutation.isPending}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="edit-designation">Designation *</Label>
                  <Input
                    id="edit-designation"
                    value={editFormData.designation}
                    onChange={(e) => setEditFormData({ ...editFormData, designation: e.target.value })}
                    disabled={updateEmployeeMutation.isPending}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="edit-department">Department</Label>
                  <Select
                    value={editFormData.departmentId}
                    onValueChange={(value) => setEditFormData({ ...editFormData, departmentId: value })}
                    disabled={updateEmployeeMutation.isPending || loadingDepartments}
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
                  <Label htmlFor="edit-manager">Manager</Label>
                  <Select
                    value={editFormData.managerId}
                    onValueChange={(value) => setEditFormData({ ...editFormData, managerId: value === 'none' ? '' : value })}
                    disabled={updateEmployeeMutation.isPending || loadingManagers}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select manager" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No manager</SelectItem>
                      {managers.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.first_name} {m.last_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="edit-joinDate">Join Date *</Label>
                  <Input
                    id="edit-joinDate"
                    type="date"
                    value={editFormData.joinDate}
                    onChange={(e) => setEditFormData({ ...editFormData, joinDate: e.target.value })}
                    disabled={updateEmployeeMutation.isPending}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="edit-address">Address</Label>
                  <Textarea
                    id="edit-address"
                    value={editFormData.address}
                    onChange={(e) => setEditFormData({ ...editFormData, address: e.target.value })}
                    disabled={updateEmployeeMutation.isPending}
                    rows={2}
                  />
                </div>
                
                {/* Working Hours Section */}
                <div className="space-y-4 rounded-lg border border-border p-4">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-primary" />
                    <Label className="text-base font-medium">Working Schedule</Label>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="edit-workingHoursStart">Start Time</Label>
                      <Input 
                        id="edit-workingHoursStart" 
                        type="time" 
                        value={editFormData.workingHoursStart}
                        onChange={(e) => setEditFormData({ ...editFormData, workingHoursStart: e.target.value })}
                        disabled={updateEmployeeMutation.isPending}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="edit-workingHoursEnd">End Time</Label>
                      <Input 
                        id="edit-workingHoursEnd" 
                        type="time" 
                        value={editFormData.workingHoursEnd}
                        onChange={(e) => setEditFormData({ ...editFormData, workingHoursEnd: e.target.value })}
                        disabled={updateEmployeeMutation.isPending}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Working Days</Label>
                    <div className="flex flex-wrap gap-2">
                      {WEEKDAYS.map((day) => (
                        <Button
                          key={day.value}
                          type="button"
                          variant={editFormData.workingDays.includes(day.value) ? "default" : "outline"}
                          size="sm"
                          disabled={updateEmployeeMutation.isPending}
                          onClick={() => {
                            const newDays = editFormData.workingDays.includes(day.value)
                              ? editFormData.workingDays.filter(d => d !== day.value)
                              : [...editFormData.workingDays, day.value].sort((a, b) => a - b);
                            setEditFormData({ ...editFormData, workingDays: newDays });
                          }}
                        >
                          {day.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
                
                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    variant="outline"
                    onClick={() => setIsEditing(false)}
                    disabled={updateEmployeeMutation.isPending}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleEditSubmit}
                    disabled={updateEmployeeMutation.isPending}
                  >
                    {updateEmployeeMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save Changes
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Request Details Dialog */}
        <Dialog open={!!selectedRequest} onOpenChange={(open) => !open && setSelectedRequest(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Request Details</DialogTitle>
              <DialogDescription>
                Onboarding request from {selectedRequest?.full_name}
              </DialogDescription>
            </DialogHeader>
            {selectedRequest && (
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <Avatar className="h-16 w-16">
                    <AvatarFallback className="text-lg">
                      {getInitials(selectedRequest.full_name)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <h3 className="text-lg font-semibold">{selectedRequest.full_name}</h3>
                    <p className="text-muted-foreground">{selectedRequest.email}</p>
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground">Status</h4>
                  <div className="mt-1">{getRequestStatusBadge(selectedRequest.status)}</div>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground">Message</h4>
                  <p className="mt-1 text-foreground">
                    {selectedRequest.message || "No message provided"}
                  </p>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground">Submitted</h4>
                  <p className="mt-1 text-foreground">
                    {format(new Date(selectedRequest.created_at), "MMMM d, yyyy 'at' h:mm a")}
                  </p>
                </div>
                {selectedRequest.reviewed_at && (
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground">Reviewed</h4>
                    <p className="mt-1 text-foreground">
                      {format(new Date(selectedRequest.reviewed_at), "MMMM d, yyyy 'at' h:mm a")}
                    </p>
                  </div>
                )}
              </div>
            )}
            <DialogFooter>
              {selectedRequest?.status === "pending" && (
                <>
                  <Button
                    variant="outline"
                    className="text-destructive"
                    onClick={() => {
                      handleRejectRequest(selectedRequest);
                      setSelectedRequest(null);
                    }}
                  >
                    <X className="mr-2 h-4 w-4" />
                    Reject
                  </Button>
                  <Button
                    onClick={() => {
                      handleApproveRequest(selectedRequest);
                      setSelectedRequest(null);
                    }}
                  >
                    <Check className="mr-2 h-4 w-4" />
                    Approve
                  </Button>
                </>
              )}
              {selectedRequest?.status === "approved" && (
                <Button onClick={() => {
                  handleCreateEmployeeFromRequest(selectedRequest);
                  setSelectedRequest(null);
                }}>
                  <UserPlus className="mr-2 h-4 w-4" />
                  Create Employee Record
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Approve Request Confirmation Dialog */}
        <AlertDialog open={approveDialogOpen} onOpenChange={setApproveDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Approve Request</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to approve the onboarding request from{" "}
                <strong>{requestToAction?.full_name}</strong>? You will then be able to create
                an employee record for them.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={confirmApprove}>
                {approveRequest.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Check className="mr-2 h-4 w-4" />
                )}
                Approve
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Reject Request Confirmation Dialog */}
        <AlertDialog open={rejectDialogOpen} onOpenChange={(open) => {
          setRejectDialogOpen(open);
          if (!open) setRejectionRemarks("");
        }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reject Request</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to reject the onboarding request from{" "}
                <strong>{requestToAction?.full_name}</strong>? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="my-4">
              <label htmlFor="rejection-remarks" className="text-sm font-medium text-slate-900">
                Remarks <span className="text-red-500">*</span>
              </label>
              <textarea
                id="rejection-remarks"
                className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
                rows={4}
                placeholder="Please provide a reason for rejection..."
                value={rejectionRemarks}
                onChange={(e) => setRejectionRemarks(e.target.value)}
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setRejectionRemarks("")}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={confirmReject}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {rejectRequest.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <X className="mr-2 h-4 w-4" />
                )}
                Reject
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </DashboardLayout>
  );
};

export default Onboarding;
