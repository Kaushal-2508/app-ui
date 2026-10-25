export type PayerContact = {
  name: string;
  email: string | null;
  phone: string;
};

export type CreateOrderInput = {
  amountRupees: number;
  orderRef: string;
  payer: PayerContact;
  receipt: string;
};

export type CreateOrderResult = {
  transactionId: string;
  clientPayload: unknown;
};

export type RefundInput = {
  transactionId: string;
  paymentId: string;
  amountRupees: number;
  reason: string;
};

export type RefundResult = {
  refundId: string;
  status: "queued" | "completed" | "failed";
  failureReason?: string;
};

export type AdapterName = "stub" | "razorpay";

export interface FrontendPaymentAdapter {
  readonly name: AdapterName;
  /**
   * Renders the gateway checkout UI (e.g. Razorpay modal). Resolves when
   * the gateway confirms client-side success; rejects on cancel/failure.
   * The webhook handler is the authoritative source.
   */
  openCheckout(input: {
    clientPayload: unknown;
    pendingId: string;
    payer: PayerContact;
  }): Promise<void>;
}
