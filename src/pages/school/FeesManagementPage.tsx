import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUserRole } from "@/hooks/useUserRole";
import { useProfileData } from "@/hooks/useProfileData";
import { Loader2, Layers, Users, CreditCard, Calendar, AlertTriangle, BarChart3, Award } from "lucide-react";
import { FeeStructurePanel } from "@/components/fees/FeeStructurePanel";
import { StudentFeesPanel } from "@/components/fees/StudentFeesPanel";
import { FeeCollectionPanel } from "@/components/fees/FeeCollectionPanel";
import { InstallmentSchedulePanel } from "@/components/fees/InstallmentSchedulePanel";
import { DefaulterTracker } from "@/components/fees/DefaulterTracker";
import { FeeAnalyticsDashboard } from "@/components/fees/FeeAnalyticsDashboard";
import { FeeConcessionPanel } from "@/components/fees/FeeConcessionPanel";

export default function FeesManagementPage() {
  const { data: roleInfo, isLoading: roleLoading } = useUserRole();
  const { data: profile, isLoading: profileLoading } = useProfileData();
  const institutionId = profile?.institution_id;

  if (roleLoading || profileLoading) {
    return (
      <SidebarProvider>
        <div className="flex min-h-dvh w-full">
          <AppSidebar />
          <main className="flex-1 p-6 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </main>
        </div>
      </SidebarProvider>
    );
  }

  if (!institutionId) {
    return (
      <SidebarProvider>
        <div className="flex min-h-dvh w-full">
          <AppSidebar />
          <main className="flex-1 p-6">
            <p className="text-muted-foreground">No institution found.</p>
          </main>
        </div>
      </SidebarProvider>
    );
  }

  const isAdmin = roleInfo?.isSchoolAdmin || roleInfo?.isSuperAdmin;

  return (
    <SidebarProvider>
      <div className="flex min-h-dvh w-full">
        <AppSidebar />
        <main className="flex-1 p-6 overflow-auto">
          <div className="mb-6">
            <h1 className="text-2xl font-bold">Fee Management</h1>
            <p className="text-muted-foreground">Manage fee structures, assignments, collections, and reports</p>
          </div>

          <Tabs defaultValue="structure" className="space-y-4">
            <TabsList className="flex-wrap h-auto gap-1">
              <TabsTrigger value="structure" className="gap-1">
                <Layers className="h-4 w-4" /> Fee Structure
              </TabsTrigger>
              <TabsTrigger value="students" className="gap-1">
                <Users className="h-4 w-4" /> Student Fees
              </TabsTrigger>
              <TabsTrigger value="collection" className="gap-1">
                <CreditCard className="h-4 w-4" /> Payments
              </TabsTrigger>
              <TabsTrigger value="installments" className="gap-1">
                <Calendar className="h-4 w-4" /> Installments
              </TabsTrigger>
              <TabsTrigger value="defaulters" className="gap-1">
                <AlertTriangle className="h-4 w-4" /> Defaulters
              </TabsTrigger>
              <TabsTrigger value="reports" className="gap-1">
                <BarChart3 className="h-4 w-4" /> Reports
              </TabsTrigger>
              <TabsTrigger value="concessions" className="gap-1">
                <Award className="h-4 w-4" /> Concessions
              </TabsTrigger>
            </TabsList>

            <TabsContent value="structure">
              <FeeStructurePanel institutionId={institutionId} />
            </TabsContent>

            <TabsContent value="students">
              <StudentFeesPanel institutionId={institutionId} />
            </TabsContent>

            <TabsContent value="collection">
              <FeeCollectionPanel institutionId={institutionId} />
            </TabsContent>

            <TabsContent value="installments">
              <InstallmentSchedulePanel institutionId={institutionId} />
            </TabsContent>

            <TabsContent value="defaulters">
              <DefaulterTracker institutionId={institutionId} />
            </TabsContent>

            <TabsContent value="reports">
              <FeeAnalyticsDashboard institutionId={institutionId} />
            </TabsContent>

            <TabsContent value="concessions">
              <FeeConcessionPanel institutionId={institutionId} />
            </TabsContent>
          </Tabs>
        </main>
      </div>
    </SidebarProvider>
  );
}
