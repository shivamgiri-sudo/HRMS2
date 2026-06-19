import { useState, useEffect } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
import { useSearchParams } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, User, Mail, Phone, MapPin, Building2, Calendar, Briefcase, Save, Shield, FileText, Clock, Wallet, Files, Package, Star, Camera, Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { EmployeeDocuments } from "@/components/documents/EmployeeDocuments";
import { LeaveBalanceCard } from "@/components/profile/LeaveBalanceCard";
import { LeaveRequestForm } from "@/components/profile/LeaveRequestForm";
import { LeaveRequestHistory } from "@/components/profile/LeaveRequestHistory";
import { PayslipViewer } from "@/components/profile/PayslipViewer";
import { TaxDocumentsViewer } from "@/components/profile/TaxDocumentsViewer";
import { MyAttendanceHistory } from "@/components/profile/MyAttendanceHistory";
import { AttendanceCalendar } from "@/components/attendance/AttendanceCalendar";
import { MyAssets } from "@/components/profile/MyAssets";
import { MyPerformanceReviews } from "@/components/profile/MyPerformanceReviews";

interface EmployeeProfile {
  id: string;
  employee_code: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  designation: string;
  hire_date: string;
  date_of_birth: string | null;
  gender: string | null;
  status: string;
  department: { name: string } | null;
  working_hours_start: string | null;
  working_hours_end: string | null;
  working_days: number[] | null;
}

interface ProfileForm {
  phone: string;
  address: string;
  city: string;
  country: string;
  date_of_birth: string;
  gender: string;
  working_hours_start: string;
  working_hours_end: string;
  working_days: number[];
}

const Profile = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const tabParam = (searchParams.get("tab") || "").toLowerCase();
  const allowedTabs = ["profile", "leaves", "attendance", "assets", "reviews", "payslips", "documents"] as const;
  const initialTab = allowedTabs.includes(tabParam as (typeof allowedTabs)[number]) ? tabParam : "profile";

  const [activeTab, setActiveTab] = useState<string>(initialTab);
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState<ProfileForm>({
    phone: '',
    address: '',
    city: '',
    country: '',
    date_of_birth: '',
    gender: '',
    working_hours_start: '09:00',
    working_hours_end: '18:00',
    working_days: [1, 2, 3, 4, 5],
  });

  useEffect(() => {
    if (allowedTabs.includes(tabParam as (typeof allowedTabs)[number]) && tabParam !== activeTab) {
      setActiveTab(tabParam);
    }
  }, [tabParam, activeTab]);

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("tab", value);
      return next;
    });
  };

  // Fetch employee profile linked to current user
  const { data: employee, isLoading } = useQuery({
    queryKey: ['my-profile', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const res = await hrmsApi.get<{ success: boolean; data: any }>('/api/employees/me');
      return res.data ?? null;
    },
    enabled: !!user?.id,
  });

  const userProfile = employee;

  useEffect(() => {
    if (employee) {
      // Format time from "HH:MM:SS" to "HH:MM" for input
      const formatTimeForInput = (time: string | null) => {
        if (!time) return '';
        return time.slice(0, 5);
      };
      
      setFormData({
        phone: employee.phone || '',
        address: employee.address || '',
        city: employee.city || '',
        country: employee.country || '',
        date_of_birth: employee.date_of_birth ? String(employee.date_of_birth).slice(0, 10) : '',
        gender: employee.gender || '',
        working_hours_start: formatTimeForInput(employee.working_hours_start) || '09:00',
        working_hours_end: formatTimeForInput(employee.working_hours_end) || '18:00',
        working_days: employee.working_days || [1, 2, 3, 4, 5],
      });
    }
  }, [employee]);

  const updateProfileMutation = useMutation({
    mutationFn: async (data: ProfileForm) => {
      await hrmsApi.patch('/api/employees/me', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-profile'] });
      setIsEditing(false);
      toast({ title: "Profile updated", description: "Your information has been saved." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const uploadPhotoMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('photo', file);
      const token = localStorage.getItem("hrms_access_token");
      const HRMS_API = import.meta.env.VITE_HRMS_API_URL || "http://localhost:5055";
      const resp = await fetch(`${HRMS_API}/api/employees/me/photo`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (!resp.ok) {
        const error = await resp.json().catch(() => ({ message: `Upload failed: ${resp.status}` }));
        throw new Error(error.message || 'Upload failed');
      }
      return resp.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-profile'] });
      toast({ title: "Success", description: "Profile photo updated successfully." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(file.type)) {
      toast({ title: "Error", description: "Please upload a JPG, PNG, or WebP image.", variant: "destructive" });
      return;
    }

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "Error", description: "Image must be less than 5MB.", variant: "destructive" });
      return;
    }

    uploadPhotoMutation.mutate(file);
  };

  const handleSave = () => {
    updateProfileMutation.mutate(formData);
  };

  const getUserInitials = () => {
    if (employee) {
      return `${employee.first_name[0]}${employee.last_name[0]}`.toUpperCase();
    }
    return user?.email?.slice(0, 2).toUpperCase() || "U";
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex min-h-[400px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">Account</p>
          <h2 className="mt-1 text-3xl font-black text-slate-950">My Profile</h2>
          <p className="text-slate-600">View and manage your personal information</p>
        </div>

        {!employee ? (
          <Card className="rounded-3xl border bg-white p-5 shadow-sm">
            <CardContent className="py-12 text-center">
              <User className="mx-auto h-12 w-12 text-slate-400" />
              <h3 className="mt-4 text-lg font-semibold">No Employee Profile</h3>
              <p className="mt-2 text-muted-foreground">
                Your account is not linked to an employee profile yet. Please contact HR.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
            <TabsList className="flex flex-wrap h-auto gap-1 w-full lg:w-auto lg:inline-flex">
              <TabsTrigger value="profile" className="gap-2">
                <User className="h-4 w-4" />
                <span className="hidden sm:inline">Profile</span>
              </TabsTrigger>
              <TabsTrigger value="leaves" className="gap-2">
                <Calendar className="h-4 w-4" />
                <span className="hidden sm:inline">Leaves</span>
              </TabsTrigger>
              <TabsTrigger value="attendance" className="gap-2">
                <Clock className="h-4 w-4" />
                <span className="hidden sm:inline">Attendance</span>
              </TabsTrigger>
              <TabsTrigger value="assets" className="gap-2">
                <Package className="h-4 w-4" />
                <span className="hidden sm:inline">Assets</span>
              </TabsTrigger>
              <TabsTrigger value="reviews" className="gap-2">
                <Star className="h-4 w-4" />
                <span className="hidden sm:inline">Reviews</span>
              </TabsTrigger>
              <TabsTrigger value="payslips" className="gap-2">
                <Wallet className="h-4 w-4" />
                <span className="hidden sm:inline">Payslips</span>
              </TabsTrigger>
              <TabsTrigger value="documents" className="gap-2">
                <Files className="h-4 w-4" />
                <span className="hidden sm:inline">Documents</span>
              </TabsTrigger>
            </TabsList>

            {/* Profile Tab */}
            <TabsContent value="profile" className="space-y-6">
              <div className="grid gap-6 md:grid-cols-3">
                {/* Profile Card */}
                <Card className="md:col-span-1">
                  <CardContent className="pt-6">
                    <div className="flex flex-col items-center text-center">
                      <div className="relative">
                        <Avatar className="h-24 w-24">
                          <AvatarImage src={userProfile?.avatar_url || undefined} />
                          <AvatarFallback className="text-2xl">{getUserInitials()}</AvatarFallback>
                        </Avatar>
                        <label
                          htmlFor="photo-upload"
                          className="absolute bottom-0 right-0 cursor-pointer rounded-full bg-primary p-2 text-primary-foreground shadow-lg hover:bg-primary/90 transition-colors"
                          title="Upload profile photo"
                        >
                          {uploadPhotoMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Camera className="h-4 w-4" />
                          )}
                        </label>
                        <input
                          id="photo-upload"
                          type="file"
                          accept="image/jpeg,image/jpg,image/png,image/webp"
                          onChange={handlePhotoUpload}
                          disabled={uploadPhotoMutation.isPending}
                          className="sr-only"
                        />
                      </div>
                      <h3 className="mt-4 text-xl font-semibold">
                        {employee.first_name} {employee.last_name}
                      </h3>
                      <p className="text-muted-foreground">{employee.designation}</p>
                      <Badge className="mt-2" variant={employee.status === 'active' ? 'default' : 'secondary'}>
                        {employee.status}
                      </Badge>
                      <Separator className="my-4 w-full" />
                      <div className="w-full space-y-3 text-left text-sm">
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Mail className="h-4 w-4" />
                          <span className="truncate">{employee.email}</span>
                        </div>
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Building2 className="h-4 w-4" />
                          <span>{employee.department?.name || "No Department"}</span>
                        </div>
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Briefcase className="h-4 w-4" />
                          <span>{employee.employee_code}</span>
                        </div>
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Calendar className="h-4 w-4" />
                          <span>Joined {formatDate(employee.hire_date)}</span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Details Card */}
                <Card className="md:col-span-2">
                  <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                      <CardTitle>Personal Information</CardTitle>
                      <CardDescription>Update your contact details</CardDescription>
                    </div>
                    {!isEditing ? (
                      <Button variant="outline" className="cursor-pointer rounded-2xl" onClick={() => setIsEditing(true)}>
                        Edit
                      </Button>
                    ) : (
                      <div className="flex gap-2">
                        <Button variant="outline" className="cursor-pointer rounded-2xl" onClick={() => {
                          setIsEditing(false);
                          const formatTimeForInput = (time: string | null) => {
                            if (!time) return '';
                            return time.slice(0, 5);
                          };
                          setFormData({
                            phone: employee.phone || '',
                            address: employee.address || '',
                            city: employee.city || '',
                            country: employee.country || '',
                            date_of_birth: employee.date_of_birth ? String(employee.date_of_birth).slice(0, 10) : '',
                            gender: employee.gender || '',
                            working_hours_start: formatTimeForInput(employee.working_hours_start) || '09:00',
                            working_hours_end: formatTimeForInput(employee.working_hours_end) || '18:00',
                            working_days: employee.working_days || [1, 2, 3, 4, 5],
                          });
                        }}>
                          Cancel
                        </Button>
                        <Button onClick={handleSave} disabled={updateProfileMutation.isPending} className="bg-slate-950 text-white hover:bg-slate-800 rounded-2xl px-5 py-2.5 font-semibold cursor-pointer transition-colors">
                          {updateProfileMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                          <Save className="mr-2 h-4 w-4" />
                          Save
                        </Button>
                      </div>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>First Name</Label>
                        <Input value={employee.first_name} disabled />
                      </div>
                      <div className="space-y-2">
                        <Label>Last Name</Label>
                        <Input value={employee.last_name} disabled />
                      </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Email</Label>
                        <Input value={employee.email} disabled />
                      </div>
                      <div className="space-y-2">
                        <Label>Phone</Label>
                        <Input 
                          value={formData.phone}
                          onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                          disabled={!isEditing}
                          placeholder="Enter phone number"
                        />
                      </div>
                    </div>

                    <Separator />

                    <div className="space-y-2">
                      <Label>Address</Label>
                      <Input 
                        value={formData.address}
                        onChange={(e) => setFormData(prev => ({ ...prev, address: e.target.value }))}
                        disabled={!isEditing}
                        placeholder="Enter your address"
                      />
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>City</Label>
                        <Input 
                          value={formData.city}
                          onChange={(e) => setFormData(prev => ({ ...prev, city: e.target.value }))}
                          disabled={!isEditing}
                          placeholder="Enter city"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Country</Label>
                        <Input 
                          value={formData.country}
                          onChange={(e) => setFormData(prev => ({ ...prev, country: e.target.value }))}
                          disabled={!isEditing}
                          placeholder="Enter country"
                        />
                      </div>
                    </div>

                    <Separator />

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Date of Birth</Label>
                        <Input 
                          type="date"
                          value={formData.date_of_birth}
                          onChange={(e) => setFormData(prev => ({ ...prev, date_of_birth: e.target.value }))}
                          disabled={!isEditing}
                          max={new Date(new Date().getFullYear() - 18, new Date().getMonth(), new Date().getDate()).toISOString().split('T')[0]}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Gender</Label>
                        <Select
                          value={formData.gender}
                          onValueChange={(value) => setFormData(prev => ({ ...prev, gender: value }))}
                          disabled={!isEditing}
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
                      <Label>Department</Label>
                      <Input value={employee.department?.name || "Not Assigned"} disabled />
                      <p className="text-xs text-muted-foreground">Contact HR to change department assignment</p>
                    </div>

                    <Separator />

                    {/* Working Schedule Section */}
                    <div className="space-y-4">
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <Label className="text-base font-medium">Working Schedule</Label>
                      </div>
                      <p className="text-sm text-muted-foreground">Set your working hours and days for attendance reminders</p>
                      
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label>Work Start Time</Label>
                          <Input 
                            type="time"
                            value={formData.working_hours_start}
                            onChange={(e) => setFormData(prev => ({ ...prev, working_hours_start: e.target.value }))}
                            disabled={!isEditing}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Work End Time</Label>
                          <Input 
                            type="time"
                            value={formData.working_hours_end}
                            onChange={(e) => setFormData(prev => ({ ...prev, working_hours_end: e.target.value }))}
                            disabled={!isEditing}
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label>Working Days</Label>
                        <div className="flex flex-wrap gap-3">
                          {[
                            { value: 0, label: 'Sun' },
                            { value: 1, label: 'Mon' },
                            { value: 2, label: 'Tue' },
                            { value: 3, label: 'Wed' },
                            { value: 4, label: 'Thu' },
                            { value: 5, label: 'Fri' },
                            { value: 6, label: 'Sat' },
                          ].map((day) => (
                            <div key={day.value} className="flex items-center space-x-2">
                              <Checkbox
                                id={`day-${day.value}`}
                                checked={formData.working_days.includes(day.value)}
                                onCheckedChange={(checked) => {
                                  if (!isEditing) return;
                                  setFormData(prev => ({
                                    ...prev,
                                    working_days: checked
                                      ? [...prev.working_days, day.value].sort((a, b) => a - b)
                                      : prev.working_days.filter(d => d !== day.value)
                                  }));
                                }}
                                disabled={!isEditing}
                              />
                              <Label htmlFor={`day-${day.value}`} className="text-sm font-normal cursor-pointer">
                                {day.label}
                              </Label>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* Leaves Tab */}
            <TabsContent value="leaves" className="space-y-6">
              <div className="grid gap-6 lg:grid-cols-3">
                <div className="lg:col-span-2 space-y-6">
                  <LeaveBalanceCard employeeId={employee.id} />
                  <LeaveRequestHistory employeeId={employee.id} />
                </div>
                <div className="lg:col-span-1">
                  <LeaveRequestForm employeeId={employee.id} />
                </div>
              </div>
            </TabsContent>

            {/* Attendance Tab */}
            <TabsContent value="attendance" className="space-y-6">
              <AttendanceCalendar employeeId={employee.id} />
              <MyAttendanceHistory employeeId={employee.id} />
            </TabsContent>

            {/* Assets Tab */}
            <TabsContent value="assets" className="space-y-6">
              <MyAssets employeeId={employee.id} />
            </TabsContent>

            {/* Reviews Tab */}
            <TabsContent value="reviews" className="space-y-6">
              <MyPerformanceReviews employeeId={employee.id} />
            </TabsContent>

            {/* Payslips Tab */}
            <TabsContent value="payslips" className="space-y-6">
              <PayslipViewer 
                employeeId={employee.id} 
                employeeName={`${employee.first_name} ${employee.last_name}`}
                employeeCode={employee.employee_code}
              />
            </TabsContent>

            {/* Documents Tab */}
            <TabsContent value="documents" className="space-y-6">
              <TaxDocumentsViewer employeeId={employee.id} />
              <EmployeeDocuments employeeId={employee.id} />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </DashboardLayout>
  );
};

export default Profile;
