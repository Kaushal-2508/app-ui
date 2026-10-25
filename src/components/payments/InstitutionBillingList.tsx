import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useRevenueAnalytics, useInstitutionBilling } from "@/hooks/usePayments";
import { format } from "date-fns";
import { 
  Search, 
  Building2, 
  CreditCard, 
  Calendar,
  CheckCircle2,
  AlertCircle,
  Clock,
  XCircle,
  IndianRupee
} from "lucide-react";

interface InstitutionBillingDetails {
  institutionId: string;
  institutionName: string;
}

export function InstitutionBillingList() {
  const { data, isLoading } = useRevenueAnalytics();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedInstitution, setSelectedInstitution] = useState<InstitutionBillingDetails | null>(null);

  if (isLoading) {
    return <BillingSkeleton />;
  }

  const filteredInstitutions = data?.institutionBilling.filter(inst => 
    inst.institutionName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    inst.institutionCode.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  return (
    <div className="space-y-6">
      {/* Search */}
      <Card>
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search institutions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      {/* Institutions Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Institution Billing
          </CardTitle>
          <CardDescription>
            Click on an institution to view detailed billing information
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Institution</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Monthly Amount</TableHead>
                <TableHead>Next Billing</TableHead>
                <TableHead>Last Payment</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredInstitutions.length > 0 ? (
                filteredInstitutions.map((inst) => (
                  <TableRow 
                    key={inst.id} 
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setSelectedInstitution({
                      institutionId: inst.institutionId,
                      institutionName: inst.institutionName
                    })}
                  >
                    <TableCell>
                      <div>
                        <p className="font-medium">{inst.institutionName}</p>
                        <p className="text-xs text-muted-foreground">{inst.institutionCode}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{inst.planName}</Badge>
                    </TableCell>
                    <TableCell>
                      <SubscriptionStatusBadge status={inst.status} />
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      <span className="flex items-center justify-end gap-1">
                        <IndianRupee className="h-3 w-3" />
                        {inst.monthlyAmount.toLocaleString()}
                      </span>
                    </TableCell>
                    <TableCell>
                      {inst.nextBillingDate 
                        ? format(new Date(inst.nextBillingDate), "MMM d, yyyy")
                        : "-"
                      }
                    </TableCell>
                    <TableCell>
                      {inst.lastPayment?.payment_date 
                        ? format(new Date(inst.lastPayment.payment_date), "MMM d, yyyy")
                        : "-"
                      }
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm">
                        View Details
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    {searchQuery ? "No institutions match your search" : "No institutions found"}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Institution Details Sheet */}
      <Sheet open={!!selectedInstitution} onOpenChange={() => setSelectedInstitution(null)}>
        <SheetContent className="sm:max-w-xl overflow-y-auto">
          {selectedInstitution && (
            <InstitutionBillingDetails 
              institutionId={selectedInstitution.institutionId}
              institutionName={selectedInstitution.institutionName}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function InstitutionBillingDetails({ 
  institutionId, 
  institutionName 
}: { 
  institutionId: string; 
  institutionName: string;
}) {
  const { data, isLoading } = useInstitutionBilling(institutionId);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <SheetHeader>
          <SheetTitle>{institutionName}</SheetTitle>
          <SheetDescription>Loading billing details...</SheetDescription>
        </SheetHeader>
        <div className="space-y-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-48" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          <Building2 className="h-5 w-5" />
          {institutionName}
        </SheetTitle>
        <SheetDescription>Billing and subscription details</SheetDescription>
      </SheetHeader>

      {/* Subscription Info */}
      {data?.subscription && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <CreditCard className="h-4 w-4" />
              Current Subscription
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Plan</span>
              <Badge>{data.subscription.plan_name}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Status</span>
              <SubscriptionStatusBadge status={data.subscription.status} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Monthly Amount</span>
              <span className="font-medium flex items-center gap-1">
                <IndianRupee className="h-3 w-3" />
                {Number(data.subscription.monthly_amount).toLocaleString()}
              </span>
            </div>
            {data.subscription.next_billing_date && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Next Billing</span>
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {format(new Date(data.subscription.next_billing_date), "MMM d, yyyy")}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Payment Summary */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Payment Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center p-4 bg-muted/50 rounded-lg">
            <p className="text-sm text-muted-foreground">Total Paid</p>
            <p className="text-2xl font-bold flex items-center justify-center gap-1">
              <IndianRupee className="h-5 w-5" />
              {data?.totalPaid.toLocaleString() || 0}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Payment History */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Payment History</CardTitle>
        </CardHeader>
        <CardContent>
          {data?.payments && data.payments.length > 0 ? (
            <div className="space-y-2">
              {data.payments.slice(0, 10).map((payment) => (
                <div 
                  key={payment.id} 
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div>
                    <p className="font-medium flex items-center gap-1">
                      <IndianRupee className="h-3 w-3" />
                      {Number(payment.amount).toLocaleString()}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {payment.description || payment.payment_type}
                    </p>
                  </div>
                  <div className="text-right">
                    <PaymentStatusBadge status={payment.status} />
                    <p className="text-xs text-muted-foreground mt-1">
                      {payment.payment_date 
                        ? format(new Date(payment.payment_date), "MMM d, yyyy")
                        : "Pending"
                      }
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center text-muted-foreground py-8">
              No payment history available
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SubscriptionStatusBadge({ status }: { status: string }) {
  const statusConfig: Record<string, { icon: typeof CheckCircle2; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    active: { icon: CheckCircle2, variant: "default" },
    trial: { icon: Clock, variant: "secondary" },
    past_due: { icon: AlertCircle, variant: "destructive" },
    cancelled: { icon: XCircle, variant: "outline" },
  };

  const config = statusConfig[status] || { icon: AlertCircle, variant: "outline" as const };
  const Icon = config.icon;

  return (
    <Badge variant={config.variant} className="gap-1 capitalize">
      <Icon className="h-3 w-3" />
      {status.replace("_", " ")}
    </Badge>
  );
}

function PaymentStatusBadge({ status }: { status: string }) {
  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    completed: "default",
    pending: "secondary",
    failed: "destructive",
    refunded: "outline",
  };

  return (
    <Badge variant={variants[status] || "outline"} className="capitalize">
      {status}
    </Badge>
  );
}

function BillingSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-16" />
      <Skeleton className="h-96" />
    </div>
  );
}
