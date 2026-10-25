import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Eye,
  Users,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Monitor,
  Search,
  RefreshCw,
  Activity,
  Camera,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  UserX,
  Filter,
  SortAsc,
  SortDesc,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

interface LiveAttempt {
  id: string;
  student_id: string;
  exam_id: string;
  started_at: string;
  last_activity_at: string;
  is_submitted: boolean;
  is_locked: boolean;
  profiles: {
    full_name: string;
    email: string;
  };
  exams: {
    title: string;
  };
  proctoring_sessions?: {
    id: string;
    total_events: number;
    high_severity_events: number;
    requires_review: boolean;
  }[];
}

interface ProctoringEvent {
  id: string;
  event_type: string;
  severity: string;
  created_at: string;
  description: string;
  screenshot_url?: string;
}

interface EventBreakdown {
  face_not_detected: number;
  multiple_faces: number;
  head_movement_left: number;
  head_movement_right: number;
  head_movement_up: number;
  head_movement_down: number;
  tab_switch: number;
  window_blur: number;
  other: number;
}

type SortField = "name" | "flags" | "severity" | "activity";
type SortOrder = "asc" | "desc";
type FilterType = "all" | "flagged" | "high_severity" | "clean";

export default function LiveProctoringPage() {
  const [selectedExamId, setSelectedExamId] = useState("");
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("flags");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [filterType, setFilterType] = useState<FilterType>("all");

  // Fetch active online exams
  const { data: exams, isLoading: examsLoading } = useQuery({
    queryKey: ["active-online-exams"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const { data, error } = await supabase
        .from("exams")
        .select("id, title, status, scheduled_date")
        .eq("exam_mode", "online")
        .in("status", ["published", "active"])
        .order("scheduled_date", { ascending: false });

      if (error) throw error;
      return data || [];
    },
  });

  // Fetch live attempts for selected exam
  const { data: liveAttempts, isLoading: attemptsLoading, refetch } = useQuery({
    queryKey: ["live-attempts", selectedExamId],
    queryFn: async () => {
      if (!selectedExamId) return [];

      const { data, error } = await supabase
        .from("student_exam_attempts")
        .select(`
          id, student_id, exam_id, started_at, last_activity_at, 
          is_submitted, is_locked,
          profiles!student_exam_attempts_student_id_fkey(full_name, email),
          exams!student_exam_attempts_exam_id_fkey(title),
          proctoring_sessions(id, total_events, high_severity_events, requires_review)
        `)
        .eq("exam_id", selectedExamId)
        .eq("is_submitted", false)
        .order("started_at", { ascending: false });

      if (error) throw error;
      return (data || []) as unknown as LiveAttempt[];
    },
    enabled: !!selectedExamId,
    refetchInterval: 5000, // Auto-refresh every 5 seconds
  });

  // Stats
  const activeStudents = liveAttempts?.length || 0;
  const flaggedStudents = liveAttempts?.filter(
    (a) => a.proctoring_sessions?.[0]?.requires_review
  ).length || 0;
  const highAlertStudents = liveAttempts?.filter(
    (a) => (a.proctoring_sessions?.[0]?.high_severity_events || 0) > 0
  ).length || 0;
  const cleanStudents = activeStudents - flaggedStudents - highAlertStudents;

  // Sort and filter attempts
  const processedAttempts = liveAttempts
    ?.filter((a) => {
      // Text search
      if (search) {
        const searchLower = search.toLowerCase();
        if (
          !a.profiles?.full_name?.toLowerCase().includes(searchLower) &&
          !a.profiles?.email?.toLowerCase().includes(searchLower)
        ) {
          return false;
        }
      }

      // Filter type
      const session = a.proctoring_sessions?.[0];
      switch (filterType) {
        case "flagged":
          return session?.requires_review;
        case "high_severity":
          return (session?.high_severity_events || 0) > 0;
        case "clean":
          return !session?.requires_review && !session?.high_severity_events;
        default:
          return true;
      }
    })
    .sort((a, b) => {
      const sessionA = a.proctoring_sessions?.[0];
      const sessionB = b.proctoring_sessions?.[0];

      let comparison = 0;
      switch (sortField) {
        case "name":
          comparison = (a.profiles?.full_name || "").localeCompare(
            b.profiles?.full_name || ""
          );
          break;
        case "flags":
          comparison =
            (sessionA?.total_events || 0) - (sessionB?.total_events || 0);
          break;
        case "severity":
          comparison =
            (sessionA?.high_severity_events || 0) -
            (sessionB?.high_severity_events || 0);
          break;
        case "activity":
          comparison =
            new Date(a.last_activity_at).getTime() -
            new Date(b.last_activity_at).getTime();
          break;
      }

      return sortOrder === "asc" ? comparison : -comparison;
    });

  const getStatusBadge = (attempt: LiveAttempt) => {
    const lastActivity = new Date(attempt.last_activity_at);
    const now = new Date();
    const minutesSinceActivity = Math.floor(
      (now.getTime() - lastActivity.getTime()) / 60000
    );

    if (minutesSinceActivity > 5) {
      return <Badge variant="secondary" className="gap-1"><Clock className="h-3 w-3" />Idle ({minutesSinceActivity}m)</Badge>;
    }
    return <Badge className="gap-1 bg-green-600"><Activity className="h-3 w-3" />Active</Badge>;
  };

  const getAlertLevel = (attempt: LiveAttempt) => {
    const session = attempt.proctoring_sessions?.[0];
    if (!session) return null;

    if (session.high_severity_events > 0) {
      return (
        <Badge variant="destructive" className="gap-1">
          <AlertTriangle className="h-3 w-3" />
          {session.high_severity_events} High
        </Badge>
      );
    }
    if (session.requires_review) {
      return (
        <Badge className="gap-1 bg-amber-500">
          <AlertTriangle className="h-3 w-3" />
          Review
        </Badge>
      );
    }
    if (session.total_events > 0) {
      return (
        <Badge variant="outline" className="gap-1">
          {session.total_events} events
        </Badge>
      );
    }
    return <Badge variant="secondary" className="gap-1"><CheckCircle2 className="h-3 w-3" />Clean</Badge>;
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("desc");
    }
  };

  const SortIcon = sortOrder === "asc" ? SortAsc : SortDesc;

  if (examsLoading) {
    return <PageSkeleton />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Monitor className="h-6 w-6" />
            Live Proctoring
          </h1>
          <p className="text-muted-foreground">
            Monitor students taking online exams in real-time with AI-powered detection
          </p>
        </div>
        {selectedExamId && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        )}
      </div>

      {/* Exam Selection */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Select Exam to Monitor</CardTitle>
        </CardHeader>
        <CardContent>
          <SearchableSelect
            value={selectedExamId}
            onValueChange={setSelectedExamId}
            placeholder="Choose an active online exam"
            searchPlaceholder="Search exams..."
            options={exams?.map((exam) => ({
              value: exam.id,
              label: `${exam.title} (${exam.status})`,
            })) || []}
          />
        </CardContent>
      </Card>

      {selectedExamId && (
        <>
          {/* Stats Cards */}
          <div className="grid gap-4 md:grid-cols-4">
            <StatsCard
              title="Active Students"
              value={activeStudents}
              icon={<Users className="h-4 w-4" />}
              variant="blue"
              onClick={() => setFilterType("all")}
              active={filterType === "all"}
            />
            <StatsCard
              title="High Alerts"
              value={highAlertStudents}
              icon={<AlertTriangle className="h-4 w-4" />}
              variant="red"
              onClick={() => setFilterType("high_severity")}
              active={filterType === "high_severity"}
            />
            <StatsCard
              title="Needs Review"
              value={flaggedStudents}
              icon={<Eye className="h-4 w-4" />}
              variant="amber"
              onClick={() => setFilterType("flagged")}
              active={filterType === "flagged"}
            />
            <StatsCard
              title="Clean Sessions"
              value={cleanStudents}
              icon={<CheckCircle2 className="h-4 w-4" />}
              variant="green"
              onClick={() => setFilterType("clean")}
              active={filterType === "clean"}
            />
          </div>

          {/* Search and Sort Controls */}
          <div className="flex flex-wrap gap-4 items-center">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search students..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>

            <Select value={sortField} onValueChange={(v) => setSortField(v as SortField)}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="flags">Total Flags</SelectItem>
                <SelectItem value="severity">High Severity</SelectItem>
                <SelectItem value="name">Name</SelectItem>
                <SelectItem value="activity">Last Activity</SelectItem>
              </SelectContent>
            </Select>

            <Button
              variant="outline"
              size="icon"
              onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
            >
              <SortIcon className="h-4 w-4" />
            </Button>
          </div>

          {/* Live Students Table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="h-4 w-4 text-green-500 animate-pulse" />
                Live Students ({processedAttempts?.length || 0})
                {filterType !== "all" && (
                  <Badge variant="secondary" className="ml-2">
                    Filtered: {filterType.replace("_", " ")}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {attemptsLoading ? (
                <div className="p-8 text-center">
                  <Skeleton className="h-8 w-32 mx-auto" />
                </div>
              ) : processedAttempts?.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  {filterType === "all"
                    ? "No students currently taking this exam"
                    : `No students matching filter: ${filterType.replace("_", " ")}`}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead 
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => toggleSort("name")}
                      >
                        <div className="flex items-center gap-1">
                          Student
                          {sortField === "name" && <SortIcon className="h-3 w-3" />}
                        </div>
                      </TableHead>
                      <TableHead>Started</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead 
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => toggleSort("flags")}
                      >
                        <div className="flex items-center gap-1">
                          Flags
                          {sortField === "flags" && <SortIcon className="h-3 w-3" />}
                        </div>
                      </TableHead>
                      <TableHead>Event Breakdown</TableHead>
                      <TableHead 
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => toggleSort("activity")}
                      >
                        <div className="flex items-center gap-1">
                          Last Activity
                          {sortField === "activity" && <SortIcon className="h-3 w-3" />}
                        </div>
                      </TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {processedAttempts?.map((attempt) => (
                      <LiveStudentRow 
                        key={attempt.id} 
                        attempt={attempt}
                        getStatusBadge={getStatusBadge}
                        getAlertLevel={getAlertLevel}
                      />
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {!selectedExamId && exams && exams.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Monitor className="h-12 w-12 text-muted-foreground/50 mx-auto mb-4" />
            <h3 className="font-medium text-lg">No Active Online Exams</h3>
            <p className="text-muted-foreground mt-1">
              Create an online exam and publish it to start monitoring
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatsCard({
  title,
  value,
  icon,
  variant = "default",
  onClick,
  active,
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  variant?: "default" | "blue" | "green" | "amber" | "red";
  onClick?: () => void;
  active?: boolean;
}) {
  const colors = {
    default: "text-foreground",
    blue: "text-blue-600",
    green: "text-green-600",
    amber: "text-amber-600",
    red: "text-red-600",
  };

  return (
    <Card 
      className={`cursor-pointer transition-all hover:shadow-md ${
        active ? "ring-2 ring-primary" : ""
      }`}
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${colors[variant]}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64 mt-2" />
      </div>
      <Skeleton className="h-32" />
      <div className="grid gap-4 md:grid-cols-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    </div>
  );
}

// Live student row with expandable camera view
function LiveStudentRow({ 
  attempt, 
  getStatusBadge, 
  getAlertLevel 
}: { 
  attempt: LiveAttempt;
  getStatusBadge: (attempt: LiveAttempt) => JSX.Element;
  getAlertLevel: (attempt: LiveAttempt) => JSX.Element | null;
}) {
  const [showCameraView, setShowCameraView] = useState(false);
  const [eventBreakdown, setEventBreakdown] = useState<EventBreakdown | null>(null);
  const [recentEvents, setRecentEvents] = useState<ProctoringEvent[]>([]);

  // Fetch event breakdown for this session
  const sessionId = attempt.proctoring_sessions?.[0]?.id;
  
  useEffect(() => {
    if (!sessionId) return;

    const fetchEvents = async () => {
      const { data, error } = await supabase
        .from("proctoring_events")
        .select("id, event_type, severity, created_at, description, screenshot_url")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) {
        console.error("Failed to fetch events:", error);
        return;
      }

      setRecentEvents(data || []);

      // Calculate breakdown
      const breakdown: EventBreakdown = {
        face_not_detected: 0,
        multiple_faces: 0,
        head_movement_left: 0,
        head_movement_right: 0,
        head_movement_up: 0,
        head_movement_down: 0,
        tab_switch: 0,
        window_blur: 0,
        other: 0,
      };

      data?.forEach((event) => {
        const type = event.event_type as keyof EventBreakdown;
        if (type in breakdown) {
          breakdown[type]++;
        } else {
          breakdown.other++;
        }
      });

      setEventBreakdown(breakdown);
    };

    fetchEvents();

    // Subscribe to real-time updates
    const channel = supabase
      .channel(`proctoring-events-${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "proctoring_events",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          const newEvent = payload.new as ProctoringEvent;
          setRecentEvents((prev) => [newEvent, ...prev].slice(0, 50));
          
          // Update breakdown
          setEventBreakdown((prev) => {
            if (!prev) return prev;
            const type = newEvent.event_type as keyof EventBreakdown;
            if (type in prev) {
              return { ...prev, [type]: prev[type] + 1 };
            }
            return { ...prev, other: prev.other + 1 };
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId]);

  const getEventIcon = (type: string) => {
    switch (type) {
      case "face_not_detected":
        return <UserX className="h-3 w-3" />;
      case "multiple_faces":
        return <Users className="h-3 w-3" />;
      case "head_movement_left":
        return <ArrowLeft className="h-3 w-3" />;
      case "head_movement_right":
        return <ArrowRight className="h-3 w-3" />;
      case "head_movement_up":
        return <ArrowUp className="h-3 w-3" />;
      case "head_movement_down":
        return <ArrowDown className="h-3 w-3" />;
      case "tab_switch":
      case "window_blur":
        return <Monitor className="h-3 w-3" />;
      default:
        return <AlertTriangle className="h-3 w-3" />;
    }
  };

  return (
    <>
      <TableRow className={attempt.proctoring_sessions?.[0]?.high_severity_events ? "bg-red-50 dark:bg-red-950/20" : ""}>
        <TableCell>
          <div>
            <p className="font-medium">{attempt.profiles?.full_name}</p>
            <p className="text-xs text-muted-foreground">
              {attempt.profiles?.email}
            </p>
          </div>
        </TableCell>
        <TableCell>
          {format(new Date(attempt.started_at), "h:mm a")}
        </TableCell>
        <TableCell>{getStatusBadge(attempt)}</TableCell>
        <TableCell>{getAlertLevel(attempt)}</TableCell>
        <TableCell>
          <TooltipProvider>
            <div className="flex gap-1 flex-wrap">
              {eventBreakdown && (
                <>
                  {eventBreakdown.face_not_detected > 0 && (
                    <Tooltip>
                      <TooltipTrigger>
                        <Badge variant="destructive" className="gap-1 text-xs">
                          <UserX className="h-3 w-3" />
                          {eventBreakdown.face_not_detected}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>Face not detected</TooltipContent>
                    </Tooltip>
                  )}
                  {eventBreakdown.multiple_faces > 0 && (
                    <Tooltip>
                      <TooltipTrigger>
                        <Badge variant="destructive" className="gap-1 text-xs">
                          <Users className="h-3 w-3" />
                          {eventBreakdown.multiple_faces}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>Multiple faces</TooltipContent>
                    </Tooltip>
                  )}
                  {(eventBreakdown.head_movement_left > 0 ||
                    eventBreakdown.head_movement_right > 0 ||
                    eventBreakdown.head_movement_up > 0 ||
                    eventBreakdown.head_movement_down > 0) && (
                    <Tooltip>
                      <TooltipTrigger>
                        <Badge variant="outline" className="gap-1 text-xs bg-amber-50 dark:bg-amber-950/30">
                          <ArrowLeft className="h-3 w-3" />
                          {eventBreakdown.head_movement_left +
                            eventBreakdown.head_movement_right +
                            eventBreakdown.head_movement_up +
                            eventBreakdown.head_movement_down}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="text-xs space-y-1">
                          <div>Head movements:</div>
                          {eventBreakdown.head_movement_left > 0 && (
                            <div>← Left: {eventBreakdown.head_movement_left}</div>
                          )}
                          {eventBreakdown.head_movement_right > 0 && (
                            <div>→ Right: {eventBreakdown.head_movement_right}</div>
                          )}
                          {eventBreakdown.head_movement_up > 0 && (
                            <div>↑ Up: {eventBreakdown.head_movement_up}</div>
                          )}
                          {eventBreakdown.head_movement_down > 0 && (
                            <div>↓ Down: {eventBreakdown.head_movement_down}</div>
                          )}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {eventBreakdown.tab_switch > 0 && (
                    <Tooltip>
                      <TooltipTrigger>
                        <Badge variant="destructive" className="gap-1 text-xs">
                          <Monitor className="h-3 w-3" />
                          {eventBreakdown.tab_switch}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>Tab switches</TooltipContent>
                    </Tooltip>
                  )}
                </>
              )}
              {!eventBreakdown && (
                <Badge variant="secondary" className="text-xs">Loading...</Badge>
              )}
            </div>
          </TooltipProvider>
        </TableCell>
        <TableCell className="text-muted-foreground text-sm">
          {formatDistanceToNow(new Date(attempt.last_activity_at), { addSuffix: true })}
        </TableCell>
        <TableCell>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowCameraView(true)}
          >
            <Eye className="h-4 w-4" />
          </Button>
        </TableCell>
      </TableRow>

      {/* Student Detail Dialog */}
      <Dialog open={showCameraView} onOpenChange={setShowCameraView}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Camera className="h-5 w-5" />
              Monitoring: {attempt.profiles?.full_name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Placeholder for camera feed */}
            <div className="bg-black aspect-video rounded-lg flex items-center justify-center">
              <div className="text-center text-white/60">
                <Camera className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Live camera stream</p>
                <p className="text-xs opacity-75">
                  (WebRTC implementation coming soon)
                </p>
              </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-4 gap-4">
              <div className="text-center p-3 bg-muted rounded-lg">
                <p className="text-2xl font-bold">
                  {attempt.proctoring_sessions?.[0]?.total_events || 0}
                </p>
                <p className="text-xs text-muted-foreground">Total Flags</p>
              </div>
              <div className="text-center p-3 bg-muted rounded-lg">
                <p className="text-2xl font-bold text-red-600">
                  {attempt.proctoring_sessions?.[0]?.high_severity_events || 0}
                </p>
                <p className="text-xs text-muted-foreground">High Severity</p>
              </div>
              <div className="text-center p-3 bg-muted rounded-lg">
                <p className="text-2xl font-bold text-amber-600">
                  {eventBreakdown
                    ? eventBreakdown.head_movement_left +
                      eventBreakdown.head_movement_right +
                      eventBreakdown.head_movement_up +
                      eventBreakdown.head_movement_down
                    : 0}
                </p>
                <p className="text-xs text-muted-foreground">Head Movements</p>
              </div>
              <div className="text-center p-3 bg-muted rounded-lg">
                <div className="text-sm font-medium">
                  {getStatusBadge(attempt)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Status</p>
              </div>
            </div>

            {/* Event Breakdown */}
            {eventBreakdown && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {eventBreakdown.face_not_detected > 0 && (
                  <Badge variant="outline" className="justify-between py-2">
                    <span className="flex items-center gap-1">
                      <UserX className="h-3 w-3" /> No Face
                    </span>
                    <span className="font-bold">{eventBreakdown.face_not_detected}</span>
                  </Badge>
                )}
                {eventBreakdown.multiple_faces > 0 && (
                  <Badge variant="outline" className="justify-between py-2">
                    <span className="flex items-center gap-1">
                      <Users className="h-3 w-3" /> Multi-Face
                    </span>
                    <span className="font-bold">{eventBreakdown.multiple_faces}</span>
                  </Badge>
                )}
                {eventBreakdown.tab_switch > 0 && (
                  <Badge variant="outline" className="justify-between py-2">
                    <span className="flex items-center gap-1">
                      <Monitor className="h-3 w-3" /> Tab Switch
                    </span>
                    <span className="font-bold">{eventBreakdown.tab_switch}</span>
                  </Badge>
                )}
                {eventBreakdown.window_blur > 0 && (
                  <Badge variant="outline" className="justify-between py-2">
                    <span className="flex items-center gap-1">
                      <Monitor className="h-3 w-3" /> Window Blur
                    </span>
                    <span className="font-bold">{eventBreakdown.window_blur}</span>
                  </Badge>
                )}
              </div>
            )}

            {/* Recent Event Log */}
            <div className="space-y-2">
              <h4 className="font-medium text-sm">Recent Activity</h4>
              <div className="bg-muted rounded-lg p-3 max-h-48 overflow-y-auto text-sm space-y-2">
                {recentEvents.length === 0 ? (
                  <p className="text-green-600">No suspicious activity detected</p>
                ) : (
                  recentEvents.slice(0, 20).map((event) => (
                    <div
                      key={event.id}
                      className={`flex items-start gap-2 p-2 rounded ${
                        event.severity === "high"
                          ? "bg-red-100 dark:bg-red-950/50 text-red-800 dark:text-red-200"
                          : event.severity === "medium"
                          ? "bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-200"
                          : "bg-background"
                      }`}
                    >
                      {event.screenshot_url ? (
                        <img 
                          src={event.screenshot_url} 
                          alt="Flag screenshot" 
                          className="w-16 h-12 object-cover rounded border"
                        />
                      ) : (
                        getEventIcon(event.event_type)
                      )}
                      <div className="flex-1 min-w-0">
                        <span className="text-sm">{event.description}</span>
                        <span className="text-xs opacity-75 ml-2">
                          {format(new Date(event.created_at), "h:mm:ss a")}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
