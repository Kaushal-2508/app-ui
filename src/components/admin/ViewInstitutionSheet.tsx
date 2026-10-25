import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { Building2, Mail, Phone, MapPin, Calendar, Users, GraduationCap, FileText, CreditCard, BookOpen, Grid3X3, Key, MoreHorizontal } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { InstitutionClassesTab } from "./institution/InstitutionClassesTab";
import { InstitutionSubjectsTab } from "./institution/InstitutionSubjectsTab";
import { SubjectMappingMatrix } from "./institution/SubjectMappingMatrix";
import { EditStudentPasswordDialog } from "./EditStudentPasswordDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ViewInstitutionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  institutionId: string | null;
}

export function ViewInstitutionSheet({ open, onOpenChange, institutionId }: ViewInstitutionSheetProps) {
  const [passwordResetUser, setPasswordResetUser] = useState<{ id: string; full_name: string; email: string } | null>(null);
  const queryClient = useQueryClient();
  
  const { data: institution, isLoading } = useQuery({
    queryKey: ["institution-details", institutionId],
    queryFn: async () => {
      if (!institutionId) return null;
      
      const { data, error } = await supabase
        .from("institutions")
        .select(`
          *,
          institution_subscriptions (plan_name, plan_type, status, monthly_amount, started_at, next_billing_date)
        `)
        .eq("id", institutionId)
        .single();
      
      if (error) throw error;

      // Counts come from the server (HEAD + exact count), never from the
      // length of a downloaded list: Supabase clips every read to 1000 rows,
      // which is why this sheet showed "Total Users 1000 / Total Exams 1000"
      // for Alliance on 2026-09-26. Only the four figures the sheet renders.
      const unwrap = ({ count, error: countError }: { count: number | null; error: { message: string } | null }) => {
        if (countError) throw new Error(countError.message);
        return count ?? 0;
      };
      const roleCount = async (role?: "teacher" | "student") => {
        const q = supabase
          .from("user_roles")
          .select("id", { count: "exact", head: true })
          .eq("institution_id", institutionId);
        return unwrap(await (role ? q.eq("role", role) : q));
      };
      const examCount = async () =>
        unwrap(
          await supabase
            .from("exams")
            .select("id", { count: "exact", head: true })
            .eq("institution_id", institutionId),
        );

      const [totalUsers, teachers, students, exams] = await Promise.all([
        roleCount(),
        roleCount("teacher"),
        roleCount("student"),
        examCount(),
      ]);

      return {
        ...data,
        stats: { teachers, students, totalUsers, exams },
      };
    },
    enabled: !!institutionId && open,
  });

  // Fetch institution users
  const { data: institutionUsers = [] } = useQuery({
    queryKey: ["institution-users", institutionId],
    queryFn: async () => {
      if (!institutionId) return [];
      
      // Paged: a school with 1000+ accounts was cut off at 1000 profiles, and
      // the old `.in("user_id", <1000 ids>)` role lookup put every id in the
      // URL. Roles are read by institution_id instead, in pages too.
      const [profiles, roles] = await Promise.all([
        fetchAllRows<{ id: string; full_name: string | null; email: string | null; is_active: boolean | null }>(
          (from, to) =>
            supabase
              .from("profiles")
              .select("id, full_name, email, is_active")
              .eq("institution_id", institutionId)
              .order("full_name")
              .order("id")
              .range(from, to),
        ),
        fetchAllRows<{ user_id: string; role: string }>((from, to) =>
          supabase
            .from("user_roles")
            .select("user_id, role")
            .eq("institution_id", institutionId)
            .order("id")
            .range(from, to),
        ),
      ]);

      const roleByUser = new Map<string, string>();
      for (const r of roles) if (!roleByUser.has(r.user_id)) roleByUser.set(r.user_id, r.role);

      return profiles.map(p => ({
        ...p,
        role: roleByUser.get(p.id) || "unknown",
      }));
    },
    enabled: !!institutionId && open,
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Institution Details</SheetTitle>
        </SheetHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
          </div>
        ) : institution ? (
          <div className="mt-6">
            {/* Header */}
            <div className="flex items-start gap-4 mb-6">
              <div className="h-14 w-14 rounded-lg bg-primary/10 flex items-center justify-center">
                <Building2 className="h-7 w-7 text-primary" />
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-semibold">{institution.name}</h2>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="outline">{institution.code}</Badge>
                  <Badge variant={institution.is_active ? "default" : "secondary"}>
                    {institution.is_active ? "Active" : "Inactive"}
                  </Badge>
                </div>
              </div>
            </div>

            <Tabs defaultValue="overview" className="space-y-4">
              <TabsList className="grid w-full grid-cols-5">
                <TabsTrigger value="overview" className="text-xs">
                  <Building2 className="h-3.5 w-3.5 mr-1" />
                  Overview
                </TabsTrigger>
                <TabsTrigger value="users" className="text-xs">
                  <Users className="h-3.5 w-3.5 mr-1" />
                  Users
                </TabsTrigger>
                <TabsTrigger value="classes" className="text-xs">
                  <GraduationCap className="h-3.5 w-3.5 mr-1" />
                  Classes
                </TabsTrigger>
                <TabsTrigger value="subjects" className="text-xs">
                  <BookOpen className="h-3.5 w-3.5 mr-1" />
                  Subjects
                </TabsTrigger>
                <TabsTrigger value="mapping" className="text-xs">
                  <Grid3X3 className="h-3.5 w-3.5 mr-1" />
                  Mapping
                </TabsTrigger>
              </TabsList>

              {/* Overview Tab */}
              <TabsContent value="overview" className="space-y-4">
                {/* Contact Info */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium">Contact Information</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {institution.contact_email && (
                      <div className="flex items-center gap-3 text-sm">
                        <Mail className="h-4 w-4 text-muted-foreground" />
                        <span>{institution.contact_email}</span>
                      </div>
                    )}
                    {institution.contact_phone && (
                      <div className="flex items-center gap-3 text-sm">
                        <Phone className="h-4 w-4 text-muted-foreground" />
                        <span>{institution.contact_phone}</span>
                      </div>
                    )}
                    {institution.address && (
                      <div className="flex items-start gap-3 text-sm">
                        <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
                        <span>{institution.address}</span>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Stats */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium">Overview</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="text-center p-3 bg-muted/50 rounded-lg">
                        <Users className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
                        <p className="text-2xl font-bold">{institution.stats.totalUsers}</p>
                        <p className="text-xs text-muted-foreground">Total Users</p>
                      </div>
                      <div className="text-center p-3 bg-muted/50 rounded-lg">
                        <FileText className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
                        <p className="text-2xl font-bold">{institution.stats.exams}</p>
                        <p className="text-xs text-muted-foreground">Total Exams</p>
                      </div>
                      <div className="text-center p-3 bg-muted/50 rounded-lg">
                        <GraduationCap className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
                        <p className="text-2xl font-bold">{institution.stats.teachers}</p>
                        <p className="text-xs text-muted-foreground">Teachers</p>
                      </div>
                      <div className="text-center p-3 bg-muted/50 rounded-lg">
                        <Users className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
                        <p className="text-2xl font-bold">{institution.stats.students}</p>
                        <p className="text-xs text-muted-foreground">Students</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Subscription */}
                {institution.institution_subscriptions?.[0] && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <CreditCard className="h-4 w-4" />
                        Subscription
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Plan</span>
                        <Badge variant="outline" className="capitalize">
                          {institution.institution_subscriptions[0].plan_name}
                        </Badge>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Status</span>
                        <Badge variant={institution.institution_subscriptions[0].status === "active" ? "default" : "secondary"}>
                          {institution.institution_subscriptions[0].status}
                        </Badge>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Monthly Amount</span>
                        <span className="font-medium">
                          ${institution.institution_subscriptions[0].monthly_amount?.toFixed(2) || "0.00"}
                        </span>
                      </div>
                      {institution.institution_subscriptions[0].next_billing_date && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Next Billing</span>
                          <span>
                            {format(new Date(institution.institution_subscriptions[0].next_billing_date), "MMM d, yyyy")}
                          </span>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Timestamps */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Calendar className="h-4 w-4" />
                      Activity
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm text-muted-foreground">
                    <div className="flex justify-between">
                      <span>Created</span>
                      <span>{format(new Date(institution.created_at), "PPp")}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Last Updated</span>
                      <span>{format(new Date(institution.updated_at), "PPp")}</span>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Users Tab */}
              <TabsContent value="users" className="space-y-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium">
                      Institution Users ({institutionUsers.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead>Role</TableHead>
                          <TableHead className="w-[50px]"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {institutionUsers.map((user) => (
                          <TableRow key={user.id}>
                            <TableCell className="font-medium">{user.full_name}</TableCell>
                            <TableCell className="text-muted-foreground text-sm">{user.email}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="capitalize text-xs">
                                {user.role?.replace("_", " ")}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => setPasswordResetUser(user)}>
                                    <Key className="h-4 w-4 mr-2" />
                                    Reset Password
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        ))}
                        {institutionUsers.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                              No users found in this institution
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Classes Tab */}
              <TabsContent value="classes">
                <InstitutionClassesTab institutionId={institutionId!} />
              </TabsContent>

              {/* Subjects Tab */}
              <TabsContent value="subjects">
                <InstitutionSubjectsTab institutionId={institutionId!} />
              </TabsContent>

              {/* Mapping Tab */}
              <TabsContent value="mapping">
                <SubjectMappingMatrix institutionId={institutionId!} />
              </TabsContent>
            </Tabs>
          </div>
        ) : (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            Institution not found
          </div>
        )}
      </SheetContent>

      {/* Password Reset Dialog */}
      <EditStudentPasswordDialog
        open={!!passwordResetUser}
        onOpenChange={(open) => !open && setPasswordResetUser(null)}
        student={passwordResetUser}
      />
    </Sheet>
  );
}
