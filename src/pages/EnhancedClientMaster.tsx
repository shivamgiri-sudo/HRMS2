import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Building2, Users, Activity, Upload, Plus, Search, Edit2,
  TrendingUp, Download, Link2, Trash2,
  Globe, Mail, MapPin, BarChart3
} from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatISTDate } from "@/lib/utils";

// Types
interface Client {
  id: string;
  client_code: string;
  client_name: string;
  legal_entity_name?: string;
  industry?: string;
  primary_contact_name?: string;
  primary_contact_email?: string;
  primary_contact_phone?: string;
  city?: string;
  country?: string;
  subscription_status: string;
  billing_cycle: string;
  active_status: boolean;
  created_at: string;
}

interface PortalUser {
  id: string;
  email: string;
  full_name?: string;
  phone?: string;
  designation?: string;
  client_id: string;
  access_level: string;
  last_login_at?: string;
  login_count: number;
  is_active: boolean;
  created_at: string;
}

interface KpiAssignment {
  id: string;
  process_id: string;
  template_id: string;
  process_name: string;
  template_name: string;
  effective_from: string;
  effective_to?: string;
  assigned_by: string;
  created_at: string;
}

interface KpiTemplate {
  id: string;
  template_name: string;
}

interface ProcessItem {
  id: string;
  process_name: string;
}

export default function EnhancedClientMaster() {
  const [activeTab, setActiveTab] = useState("clients");
  const [searchQuery, setSearchQuery] = useState("");

  // Client dialog state
  const [showClientDialog, setShowClientDialog] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);

  // User dialog state — lifted out of table row
  const [showUserDialog, setShowUserDialog] = useState(false);
  const [selectedUser, setSelectedUser] = useState<PortalUser | null>(null);

  // Deactivate dialog state — replaces prompt()
  const [showDeactivateDialog, setShowDeactivateDialog] = useState(false);
  const [pendingDeactivateUser, setPendingDeactivateUser] = useState<PortalUser | null>(null);
  const [deactivateReason, setDeactivateReason] = useState("");

  // KPI assignment dialog state
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [assignProcessId, setAssignProcessId] = useState("");
  const [assignTemplateId, setAssignTemplateId] = useState("");
  const [assignEffectiveFrom, setAssignEffectiveFrom] = useState("");
  const [assignEffectiveTo, setAssignEffectiveTo] = useState("");

  const queryClient = useQueryClient();

  // Fetch clients
  const { data: clients = [], isLoading: clientsLoading } = useQuery<Client[]>({
    queryKey: ["clients", searchQuery],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchQuery) params.append("search", searchQuery);
      const res = await hrmsApi.get<{ success: boolean; data: Client[] }>(
        `/api/clients?${params.toString()}`
      );
      return res.data ?? [];
    },
  });

  // Fetch client stats
  const { data: clientStats } = useQuery({
    queryKey: ["client-stats"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: any }>("/api/clients-stats");
      return res.data;
    },
  });

  // Fetch portal users
  const { data: portalUsers = [], isLoading: usersLoading } = useQuery<PortalUser[]>({
    queryKey: ["portal-users", searchQuery],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchQuery) params.append("search", searchQuery);
      const res = await hrmsApi.get<{ success: boolean; data: PortalUser[] }>(
        `/api/portal-users?${params.toString()}`
      );
      return res.data ?? [];
    },
  });

  // Fetch usage summary
  const { data: usageSummary = [] } = useQuery({
    queryKey: ["clients-usage"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: any[] }>("/api/clients-usage?days=30");
      return res.data ?? [];
    },
  });

  // Fetch KPI assignments
  const { data: kpiAssignments = [], isLoading: assignmentsLoading } = useQuery<KpiAssignment[]>({
    queryKey: ["kpi-assignments"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: KpiAssignment[] }>(
        "/api/portal/internal/kpi-assignments"
      );
      return res.data ?? [];
    },
    enabled: activeTab === "kpi-assignments",
  });

  // Fetch KPI templates for dropdown
  const { data: kpiTemplates = [] } = useQuery<KpiTemplate[]>({
    queryKey: ["kpi-templates"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: KpiTemplate[] }>(
        "/api/portal/internal/kpi-templates"
      );
      return res.data ?? [];
    },
    enabled: activeTab === "kpi-assignments",
  });

  // Fetch processes for dropdown
  const { data: processList = [] } = useQuery<ProcessItem[]>({
    queryKey: ["process-list-simple"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: ProcessItem[] }>(
        "/api/processes?fields=id,process_name"
      );
      return res.data ?? [];
    },
    enabled: activeTab === "kpi-assignments",
  });

  // Mutations — clients
  const createClientMutation = useMutation({
    mutationFn: async (data: any) => hrmsApi.post("/api/clients", data),
    onSuccess: () => {
      toast.success("Client created successfully");
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["client-stats"] });
      setShowClientDialog(false);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || "Failed to create client");
    },
  });

  const updateClientMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) =>
      hrmsApi.put(`/api/clients/${id}`, data),
    onSuccess: () => {
      toast.success("Client updated successfully");
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      setShowClientDialog(false);
      setSelectedClient(null);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || "Failed to update client");
    },
  });

  // Mutations — portal users
  const updateUserMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) =>
      hrmsApi.put(`/api/portal-users/${id}`, data),
    onSuccess: () => {
      toast.success("User updated successfully");
      queryClient.invalidateQueries({ queryKey: ["portal-users"] });
      setShowUserDialog(false);
      setSelectedUser(null);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || "Failed to update user");
    },
  });

  const deactivateUserMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) =>
      hrmsApi.post(`/api/portal-users/${id}/deactivate`, { reason }),
    onSuccess: () => {
      toast.success("User deactivated successfully");
      queryClient.invalidateQueries({ queryKey: ["portal-users"] });
      setShowDeactivateDialog(false);
      setPendingDeactivateUser(null);
      setDeactivateReason("");
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || "Failed to deactivate user");
    },
  });

  const reactivateUserMutation = useMutation({
    mutationFn: async (id: string) => hrmsApi.post(`/api/portal-users/${id}/reactivate`),
    onSuccess: () => {
      toast.success("User reactivated successfully");
      queryClient.invalidateQueries({ queryKey: ["portal-users"] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || "Failed to reactivate user");
    },
  });

  // Mutations — KPI assignments
  const createAssignmentMutation = useMutation({
    mutationFn: async (data: any) =>
      hrmsApi.post("/api/portal/internal/kpi-assignments", data),
    onSuccess: () => {
      toast.success("KPI template assigned successfully");
      queryClient.invalidateQueries({ queryKey: ["kpi-assignments"] });
      setShowAssignDialog(false);
      setAssignProcessId("");
      setAssignTemplateId("");
      setAssignEffectiveFrom("");
      setAssignEffectiveTo("");
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || "Failed to assign template");
    },
  });

  const deleteAssignmentMutation = useMutation({
    mutationFn: async (id: string) =>
      hrmsApi.delete(`/api/portal/internal/kpi-assignments/${id}`),
    onSuccess: () => {
      toast.success("Assignment removed");
      queryClient.invalidateQueries({ queryKey: ["kpi-assignments"] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || "Failed to remove assignment");
    },
  });

  // Form handlers
  const handleClientSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = Object.fromEntries(formData.entries());
    if (selectedClient) {
      updateClientMutation.mutate({ id: selectedClient.id, data });
    } else {
      createClientMutation.mutate(data);
    }
  };

  const handleUserSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedUser) return;
    const formData = new FormData(e.currentTarget);
    const data = Object.fromEntries(formData.entries());
    updateUserMutation.mutate({ id: selectedUser.id, data });
  };

  const handleDeactivateConfirm = () => {
    if (!pendingDeactivateUser || !deactivateReason.trim()) return;
    deactivateUserMutation.mutate({ id: pendingDeactivateUser.id, reason: deactivateReason });
  };

  const handleAssignSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignProcessId || !assignTemplateId || !assignEffectiveFrom) return;
    createAssignmentMutation.mutate({
      process_id: assignProcessId,
      template_id: assignTemplateId,
      effective_from: assignEffectiveFrom,
      effective_to: assignEffectiveTo || undefined,
    });
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Client Master</h1>
            <p className="text-muted-foreground mt-1">
              Comprehensive client and portal user management
            </p>
          </div>
        </div>

        {/* Stats Cards */}
        {clientStats && (
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Clients</CardTitle>
                <Building2 className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{clientStats.total_clients}</div>
                <p className="text-xs text-muted-foreground">{clientStats.active_clients} active</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Portal Users</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{clientStats.total_portal_users}</div>
                <p className="text-xs text-muted-foreground">{clientStats.active_portal_users} active</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Processes</CardTitle>
                <Activity className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{clientStats.total_processes}</div>
                <p className="text-xs text-muted-foreground">Active processes</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Trial Clients</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{clientStats.trial_clients}</div>
                <p className="text-xs text-muted-foreground">On trial period</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Main Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <TabsList>
              <TabsTrigger value="clients">
                <Building2 className="h-4 w-4 mr-2" />
                Clients
              </TabsTrigger>
              <TabsTrigger value="users">
                <Users className="h-4 w-4 mr-2" />
                Portal Users
              </TabsTrigger>
              <TabsTrigger value="kpi-assignments">
                <Link2 className="h-4 w-4 mr-2" />
                KPI Assignments
              </TabsTrigger>
              <TabsTrigger value="analytics">
                <BarChart3 className="h-4 w-4 mr-2" />
                Analytics
              </TabsTrigger>
              <TabsTrigger value="bulk">
                <Upload className="h-4 w-4 mr-2" />
                Bulk Operations
              </TabsTrigger>
            </TabsList>

            <div className="flex gap-2">
              <div className="relative w-[280px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>

              {activeTab === "clients" && (
                <Dialog open={showClientDialog} onOpenChange={setShowClientDialog}>
                  <DialogTrigger asChild>
                    <Button onClick={() => setSelectedClient(null)}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add Client
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>
                        {selectedClient ? "Edit Client" : "Add New Client"}
                      </DialogTitle>
                      <DialogDescription>
                        {selectedClient ? "Update client information" : "Create a new client entity"}
                      </DialogDescription>
                    </DialogHeader>

                    <form onSubmit={handleClientSubmit} className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label htmlFor="client_code">Client Code *</Label>
                          <Input
                            id="client_code"
                            name="client_code"
                            required
                            defaultValue={selectedClient?.client_code}
                            placeholder="ABC_CORP"
                          />
                        </div>
                        <div>
                          <Label htmlFor="client_name">Client Name *</Label>
                          <Input
                            id="client_name"
                            name="client_name"
                            required
                            defaultValue={selectedClient?.client_name}
                            placeholder="ABC Corporation"
                          />
                        </div>
                      </div>

                      <div>
                        <Label htmlFor="legal_entity_name">Legal Entity Name</Label>
                        <Input
                          id="legal_entity_name"
                          name="legal_entity_name"
                          defaultValue={selectedClient?.legal_entity_name}
                          placeholder="ABC Corp Private Limited"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label htmlFor="industry">Industry</Label>
                          <Input
                            id="industry"
                            name="industry"
                            defaultValue={selectedClient?.industry}
                            placeholder="Technology"
                          />
                        </div>
                        <div>
                          <Label htmlFor="billing_cycle">Billing Cycle</Label>
                          <Select name="billing_cycle" defaultValue={selectedClient?.billing_cycle || "MONTHLY"}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="MONTHLY">Monthly</SelectItem>
                              <SelectItem value="QUARTERLY">Quarterly</SelectItem>
                              <SelectItem value="ANNUAL">Annual</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          <Label htmlFor="primary_contact_name">Contact Name</Label>
                          <Input
                            id="primary_contact_name"
                            name="primary_contact_name"
                            defaultValue={selectedClient?.primary_contact_name}
                            placeholder="John Doe"
                          />
                        </div>
                        <div>
                          <Label htmlFor="primary_contact_email">Contact Email</Label>
                          <Input
                            id="primary_contact_email"
                            name="primary_contact_email"
                            type="email"
                            defaultValue={selectedClient?.primary_contact_email}
                            placeholder="john@company.com"
                          />
                        </div>
                        <div>
                          <Label htmlFor="primary_contact_phone">Contact Phone</Label>
                          <Input
                            id="primary_contact_phone"
                            name="primary_contact_phone"
                            defaultValue={selectedClient?.primary_contact_phone}
                            placeholder="+91-9876543210"
                          />
                        </div>
                      </div>

                      <div className="flex justify-end gap-2">
                        <Button type="button" variant="outline" onClick={() => setShowClientDialog(false)}>
                          Cancel
                        </Button>
                        <Button
                          type="submit"
                          disabled={createClientMutation.isPending || updateClientMutation.isPending}
                        >
                          {selectedClient ? "Update Client" : "Create Client"}
                        </Button>
                      </div>
                    </form>
                  </DialogContent>
                </Dialog>
              )}

              {activeTab === "kpi-assignments" && (
                <Button onClick={() => setShowAssignDialog(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Assign Template
                </Button>
              )}
            </div>
          </div>

          {/* Tab: Clients */}
          <TabsContent value="clients" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Client List</CardTitle>
                <CardDescription>{clients.length} clients found</CardDescription>
              </CardHeader>
              <CardContent>
                {clientsLoading ? (
                  <div className="text-center py-8">Loading clients...</div>
                ) : clients.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">No clients found</div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    {clients.map((client) => (
                      <Card key={client.id} className="relative">
                        <CardHeader>
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <CardTitle className="text-lg">{client.client_name}</CardTitle>
                              <CardDescription className="font-mono text-xs">
                                {client.client_code}
                              </CardDescription>
                            </div>
                            <div className="flex gap-2">
                              <Badge variant={client.active_status ? "default" : "secondary"}>
                                {client.active_status ? "Active" : "Inactive"}
                              </Badge>
                              <Badge variant="outline">{client.subscription_status}</Badge>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-2">
                          {client.industry && (
                            <div className="flex items-center text-sm text-muted-foreground">
                              <Building2 className="h-4 w-4 mr-2" />
                              {client.industry}
                            </div>
                          )}
                          {client.primary_contact_email && (
                            <div className="flex items-center text-sm text-muted-foreground">
                              <Mail className="h-4 w-4 mr-2" />
                              {client.primary_contact_email}
                            </div>
                          )}
                          {client.city && (
                            <div className="flex items-center text-sm text-muted-foreground">
                              <MapPin className="h-4 w-4 mr-2" />
                              {client.city}, {client.country}
                            </div>
                          )}
                          <div className="flex items-center justify-between pt-2">
                            <span className="text-xs text-muted-foreground">
                              {client.billing_cycle} billing
                            </span>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setSelectedClient(client);
                                setShowClientDialog(true);
                              }}
                            >
                              <Edit2 className="h-3 w-3 mr-1" />
                              Edit
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tab: Portal Users */}
          <TabsContent value="users" className="space-y-4">
            {/* Edit user dialog — rendered once at component level, outside the table */}
            <Dialog open={showUserDialog} onOpenChange={(open) => { setShowUserDialog(open); if (!open) setSelectedUser(null); }}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Edit Portal User</DialogTitle>
                  <DialogDescription>Update user profile and access settings</DialogDescription>
                </DialogHeader>
                {selectedUser && (
                  <form onSubmit={handleUserSubmit} className="space-y-4">
                    <div>
                      <Label htmlFor="edit_full_name">Full Name</Label>
                      <Input id="edit_full_name" name="full_name" defaultValue={selectedUser.full_name} />
                    </div>
                    <div>
                      <Label htmlFor="edit_designation">Designation</Label>
                      <Input id="edit_designation" name="designation" defaultValue={selectedUser.designation} />
                    </div>
                    <div>
                      <Label htmlFor="edit_phone">Phone</Label>
                      <Input id="edit_phone" name="phone" defaultValue={selectedUser.phone} />
                    </div>
                    <div>
                      <Label htmlFor="edit_access_level">Access Level</Label>
                      <Select name="access_level" defaultValue={selectedUser.access_level || "READ_ONLY"}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="READ_ONLY">Read Only</SelectItem>
                          <SelectItem value="FULL_ACCESS">Full Access</SelectItem>
                          <SelectItem value="ADMIN">Admin</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="outline" onClick={() => setShowUserDialog(false)}>
                        Cancel
                      </Button>
                      <Button type="submit" disabled={updateUserMutation.isPending}>
                        Update User
                      </Button>
                    </div>
                  </form>
                )}
              </DialogContent>
            </Dialog>

            {/* Deactivate confirm dialog */}
            <Dialog open={showDeactivateDialog} onOpenChange={(open) => { setShowDeactivateDialog(open); if (!open) { setPendingDeactivateUser(null); setDeactivateReason(""); } }}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Deactivate Portal User</DialogTitle>
                  <DialogDescription>
                    This will immediately revoke {pendingDeactivateUser?.full_name || pendingDeactivateUser?.email}'s portal access. Provide a reason for the audit trail.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="deactivate_reason">Reason *</Label>
                    <Textarea
                      id="deactivate_reason"
                      value={deactivateReason}
                      onChange={(e) => setDeactivateReason(e.target.value)}
                      placeholder="e.g. Contract ended, security concern..."
                      className="h-24"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setShowDeactivateDialog(false)}>
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={!deactivateReason.trim() || deactivateUserMutation.isPending}
                      onClick={handleDeactivateConfirm}
                    >
                      Confirm Deactivation
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            <Card>
              <CardHeader>
                <CardTitle>Portal Users</CardTitle>
                <CardDescription>{portalUsers.length} users found</CardDescription>
              </CardHeader>
              <CardContent>
                {usersLoading ? (
                  <div className="text-center py-8">Loading users...</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>User</TableHead>
                        <TableHead>Access Level</TableHead>
                        <TableHead>Last Login</TableHead>
                        <TableHead>Logins</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {portalUsers.map((user) => (
                        <TableRow key={user.id}>
                          <TableCell>
                            <div>
                              <div className="font-medium">{user.full_name || user.email}</div>
                              <div className="text-xs text-muted-foreground">{user.email}</div>
                              {user.designation && (
                                <div className="text-xs text-muted-foreground">{user.designation}</div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{user.access_level || "READ_ONLY"}</Badge>
                          </TableCell>
                          <TableCell>
                            {user.last_login_at ? (
                              <span className="text-sm">{formatISTDate(user.last_login_at)}</span>
                            ) : (
                              <span className="text-muted-foreground">Never</span>
                            )}
                          </TableCell>
                          <TableCell>{user.login_count ?? 0}</TableCell>
                          <TableCell>
                            <Badge variant={user.is_active ? "default" : "secondary"}>
                              {user.is_active ? "Active" : "Inactive"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => { setSelectedUser(user); setShowUserDialog(true); }}
                              >
                                <Edit2 className="h-3 w-3 mr-1" />
                                Edit
                              </Button>
                              {user.is_active ? (
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => { setPendingDeactivateUser(user); setShowDeactivateDialog(true); }}
                                >
                                  Deactivate
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => reactivateUserMutation.mutate(user.id)}
                                >
                                  Reactivate
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tab: KPI Assignments */}
          <TabsContent value="kpi-assignments" className="space-y-4">
            {/* Assign dialog */}
            <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Assign KPI Template to Process</DialogTitle>
                  <DialogDescription>
                    Link a KPI template to a client process so the portal scorecard is populated.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleAssignSubmit} className="space-y-4">
                  <div>
                    <Label>Process *</Label>
                    <Select value={assignProcessId} onValueChange={setAssignProcessId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select process..." />
                      </SelectTrigger>
                      <SelectContent>
                        {processList.map((p) => (
                          <SelectItem key={p.id} value={p.id}>{p.process_name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>KPI Template *</Label>
                    <Select value={assignTemplateId} onValueChange={setAssignTemplateId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select template..." />
                      </SelectTrigger>
                      <SelectContent>
                        {kpiTemplates.map((t) => (
                          <SelectItem key={t.id} value={t.id}>{t.template_name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="effective_from">Effective From *</Label>
                      <Input
                        id="effective_from"
                        type="date"
                        value={assignEffectiveFrom}
                        onChange={(e) => setAssignEffectiveFrom(e.target.value)}
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="effective_to">Effective To</Label>
                      <Input
                        id="effective_to"
                        type="date"
                        value={assignEffectiveTo}
                        onChange={(e) => setAssignEffectiveTo(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => setShowAssignDialog(false)}>
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={!assignProcessId || !assignTemplateId || !assignEffectiveFrom || createAssignmentMutation.isPending}
                    >
                      Assign Template
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>

            <Card>
              <CardHeader>
                <CardTitle>KPI Template Assignments</CardTitle>
                <CardDescription>
                  Controls which KPI scorecard template populates each client's portal dashboard
                </CardDescription>
              </CardHeader>
              <CardContent>
                {assignmentsLoading ? (
                  <div className="text-center py-8">Loading assignments...</div>
                ) : kpiAssignments.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Link2 className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p className="font-medium">No KPI assignments yet</p>
                    <p className="text-sm mt-1">Click "Assign Template" to link a KPI template to a process</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Process</TableHead>
                        <TableHead>KPI Template</TableHead>
                        <TableHead>Effective From</TableHead>
                        <TableHead>Effective To</TableHead>
                        <TableHead>Assigned By</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {kpiAssignments.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell className="font-medium">{a.process_name}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{a.template_name}</Badge>
                          </TableCell>
                          <TableCell className="text-sm">{formatISTDate(a.effective_from)}</TableCell>
                          <TableCell className="text-sm">
                            {a.effective_to ? formatISTDate(a.effective_to) : <span className="text-muted-foreground">Ongoing</span>}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{a.assigned_by}</TableCell>
                          <TableCell>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:text-destructive"
                              onClick={() => {
                                if (confirm("Remove this KPI assignment?")) {
                                  deleteAssignmentMutation.mutate(a.id);
                                }
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tab: Analytics */}
          <TabsContent value="analytics" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Client Usage Analytics</CardTitle>
                <CardDescription>Last 30 days activity</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Client</TableHead>
                      <TableHead>Active Users</TableHead>
                      <TableHead>Total Logins</TableHead>
                      <TableHead>API Calls</TableHead>
                      <TableHead>Report Views</TableHead>
                      <TableHead>Last Activity</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {usageSummary.map((usage: any) => (
                      <TableRow key={usage.client_id}>
                        <TableCell className="font-medium">{usage.client_name}</TableCell>
                        <TableCell>{usage.active_users}</TableCell>
                        <TableCell>{usage.last_30_days_logins}</TableCell>
                        <TableCell>{usage.api_calls}</TableCell>
                        <TableCell>{usage.report_views}</TableCell>
                        <TableCell>
                          {usage.last_activity ? formatISTDate(usage.last_activity) : "N/A"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tab: Bulk Operations */}
          <TabsContent value="bulk" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Bulk Operations</CardTitle>
                <CardDescription>Import/export data in bulk</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <Button>
                      <Upload className="h-4 w-4 mr-2" />
                      Import Users (CSV)
                    </Button>
                    <Button variant="outline">
                      <Download className="h-4 w-4 mr-2" />
                      Download Template
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Bulk import/export functionality coming soon
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
