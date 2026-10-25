import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { 
  DollarSign, 
  Building2,
  TrendingUp,
  CreditCard,
  CheckCircle2,
  AlertCircle,
  Clock,
  Download,
  RefreshCw
} from "lucide-react";
import { useRevenueAnalytics } from "@/hooks/usePayments";
import { format } from "date-fns";

export function RevenueDashboard() {
  const { data, isLoading, refetch } = useRevenueAnalytics();

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  if (!data) {
    return (
      <div className="text-center py-12">
        <DollarSign className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
        <p className="text-muted-foreground">No revenue data available.</p>
      </div>
    );
  }

  const { metrics, institutionBilling } = data;

  return (
    <div className="space-y-6">
      {/* Revenue Overview */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Revenue
            </CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ₹{metrics.totalRevenue.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">Lifetime</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Monthly Recurring
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              ₹{metrics.monthlyRecurringRevenue.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">MRR</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Active Subscriptions
            </CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.activeSubscriptions}</div>
            <p className="text-xs text-muted-foreground">Institutions</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Avg Revenue/School
            </CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ₹{Math.round(metrics.avgRevenuePerSchool).toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">Per month</p>
          </CardContent>
        </Card>
      </div>

      {/* Institution Billing Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Institution Billing</CardTitle>
              <CardDescription>Subscription status for all institutions</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {institutionBilling.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 text-sm font-medium text-muted-foreground">Institution</th>
                    <th className="text-center py-3 text-sm font-medium text-muted-foreground">Status</th>
                    <th className="text-center py-3 text-sm font-medium text-muted-foreground">Plan</th>
                    <th className="text-right py-3 text-sm font-medium text-muted-foreground">Monthly</th>
                    <th className="text-right py-3 text-sm font-medium text-muted-foreground">Last Payment</th>
                    <th className="text-right py-3 text-sm font-medium text-muted-foreground">Next Billing</th>
                  </tr>
                </thead>
                <tbody>
                  {institutionBilling.map((inst) => (
                    <tr key={inst.id} className="border-b last:border-0">
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <span className="font-medium">{inst.institutionName}</span>
                            <span className="text-xs text-muted-foreground ml-2">({inst.institutionCode})</span>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 text-center">
                        <SubscriptionStatusBadge status={inst.status} />
                      </td>
                      <td className="py-3 text-center">
                        <Badge variant="outline" className="capitalize">{inst.planName}</Badge>
                      </td>
                      <td className="py-3 text-right font-medium">
                        ₹{inst.monthlyAmount.toLocaleString()}
                      </td>
                      <td className="py-3 text-right text-muted-foreground">
                        {inst.lastPayment?.payment_date 
                          ? format(new Date(inst.lastPayment.payment_date), "MMM d, yyyy") 
                          : "N/A"}
                      </td>
                      <td className="py-3 text-right text-muted-foreground">
                        {inst.nextBillingDate 
                          ? format(new Date(inst.nextBillingDate), "MMM d, yyyy") 
                          : "N/A"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8">
              <Building2 className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground">No subscription data yet.</p>
              <p className="text-sm text-muted-foreground">
                Subscriptions will appear here when institutions are added.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SubscriptionStatusBadge({ status }: { status: string }) {
  const config: Record<string, { icon: typeof CheckCircle2; variant: "default" | "secondary" | "destructive" }> = {
    active: { icon: CheckCircle2, variant: "default" },
    inactive: { icon: Clock, variant: "secondary" },
    past_due: { icon: AlertCircle, variant: "destructive" },
    suspended: { icon: AlertCircle, variant: "destructive" },
    cancelled: { icon: AlertCircle, variant: "secondary" },
  };

  const { icon: Icon, variant } = config[status] || config.inactive;

  return (
    <Badge variant={variant} className="gap-1 capitalize">
      <Icon className="h-3 w-3" />
      {status.replace("_", " ")}
    </Badge>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map(i => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}
