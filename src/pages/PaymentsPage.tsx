import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RevenueDashboard } from "@/components/payments/RevenueDashboard";
import { InstitutionBillingList } from "@/components/payments/InstitutionBillingList";
import { SchoolBillingDashboard } from "@/components/payments/SchoolBillingDashboard";
import { useUserRole } from "@/hooks/useUserRole";
import { CreditCard, Building2 } from "lucide-react";

export default function PaymentsPage() {
  const { data: userRole } = useUserRole();
  const role = userRole?.primaryRole;
  const institutionId = userRole?.institutionId;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <CreditCard className="h-6 w-6" />
          {role === "super_admin" ? "Payments & Revenue" : "Billing"}
        </h1>
        <p className="text-muted-foreground">
          {role === "super_admin" 
            ? "Manage subscriptions and view revenue" 
            : "View your subscription and billing history"}
        </p>
      </div>

      {role === "super_admin" ? (
        <Tabs defaultValue="revenue" className="space-y-6">
          <TabsList>
            <TabsTrigger value="revenue" className="gap-2">
              <CreditCard className="h-4 w-4" />
              Revenue Overview
            </TabsTrigger>
            <TabsTrigger value="institutions" className="gap-2">
              <Building2 className="h-4 w-4" />
              Institution Billing
            </TabsTrigger>
          </TabsList>

          <TabsContent value="revenue">
            <RevenueDashboard />
          </TabsContent>

          <TabsContent value="institutions">
            <InstitutionBillingList />
          </TabsContent>
        </Tabs>
      ) : (
        <SchoolBillingDashboard institutionId={institutionId} />
      )}
    </div>
  );
}
