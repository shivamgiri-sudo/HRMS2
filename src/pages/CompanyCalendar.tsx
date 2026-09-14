import { useState } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarDays, Plus, Pencil, Trash2, PartyPopper, Briefcase, Users, ChevronLeft, ChevronRight, Mail } from "lucide-react";
import { useCompanyEvents, useCreateCompanyEvent, useUpdateCompanyEvent, useDeleteCompanyEvent, CompanyEvent } from "@/hooks/useCompanyEvents";
import { useIsAdminOrHR } from "@/hooks/useUserRole";
import { toast } from "sonner";
import { format, addMonths, subMonths, isSameDay, parseISO } from "date-fns";
import { normalizeDate } from "@/lib/utils";
const EVENT_TYPES = [{
  value: "holiday",
  label: "Public Holiday",
  icon: PartyPopper,
  color: "bg-destructive/10 text-destructive"
}, {
  value: "company",
  label: "Company Event",
  icon: Briefcase,
  color: "bg-primary/10 text-primary"
}, {
  value: "meeting",
  label: "All-Hands Meeting",
  icon: Users,
  color: "bg-secondary text-secondary-foreground"
}, {
  value: "other",
  label: "Other",
  icon: CalendarDays,
  color: "bg-muted text-muted-foreground"
}];
const CompanyCalendar = () => {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CompanyEvent | null>(null);
  const [isSendingNotifications, setIsSendingNotifications] = useState(false);
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    event_date: "",
    event_type: "company",
    is_holiday: false
  });
  const {
    data: events,
    isLoading
  } = useCompanyEvents(currentMonth);
  const createEvent = useCreateCompanyEvent();
  const updateEvent = useUpdateCompanyEvent();
  const deleteEvent = useDeleteCompanyEvent();
  const {
    isAdminOrHR
  } = useIsAdminOrHR();
  const resetForm = () => {
    setFormData({
      title: "",
      description: "",
      event_date: "",
      event_type: "company",
      is_holiday: false
    });
    setEditingEvent(null);
  };
  const handleCreate = async () => {
    if (!formData.title.trim() || !formData.event_date) {
      toast.error("Title and date are required");
      return;
    }
    try {
      await createEvent.mutateAsync({
        title: formData.title.trim(),
        description: formData.description.trim() || undefined,
        event_date: formData.event_date,
        event_type: formData.event_type,
        is_holiday: formData.is_holiday
      });
      toast.success("Event created successfully");
      setIsCreateOpen(false);
      resetForm();
    } catch (error) {
      toast.error("Failed to create event");
    }
  };
  const handleUpdate = async () => {
    if (!editingEvent || !formData.title.trim() || !formData.event_date) {
      toast.error("Title and date are required");
      return;
    }
    try {
      await updateEvent.mutateAsync({
        id: editingEvent.id,
        title: formData.title.trim(),
        description: formData.description.trim() || undefined,
        event_date: formData.event_date,
        event_type: formData.event_type,
        is_holiday: formData.is_holiday
      });
      toast.success("Event updated successfully");
      setEditingEvent(null);
      resetForm();
    } catch (error) {
      toast.error("Failed to update event");
    }
  };
  const handleDelete = async (id: string) => {
    try {
      await deleteEvent.mutateAsync(id);
      toast.success("Event deleted successfully");
    } catch (error) {
      toast.error("Failed to delete event");
    }
  };
  const openEdit = (event: CompanyEvent) => {
    setEditingEvent(event);
    setFormData({
      title: event.title,
      description: event.description || "",
      event_date: event.event_date,
      event_type: event.event_type,
      is_holiday: event.is_holiday
    });
  };
  const openCreateWithDate = (date: Date) => {
    setFormData({
      ...formData,
      event_date: format(date, "yyyy-MM-dd")
    });
    setIsCreateOpen(true);
  };
  const getEventTypeConfig = (type: string) => {
    return EVENT_TYPES.find(t => t.value === type) || EVENT_TYPES[3];
  };
  const sendNotifications = async () => {
    setIsSendingNotifications(true);
    try {
      const {
        data,
        error
      } = ({ data: null, error: null });
      if (error) throw error;
      toast.success(data.message || "Notifications sent successfully");
    } catch (error) {
      console.error("Error sending notifications:", error);
      toast.error("Failed to send notifications");
    } finally {
      setIsSendingNotifications(false);
    }
  };
  const eventsOnSelectedDate = selectedDate ? events?.filter(e => isSameDay(parseISO(normalizeDate(e.event_date)), selectedDate)) : [];
  const eventDates = events?.map(e => parseISO(normalizeDate(e.event_date))) || [];
  return <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Calendar</h2>
            <p className="text-muted-foreground">View holidays and company events</p>
          </div>
          {isAdminOrHR && <div className="flex gap-2">
              <Button variant="outline" onClick={sendNotifications} disabled={isSendingNotifications}>
                <Mail className="mr-2 h-4 w-4" />
                {isSendingNotifications ? "Sending..." : "Send Notifications"}
              </Button>
              <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                <DialogTrigger asChild>
                  <Button onClick={() => resetForm()}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add Event
                  </Button>
                </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create Event</DialogTitle>
                  <DialogDescription>Add a new holiday or company event</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="title">Title *</Label>
                    <Input id="title" placeholder="e.g., Independence Day" value={formData.title} onChange={e => setFormData({
                    ...formData,
                    title: e.target.value
                  })} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="event_date">Date *</Label>
                    <Input id="event_date" type="date" value={formData.event_date} onChange={e => setFormData({
                    ...formData,
                    event_date: e.target.value
                  })} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="event_type">Event Type</Label>
                    <Select value={formData.event_type} onValueChange={value => setFormData({
                    ...formData,
                    event_type: value
                  })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {EVENT_TYPES.map(type => <SelectItem key={type.value} value={type.value}>
                            {type.label}
                          </SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="description">Description</Label>
                    <Textarea id="description" placeholder="Additional details about the event" value={formData.description} onChange={e => setFormData({
                    ...formData,
                    description: e.target.value
                  })} />
                  </div>
                  <div className="flex items-center space-x-2">
                    <Switch id="is_holiday" checked={formData.is_holiday} onCheckedChange={checked => setFormData({
                    ...formData,
                    is_holiday: checked
                  })} />
                    <Label htmlFor="is_holiday">Mark as paid holiday (office closed)</Label>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleCreate} disabled={createEvent.isPending}>
                    Create
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            </div>}
        </div>

        {/* Stats */}
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="rounded-xl bg-destructive/10 p-3">
                  <PartyPopper className="h-6 w-6 text-destructive" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Holidays This Month</p>
                  <p className="text-2xl font-bold">
                    {events?.filter(e => e.is_holiday).length || 0}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="rounded-xl bg-primary/10 p-3">
                  <Briefcase className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Company Events</p>
                  <p className="text-2xl font-bold">
                    {events?.filter(e => e.event_type === "company").length || 0}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="rounded-xl bg-secondary/50 p-3">
                  <CalendarDays className="h-6 w-6 text-secondary-foreground" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Events</p>
                  <p className="text-2xl font-bold">{events?.length || 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Calendar */}
          <Card className="lg:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>{format(currentMonth, "MMMM yyyy")}</CardTitle>
                <CardDescription>Click on a date to view events</CardDescription>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="icon" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="icon" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? <Skeleton className="h-[300px] w-full" /> : <Calendar mode="single" selected={selectedDate} onSelect={setSelectedDate} month={currentMonth} onMonthChange={setCurrentMonth} className="rounded-md border p-3" modifiers={{
              hasEvent: eventDates
            }} modifiersStyles={{
              hasEvent: {
                fontWeight: "bold",
                backgroundColor: "hsl(var(--primary) / 0.1)",
                color: "hsl(var(--primary))"
              }
            }} />}
            </CardContent>
          </Card>

          {/* Events List */}
          <Card>
            <CardHeader>
              <CardTitle>
                {selectedDate ? format(selectedDate, "MMMM d, yyyy") : "Upcoming Events"}
              </CardTitle>
              <CardDescription>
                {selectedDate ? "Events on this date" : "Events this month"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? <div className="space-y-4">
                  {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
                </div> : <div className="space-y-4">
                  {(selectedDate ? eventsOnSelectedDate : events)?.length === 0 ? <div className="flex h-32 flex-col items-center justify-center text-center text-muted-foreground">
                      <CalendarDays className="mb-2 h-8 w-8" />
                      <p>No events {selectedDate ? "on this date" : "this month"}</p>
                      {isAdminOrHR && selectedDate && <Button variant="link" size="sm" className="mt-2" onClick={() => openCreateWithDate(selectedDate)}>
                          Add an event
                        </Button>}
                    </div> : (selectedDate ? eventsOnSelectedDate : events)?.map(event => {
                const typeConfig = getEventTypeConfig(event.event_type);
                const Icon = typeConfig.icon;
                return <div key={event.id} className="rounded-lg border p-4 transition-colors hover:bg-muted/50">
                          <div className="flex items-start justify-between">
                            <div className="flex items-start gap-3">
                              <div className={`rounded-lg p-2 ${typeConfig.color}`}>
                                <Icon className="h-4 w-4" />
                              </div>
                              <div>
                                <p className="font-medium">{event.title}</p>
                                <p className="text-sm text-muted-foreground">
                                  {format(parseISO(normalizeDate(event.event_date)), "MMM d, yyyy")}
                                </p>
                                {event.is_holiday && <Badge variant="destructive" className="mt-1">
                                    Holiday
                                  </Badge>}
                              </div>
                            </div>
                            {isAdminOrHR && <div className="flex gap-1">
                                <Dialog open={editingEvent?.id === event.id} onOpenChange={open => !open && setEditingEvent(null)}>
                                  <DialogTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(event)}>
                                      <Pencil className="h-3 w-3" />
                                    </Button>
                                  </DialogTrigger>
                                  <DialogContent>
                                    <DialogHeader>
                                      <DialogTitle>Edit Event</DialogTitle>
                                      <DialogDescription>Update event details</DialogDescription>
                                    </DialogHeader>
                                    <div className="space-y-4 py-4">
                                      <div className="space-y-2">
                                        <Label htmlFor="edit-title">Title *</Label>
                                        <Input id="edit-title" value={formData.title} onChange={e => setFormData({
                                ...formData,
                                title: e.target.value
                              })} />
                                      </div>
                                      <div className="space-y-2">
                                        <Label htmlFor="edit-event_date">Date *</Label>
                                        <Input id="edit-event_date" type="date" value={formData.event_date} onChange={e => setFormData({
                                ...formData,
                                event_date: e.target.value
                              })} />
                                      </div>
                                      <div className="space-y-2">
                                        <Label htmlFor="edit-event_type">Event Type</Label>
                                        <Select value={formData.event_type} onValueChange={value => setFormData({
                                ...formData,
                                event_type: value
                              })}>
                                          <SelectTrigger>
                                            <SelectValue />
                                          </SelectTrigger>
                                          <SelectContent>
                                            {EVENT_TYPES.map(type => <SelectItem key={type.value} value={type.value}>
                                                {type.label}
                                              </SelectItem>)}
                                          </SelectContent>
                                        </Select>
                                      </div>
                                      <div className="space-y-2">
                                        <Label htmlFor="edit-description">Description</Label>
                                        <Textarea id="edit-description" value={formData.description} onChange={e => setFormData({
                                ...formData,
                                description: e.target.value
                              })} />
                                      </div>
                                      <div className="flex items-center space-x-2">
                                        <Switch id="edit-is_holiday" checked={formData.is_holiday} onCheckedChange={checked => setFormData({
                                ...formData,
                                is_holiday: checked
                              })} />
                                        <Label htmlFor="edit-is_holiday">
                                          Mark as paid holiday
                                        </Label>
                                      </div>
                                    </div>
                                    <DialogFooter>
                                      <Button variant="outline" onClick={() => setEditingEvent(null)}>
                                        Cancel
                                      </Button>
                                      <Button onClick={handleUpdate} disabled={updateEvent.isPending}>
                                        Save Changes
                                      </Button>
                                    </DialogFooter>
                                  </DialogContent>
                                </Dialog>

                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-8 w-8">
                                      <Trash2 className="h-3 w-3 text-destructive" />
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Delete Event</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        Are you sure you want to delete "{event.title}"?
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                                      <AlertDialogAction onClick={() => handleDelete(event.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                        Delete
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </div>}
                          </div>
                          {event.description && <p className="mt-2 text-sm text-muted-foreground">
                              {event.description}
                            </p>}
                        </div>;
              })}
                </div>}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>;
};
export default CompanyCalendar;