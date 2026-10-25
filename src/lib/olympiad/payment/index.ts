import type { FrontendPaymentAdapter } from "./types";
import { stubAdapter } from "./stubAdapter";
import { razorpayAdapter } from "./razorpayAdapter";

export function getPaymentAdapter(): FrontendPaymentAdapter {
  const choice = (import.meta.env.VITE_OLY_PAYMENT_ADAPTER ?? "stub").toString().toLowerCase();
  return choice === "razorpay" ? razorpayAdapter : stubAdapter;
}

export type { FrontendPaymentAdapter, PayerContact, CreateOrderInput, CreateOrderResult } from "./types";
