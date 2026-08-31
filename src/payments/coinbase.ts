import { generateJwt } from "@coinbase/cdp-sdk/auth";
import type { CreatePaymentInput, CreatedPayment, PaymentProvider, PaymentStatus } from "./provider.js";

const host = "api.cdp.coinbase.com";
const apiBase = `https://${host}`;

async function auth(method: string, path: string) {
  const apiKeyId = process.env.CDP_API_KEY_ID;
  const apiKeySecret = process.env.CDP_API_KEY_SECRET;
  if (!apiKeyId || !apiKeySecret) throw new Error("CDP_API_KEY_ID and CDP_API_KEY_SECRET are required");
  return generateJwt({ apiKeyId, apiKeySecret, requestMethod: method, requestHost: host, requestPath: path, expiresIn: 120 });
}

async function cdp<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await auth(method, path);
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`Coinbase API ${response.status}: ${await response.text()}`);
  return response.json() as Promise<T>;
}

export class CoinbaseOnrampProvider implements PaymentProvider {
  readonly name = "coinbase";

  async createPayment(input: CreatePaymentInput): Promise<CreatedPayment> {
    const amount = Number(input.amountUsdc).toFixed(2);
    const partnerUserRef = `${process.env.COINBASE_ONRAMP_SANDBOX === "true" ? "sandbox-" : ""}${input.goalieRequestId}`;

    if (input.method === "card") {
      const path = "/platform/v2/onramp/sessions";
      const data = await cdp<any>("POST", path, {
        purchaseCurrency: "USDC",
        destinationNetwork: "base",
        destinationAddress: input.destinationAddress,
        purchaseAmount: amount,
        paymentCurrency: "USD",
        paymentMethod: "CARD",
        country: "US",
        redirectUrl: `${process.env.APP_BASE_URL}/payments/return/${input.goalieRequestId}`,
        clientIp: input.clientIp,
        partnerUserRef,
      });
      return { provider: this.name, checkoutUrl: data.session.onrampUrl, status: "pending" };
    }

    const path = "/platform/v2/onramp/orders";
    const paymentMethod = input.method === "apple_pay" ? "GUEST_CHECKOUT_APPLE_PAY" : "GUEST_CHECKOUT_GOOGLE_PAY";
    const body: Record<string, unknown> = {
      destinationAddress: input.destinationAddress,
      destinationNetwork: "base",
      partnerUserRef,
      partnerOrderRef: input.goalieRequestId,
      paymentCurrency: "USD",
      paymentMethod,
      purchaseCurrency: "USDC",
      purchaseAmount: amount,
      agreementAcceptedAt: new Date().toISOString(),
      isQuote: false,
      clientIp: input.clientIp,
      domain: process.env.COINBASE_ONRAMP_DOMAIN,
    };
    // Embedded guest orders let Coinbase collect/verify contact details in the hosted payment surface.
    const data = await cdp<any>("POST", path, body);
    let checkoutUrl = data.paymentLink.url as string;
    if (process.env.COINBASE_ONRAMP_SANDBOX === "true") {
      checkoutUrl += input.method === "apple_pay" ? "&useApplePaySandbox=true" : "&useGooglePaySandbox=true";
    }
    return { provider: this.name, providerPaymentId: data.order.orderId, checkoutUrl, status: "processing" };
  }

  async getPaymentStatus(providerPaymentId: string): Promise<PaymentStatus> {
    const data = await cdp<any>("GET", `/platform/v2/onramp/orders/${providerPaymentId}`);
    const order = data.order ?? data;
    const status = String(order.status ?? "");
    if (status.includes("COMPLETED")) return { status: "completed", transactionHash: order.txHash };
    if (status.includes("FAILED")) return { status: "failed" };
    if (status.includes("PROCESSING")) return { status: "processing" };
    return { status: "pending" };
  }

  verifyPayment(providerPaymentId: string) { return this.getPaymentStatus(providerPaymentId); }

  async refundPayment(_providerPaymentId: string) {
    return { supported: false, status: "Provider-managed refund only; no automatic refund API enabled in V1." };
  }
}
