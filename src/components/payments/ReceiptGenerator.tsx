import { saveBlob } from "@/lib/native";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { 
  FileText, 
  Download, 
  Printer, 
  Building2, 
  Calendar,
  CheckCircle2,
  Mail
} from "lucide-react";
import { format } from "date-fns";

interface ReceiptData {
  id: string;
  receiptNumber: string;
  institutionName: string;
  institutionAddress?: string;
  paymentDate: string;
  amount: number;
  paymentType: string;
  description?: string;
  status: string;
  billingPeriod?: string;
  paymentMethod?: string;
}

interface ReceiptGeneratorProps {
  payment: ReceiptData;
  onClose?: () => void;
}

export function ReceiptGenerator({ payment, onClose }: ReceiptGeneratorProps) {
  const [isPrinting, setIsPrinting] = useState(false);

  const handlePrint = () => {
    setIsPrinting(true);
    // Prints the page itself; Phase 2 of the native app routes this through printHtml.
    window.print();
    setTimeout(() => setIsPrinting(false), 1000);
  };

  const handleDownload = async () => {
    // Create a simple text receipt for download
    const receiptText = `
PAYMENT RECEIPT
=====================================

Receipt No: ${payment.receiptNumber}
Date: ${format(new Date(payment.paymentDate), "MMMM d, yyyy")}

Institution: ${payment.institutionName}
${payment.institutionAddress ? `Address: ${payment.institutionAddress}` : ""}

Payment Details:
- Type: ${payment.paymentType}
- Description: ${payment.description || "Subscription Payment"}
- Amount: ₹${Number(payment.amount).toLocaleString()}
- Status: ${payment.status.toUpperCase()}
${payment.billingPeriod ? `- Billing Period: ${payment.billingPeriod}` : ""}
${payment.paymentMethod ? `- Payment Method: ${payment.paymentMethod}` : ""}

=====================================
Thank you for your payment!
    `.trim();

    const blob = new Blob([receiptText], { type: "text/plain" });
    saveBlob(blob, `receipt-${payment.receiptNumber}.txt`);
  };

  return (
    <div className="space-y-4 print:p-8">
      {/* Receipt Header */}
      <Card className="print:shadow-none print:border-2">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="h-6 w-6 text-primary" />
              <CardTitle>Payment Receipt</CardTitle>
            </div>
            <Badge 
              variant={payment.status === "completed" ? "default" : "secondary"}
              className="uppercase"
            >
              {payment.status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Receipt Info */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Receipt Number</p>
              <p className="font-mono font-bold text-lg">{payment.receiptNumber}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground flex items-center gap-1">
                <Calendar className="h-3 w-3" /> Date
              </p>
              <p className="font-medium">
                {format(new Date(payment.paymentDate), "MMMM d, yyyy")}
              </p>
            </div>
          </div>

          <Separator />

          {/* Institution Details */}
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground flex items-center gap-1">
              <Building2 className="h-3 w-3" /> Bill To
            </p>
            <p className="font-semibold text-lg">{payment.institutionName}</p>
            {payment.institutionAddress && (
              <p className="text-sm text-muted-foreground">{payment.institutionAddress}</p>
            )}
          </div>

          <Separator />

          {/* Payment Details */}
          <div className="space-y-3">
            <p className="font-medium">Payment Details</p>
            <div className="bg-muted/50 rounded-lg p-4 space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Payment Type</span>
                <span className="font-medium capitalize">{payment.paymentType}</span>
              </div>
              {payment.description && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Description</span>
                  <span>{payment.description}</span>
                </div>
              )}
              {payment.billingPeriod && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Billing Period</span>
                  <span>{payment.billingPeriod}</span>
                </div>
              )}
              {payment.paymentMethod && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Payment Method</span>
                  <span className="capitalize">{payment.paymentMethod}</span>
                </div>
              )}
            </div>
          </div>

          <Separator />

          {/* Amount */}
          <div className="flex items-center justify-between p-4 bg-primary/5 rounded-lg">
            <div>
              <p className="text-sm text-muted-foreground">Total Amount</p>
              <p className="text-3xl font-bold">₹{Number(payment.amount).toLocaleString()}</p>
            </div>
            {payment.status === "completed" && (
              <CheckCircle2 className="h-10 w-10 text-green-600" />
            )}
          </div>

          {/* Footer Note */}
          <p className="text-xs text-center text-muted-foreground pt-4">
            This is a computer-generated receipt. No signature required.
          </p>
        </CardContent>
      </Card>

      {/* Actions - Hidden in print */}
      <div className="flex justify-end gap-2 print:hidden">
        {onClose && (
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        )}
        <Button variant="outline" onClick={handleDownload}>
          <Download className="h-4 w-4 mr-2" />
          Download
        </Button>
        <Button onClick={handlePrint} disabled={isPrinting}>
          <Printer className="h-4 w-4 mr-2" />
          {isPrinting ? "Printing..." : "Print"}
        </Button>
      </div>
    </div>
  );
}

export function generateReceiptNumber(): string {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `RCP-${year}${month}-${random}`;
}
