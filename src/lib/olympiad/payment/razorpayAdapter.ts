import type { FrontendPaymentAdapter } from "./types";

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => { open(): void; on(event: string, cb: (e: unknown) => void): void };
  }
}

type RazorpayOptions = {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  prefill: { name: string; email?: string; contact: string };
  notes?: Record<string, string>;
  handler: (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => void;
  modal?: { ondismiss?: () => void };
};

let razorpayScriptPromise: Promise<void> | null = null;

function loadRazorpayScript(): Promise<void> {
  if (razorpayScriptPromise) return razorpayScriptPromise;
  razorpayScriptPromise = new Promise((resolve, reject) => {
    if (typeof window === "undefined") return reject(new Error("Not in browser"));
    if (window.Razorpay) return resolve();
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Razorpay Checkout"));
    document.body.appendChild(script);
  });
  return razorpayScriptPromise;
}

type RazorpayClientPayload = {
  key_id: string;
  order_id: string;
  // Razorpay's checkout widget requires the amount in paise (its API contract).
  // This is the gateway boundary — the value is computed from rupees server-side.
  amount: number;
  school_name: string;
};

export const razorpayAdapter: FrontendPaymentAdapter = {
  name: "razorpay",
  async openCheckout({ clientPayload, payer }) {
    await loadRazorpayScript();
    if (!window.Razorpay) throw new Error("Razorpay script not loaded");

    const cp = clientPayload as RazorpayClientPayload;

    return new Promise<void>((resolve, reject) => {
      const rzp = new window.Razorpay!({
        key: cp.key_id,
        order_id: cp.order_id,
        amount: cp.amount,
        currency: "INR",
        name: "SALCI Olympiad",
        description: `Enrollment fee: ${cp.school_name}`,
        prefill: {
          name: payer.name,
          email: payer.email ?? undefined,
          contact: payer.phone,
        },
        handler: (_response) => resolve(),
        modal: { ondismiss: () => reject(new Error("Payment cancelled")) },
      });
      rzp.open();
    });
  },
};
