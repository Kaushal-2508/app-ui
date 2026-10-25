import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { 
  CreditCard, 
  CheckCircle2,
  Clock,
  FileText,
  Building2,
  AlertCircle,
  Calendar,
  Download,
  Eye
} from "lucide-react";
import { useInstitutionBilling } from "@/hooks/usePayments";
import { format } from "date-fns";
import { ReceiptGenerator, generateReceiptNumber } from "./ReceiptGenerator";

interface SchoolBillingDashboardProps {
  institutionId: string | null;
}

export function SchoolBillingDashboard({ institutionId }: SchoolBillingDashboardProps) {
  const { data: billing, isLoading } = useInstitutionBilling(institutionId);
  const [selectedPayment, setSelectedPayment] = useState<any>(null);

  if (isLoading) {
    return <BillingSkeleton />;
  }

  if (!billing || !institutionId) {
    return (
      <div className="text-center py-12">
        <CreditCard className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
        <p className="text-muted-foreground">No billing information available.</p>
      </div>
    );
  }

  const { subscription, payments, totalPaid } = billing;

  return (
    <div className="space-y-6">
      {/* Current Plan */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            Subscription Details
          </CardTitle>
          <CardDescription>Your current plan and billing information</CardDescription>
        </CardHeader>
        <CardContent>
          {subscription ? (
            <div className="grid gap-6 md:grid-cols-2">
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-muted-foreground">Institution</p>
                  <p className="text-lg font-medium">{subscription.institutions?.name || "N/A"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Current Plan</p>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-medium capitalize">{subscription.plan_name}</span>
                    <Badge variant="outline" className="capitalize">{subscription.plan_type}</Badge>
                  </div>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Status</p>
                  <SubscriptionStatusBadge status={subscription.status} />
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <p className="text-sm text-muted-foreground">Monthly Amount</p>
                  <p className="text-2xl font-bold">
                    ₹{Number(subscription.monthly_amount).toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Next Billing Date</p>
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <p className="font-medium">
                      {subscription.next_billing_date 
                        ? format(new Date(subscription.next_billing_date), "MMMM d, yyyy") 
                        : "N/A"}
                    </p>
                  </div>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Member Since</p>
                  <p className="font-medium">
                    {subscription.started_at 
                      ? format(new Date(subscription.started_at), "MMMM yyyy") 
                      : "N/A"}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-8">
              <CreditCard className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground">No subscription found.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payment History (Read-only) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Payment History
          </CardTitle>
          <CardDescription>
            Total paid: ₹{totalPaid.toLocaleString()}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {payments.length > 0 ? (
            <div className="space-y-3">
              {payments.map((payment) => (
                <div key={payment.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div>
                    <p className="font-medium">{payment.description || payment.payment_type}</p>
                    <p className="text-sm text-muted-foreground">
                      {payment.payment_date 
                        ? format(new Date(payment.payment_date), "MMM d, yyyy")
                        : format(new Date(payment.created_at), "MMM d, yyyy")}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="font-bold">₹{Number(payment.amount).toLocaleString()}</p>
                      <PaymentStatusBadge status={payment.status} />
                    </div>
                    {payment.status === "completed" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setSelectedPayment({
                          id: payment.id,
                          receiptNumber: generateReceiptNumber(),
                          institutionName: subscription?.institutions?.name || "Institution",
                          paymentDate: payment.payment_date || payment.created_at,
                          amount: payment.amount,
                          paymentType: payment.payment_type,
                          description: payment.description,
                          status: payment.status,
                        })}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <FileText className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
              <p className="text-muted-foreground">No payment history available.</p>
              <p className="text-sm text-muted-foreground">
                Payment records will appear here once billing is set up.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Billing Notice */}
      <Card className="border-muted">
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <CreditCard className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="font-medium text-muted-foreground">Read-Only Access</p>
              <p className="text-sm text-muted-foreground">
                Contact your Super Admin to make changes to billing or subscription settings.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Receipt Dialog */}
      <Dialog open={!!selectedPayment} onOpenChange={(open) => !open && setSelectedPayment(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Payment Receipt</DialogTitle>
          </DialogHeader>
          {selectedPayment && (
            <ReceiptGenerator 
              payment={selectedPayment} 
              onClose={() => setSelectedPayment(null)} 
            />
          )}
        </DialogContent>
      </Dialog>
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
    <Badge variant={variant} className="gap-1 capitalize mt-1">
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
    <Badge variant={variants[status] || "secondary"} className="capitalize">
      {status}
    </Badge>
  );
}

function BillingSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-48" />
      <Skeleton className="h-64" />
    </div>
  );
}
