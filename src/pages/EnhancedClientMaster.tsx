import { useState } from "react";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import {
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
  Building2, Users, Activity, Upload, Plus, Search, Edit2, X,
  Shield, ChevronRight, TrendingUp, Download, AlertCircle, CheckCircle2,
  Clock, Globe, Mail, Phone, MapPin, Calendar, BarChart3
} from "lucide-react";
import { toast } from "sonner";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { hrmsApi } from "@/lib/hrmsApi";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { Button } from "@/components/ui/button";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { Input } from "@/components/ui/input";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { Badge } from "@/components/ui/badge";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import {
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { Textarea } from "@/components/ui/textarea";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import {
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

export default function EnhancedClientMaster() {
  const [activeTab, setActiveTab] = useState("clients");
  const [searchQuery, setSearchQuery] = useState("");
  const [showClientDialog, setShowClientDialog] = useState(false);
  const [showUserDialog, setShowUserDialog] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [selectedUser, setSelectedUser] = useState<PortalUser | null>(null);

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

  // Create client mutation
  const createClientMutation = useMutation({
    mutationFn: async (data: any) => {
      return hrmsApi.post("/api/clients", data);
    },
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

  // Update client mutation
  const updateClientMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      return hrmsApi.put(`/api/clients/${id}`, data);
    },
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

  // Update portal user mutation
  const updateUserMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      return hrmsApi.put(`/api/portal-users/${id}`, data);
    },
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

  // Deactivate user mutation
  const deactivateUserMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      return hrmsApi.post(`/api/portal-users/${id}/deactivate`, { reason });
    },
    onSuccess: () => {
      toast.success("User deactivated successfully");
      queryClient.invalidateQueries({ queryKey: ["portal-users"] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || "Failed to deactivate user");
    },
  });

  // Reactivate user mutation
  const reactivateUserMutation = useMutation({
    mutationFn: async (id: string) => {
      return hrmsApi.post(`/api/portal-users/${id}/reactivate`);
    },
    onSuccess: () => {
      toast.success("User reactivated successfully");
      queryClient.invalidateQueries({ queryKey: ["portal-users"] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || "Failed to reactivate user");
    },
  });

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
    const formData = new FormData(e.currentTarget);
    const data = Object.fromEntries(formData.entries());

    if (selectedUser) {
      updateUserMutation.mutate({ id: selectedUser.id, data });
    }
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
                <p className="text-xs text-muted-foreground">
                  {clientStats.active_clients} active
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Portal Users</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{clientStats.total_portal_users}</div>
                <p className="text-xs text-muted-foreground">
                  {clientStats.active_portal_users} active
                </p>
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
          <div className="flex items-center justify-between">
            <TabsList>
              <TabsTrigger value="clients">
                <Building2 className="h-4 w-4 mr-2" />
                Clients
              </TabsTrigger>
              <TabsTrigger value="users">
                <Users className="h-4 w-4 mr-2" />
                Portal Users
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
              <div className="relative w-[300px]">
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
                        {selectedClient
                          ? "Update client information"
                          : "Create a new client entity"}
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
                        <Button type="submit" disabled={createClientMutation.isPending || updateClientMutation.isPending}>
                          {selectedClient ? "Update Client" : "Create Client"}
                        </Button>
                      </div>
                    </form>
                  </DialogContent>
                </Dialog>
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
                  <div className="text-center py-8 text-muted-foreground">
                    No clients found
                  </div>
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
            <Card>
              <CardHeader>
                <CardTitle>Portal Users</CardTitle>
                <CardDescription>{portalUsers.length} users found</CardDescription>
              </CardHeader>
              <CardContent>
                {usersLoading ? (
                  <div className="text-center py-8">Loading users...</div>
                ) : (
                  <Table className="smarthr-table">
                    <TableHeader>
                      <TableRow>
                        <TableHead>User</TableHead>
                        <TableHead>Access Level</TableHead>
                        <TableHead>Last Login</TableHead>
                        <TableHead>Login Count</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {portalUsers.map((user) => (
                        <TableRow key={user.id} className="hover:bg-gray-50 transition-colors">
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
                            <Badge variant="outline">{user.access_level}</Badge>
                          </TableCell>
                          <TableCell>
                            {user.last_login_at ? (
                              <div className="text-sm">
                                {formatISTDate(user.last_login_at)}
                              </div>
                            ) : (
                              <span className="text-muted-foreground">Never</span>
                            )}
                          </TableCell>
                          <TableCell>{user.login_count}</TableCell>
                          <TableCell>
                            <Badge variant={user.is_active ? "default" : "secondary"}>
                              {user.is_active ? "Active" : "Inactive"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              <Dialog>
                                <DialogTrigger asChild>
                                  <Button size="sm" variant="outline" onClick={() => setSelectedUser(user)}>
                                    <Edit2 className="h-3 w-3" />
                                  </Button>
                                </DialogTrigger>
                                <DialogContent>
                                  <DialogHeader>
                                    <DialogTitle>Edit Portal User</DialogTitle>
                                  </DialogHeader>
                                  <form onSubmit={handleUserSubmit} className="space-y-4">
                                    <div>
                                      <Label htmlFor="full_name">Full Name</Label>
                                      <Input
                                        id="full_name"
                                        name="full_name"
                                        defaultValue={user.full_name}
                                      />
                                    </div>
                                    <div>
                                      <Label htmlFor="designation">Designation</Label>
                                      <Input
                                        id="designation"
                                        name="designation"
                                        defaultValue={user.designation}
                                      />
                                    </div>
                                    <div>
                                      <Label htmlFor="access_level">Access Level</Label>
                                      <Select name="access_level" defaultValue={user.access_level}>
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
                                      <Button type="submit">Update User</Button>
                                    </div>
                                  </form>
                                </DialogContent>
                              </Dialog>

                              {user.is_active ? (
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => {
                                    const reason = prompt("Reason for deactivation:");
                                    if (reason) {
                                      deactivateUserMutation.mutate({ id: user.id, reason });
                                    }
                                  }}
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

          {/* Tab: Analytics */}
          <TabsContent value="analytics" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Client Usage Analytics</CardTitle>
                <CardDescription>Last 30 days activity</CardDescription>
              </CardHeader>
              <CardContent>
                <Table className="smarthr-table">
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
                      <TableRow key={usage.client_id} className="hover:bg-gray-50 transition-colors">
                        <TableCell className="font-medium">{usage.client_name}</TableCell>
                        <TableCell>{usage.active_users}</TableCell>
                        <TableCell>{usage.last_30_days_logins}</TableCell>
                        <TableCell>{usage.api_calls}</TableCell>
                        <TableCell>{usage.report_views}</TableCell>
                        <TableCell>
                          {usage.last_activity
                            ? formatISTDate(usage.last_activity)
                            : "N/A"}
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
