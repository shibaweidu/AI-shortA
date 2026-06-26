import { withAdminHeaders } from "./adminApi";

const API_BASE = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(/\/+$/, "") || "";

export type PaymentMode = "external" | "api";

export type PaymentSettings = {
  enabled: boolean;
  providerName: string;
  mode: PaymentMode;
  createOrderUrl: string;
  method: "POST" | "GET";
  headersJson: string;
  payloadTemplate: string;
  payUrlField: string;
  orderIdField: string;
  webhookSecret: string;
  successUrl: string;
  cancelUrl: string;
};

export const DEFAULT_PAYMENT_SETTINGS: PaymentSettings = {
  enabled: false,
  providerName: "",
  mode: "external",
  createOrderUrl: "",
  method: "POST",
  headersJson: "",
  payloadTemplate: JSON.stringify(
    {
      orderId: "{{orderId}}",
      packageId: "{{packageId}}",
      packageName: "{{packageName}}",
      amount: "{{price}}",
      credits: "{{credits}}",
      userId: "{{userId}}",
      successUrl: "{{successUrl}}",
      cancelUrl: "{{cancelUrl}}",
    },
    null,
    2
  ),
  payUrlField: "payUrl",
  orderIdField: "orderId",
  webhookSecret: "",
  successUrl: "",
  cancelUrl: "",
};

export type PaymentOrderResponse = {
  mode: PaymentMode;
  payUrl: string;
  orderId: string;
};

async function readError(response: Response) {
  const data = await response.json().catch(() => null);
  return data?.error || data?.message || `Request failed: ${response.status}`;
}

export async function fetchPaymentSettings(): Promise<PaymentSettings> {
  const response = await fetch(`${API_BASE}/api/payment-settings`, withAdminHeaders({ cache: "no-store" }));
  if (!response.ok) throw new Error(await readError(response));
  return { ...DEFAULT_PAYMENT_SETTINGS, ...(await response.json()) };
}

export async function updatePaymentSettings(settings: PaymentSettings): Promise<PaymentSettings> {
  const response = await fetch(`${API_BASE}/api/payment-settings`, withAdminHeaders({
    method: "PUT",
    body: JSON.stringify(settings),
  }, true));
  if (!response.ok) throw new Error(await readError(response));
  return { ...DEFAULT_PAYMENT_SETTINGS, ...(await response.json()) };
}

export async function createPaymentOrder(input: { packageId: string; userId: string; returnUrl?: string }): Promise<PaymentOrderResponse> {
  const response = await fetch(`${API_BASE}/api/payments/create-order`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}
